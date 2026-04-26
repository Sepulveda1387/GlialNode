import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { GlialNodeClient, convertSpaceGraphToCytoscape, convertSpaceGraphToDot, type SpaceGraphExportFormat } from "../client/glialnode-client.js";
import { createId } from "../core/ids.js";
import {
  defaultCompactionPolicy,
  defaultConfig,
  defaultConflictPolicy,
  defaultDecayPolicy,
  defaultReinforcementPolicy,
  defaultRetentionPolicy,
  defaultRoutingPolicy,
} from "../core/config.js";
import {
  diffSpacePresetDefinitions,
  getSpacePreset,
  getSpacePresetDefinition,
  isSpacePresetName,
  listSpacePresetDefinitions,
  parseSpacePresetDefinition,
  stringifySpacePresetDefinition,
  type SpacePresetName,
} from "../core/presets.js";
import type {
  ActorType,
  CreateMemoryRecordInput,
  EventType,
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySpace,
  MemoryKind,
  RecordStatus,
  MemoryTier,
  MemoryVisibility,
  ScopeRecord,
  ScopeType,
} from "../core/types.js";
import type { CompactionPolicy, ConflictPolicy, DecayPolicy, ReinforcementPolicy, RoutingPolicy } from "../core/config.js";
import {
  applyCompactionPlan,
  createCompactionDistillationLinks,
  createCompactionDistilledRecords,
  createCompactionEvents,
  createCompactionSummaryLinks,
  createCompactionSummaryRecord,
  planCompaction,
  summarizeCompactionPlan,
} from "../memory/compaction.js";
import { createConflictEvents, createConflictLinks, detectConflicts } from "../memory/conflicts.js";
import {
  applyDecayPlan,
  createDecayEvents,
  createDecaySummaryLinks,
  createDecaySummaryRecord,
  planDecay,
  summarizeDecayPlan,
} from "../memory/decay.js";
import { planLearningLoop, type LearningLoopPolicy } from "../memory/learning.js";
import { buildReleaseReadinessReport } from "../release/readiness.js";
import { promoteRecord } from "../memory/promotion.js";
import {
  applyReinforcementPlan,
  createReinforcementEvents,
  createReinforcementSummaryLinks,
  createReinforcementSummaryRecord,
  planReinforcement,
  summarizeReinforcementPlan,
} from "../memory/reinforcement.js";
import { buildMemoryBundle, buildRecallPack, buildRecallTrace, rerankRecordsWithSemanticPrototype } from "../memory/retrieval.js";
import { evaluateSemanticPrototypeCorpus, type SemanticEvalCorpus, type SemanticEvalReport } from "../memory/semantic-eval.js";
import {
  assertExecutionContextRecord,
  recommendExecutionContext,
  type ExecutionContextRecord,
} from "../execution-context/index.js";
import {
  SqliteMetricsRepository,
  resolveDefaultMetricsDatabasePath,
  type ExecutionContextRecordFilters,
  type RecordExecutionOutcomeInput,
  type RecordTokenUsageInput,
  type TokenCostModel,
  type TokenUsageGranularity,
  type TokenUsageReportOptions,
} from "../metrics/index.js";
import { renderDashboardHtml } from "../dashboard/html.js";
import { assertDashboardPrivacyPolicy, createDefaultDashboardPrivacyPolicy } from "../dashboard/privacy.js";
import {
  applyRetentionPlan,
  createRetentionEvents,
  createRetentionSummaryLinks,
  createRetentionSummaryRecord,
  planRetention,
  summarizeRetentionPlan,
} from "../memory/retention.js";
import { createMemoryRecord, updateRecordStatus } from "../memory/service.js";
import { SqliteMemoryRepository, sqliteAdapter } from "../storage/index.js";
import {
  createServerBackedStorageContract,
  describeStorageAdapter,
  planStorageBackendMigration,
} from "../storage/adapter.js";
import type { MemoryRepository, SpaceReport } from "../storage/repository.js";
import type { SqliteWriteMode } from "../storage/sqlite/connection.js";
import type { ParsedArgs } from "./args.js";

export interface CommandResult {
  lines: string[];
}

export interface CommandContext {
  repository: SqliteMemoryRepository;
  databasePath?: string;
  databaseExistedAtStartup?: boolean;
  databaseParentExistedAtStartup?: boolean;
}

const PRESET_BUNDLE_FORMAT_VERSION = 1;
const GLIALNODE_VERSION = "0.1.0";
const GLIALNODE_NODE_ENGINE = ">=24";
const CLI_JSON_CONTRACT_VERSION = "1.0.0";

export function createRepository(
  databasePath: string,
  options: { writeMode?: SqliteWriteMode } = {},
): SqliteMemoryRepository {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return new SqliteMemoryRepository({
    filename: resolvedPath,
    connection: {
      writeMode: options.writeMode,
    },
  });
}

export async function runCommand(parsed: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const [resource = "status", action = "show"] = parsed.positional;

  if (resource === "status") {
    return runStatusCommand(parsed, context);
  }

  if (resource === "doctor") {
    return runDoctorCommand(parsed, context);
  }

  if (resource === "storage") {
    return runStorageCommand(action, parsed);
  }

  if (resource === "release") {
    return runReleaseCommand(action, parsed);
  }

  if (resource === "metrics") {
    return runMetricsCommand(action, parsed, context);
  }

  if (resource === "execution-context") {
    return runExecutionContextCommand(action, parsed, context);
  }

  if (resource === "dashboard") {
    return runDashboardCommand(action, parsed, context);
  }

  if (resource === "space") {
    return runSpaceCommand(action, parsed, context);
  }

  if (resource === "preset") {
    return runPresetCommand(action, parsed, context);
  }

  if (resource === "scope") {
    return runScopeCommand(action, parsed, context);
  }

  if (resource === "memory") {
    return runMemoryCommand(action, parsed, context);
  }

  if (resource === "event") {
    return runEventCommand(action, parsed, context);
  }

  if (resource === "link") {
    return runLinkCommand(action, parsed, context);
  }

  if (resource === "export") {
    return runExportCommand(parsed, context);
  }

  if (resource === "import") {
    return runImportCommand(parsed, context);
  }

  return {
    lines: [
      "Unknown command.",
      usageText(),
    ],
  };
}

export function usageText(): string {
  return [
    "Usage:",
    "  (global) --db <path> --write-mode single_writer|serialized_local --json [--json-envelope]",
    "  glialnode status",
    "  glialnode doctor [--preset-directory <path>] [--db <path>] [--json]",
    "  glialnode storage contract [--json]",
    "  glialnode storage migration-plan [--target postgres|server-backed] [--target-schema-version 1] [--target-full-text-search true|false] [--json]",
    "  glialnode release readiness [--root <path>] [--tests-green true|false] [--pack-green true|false] [--docs-reviewed true|false] [--tree-clean true|false] [--user-approved true|false] [--json]",
    "  glialnode metrics token-record --operation <name> --model <model> --input-tokens <n> --output-tokens <n> [--space-id <id>] [--scope-id <id>] [--agent-id <id>] [--project-id <id>] [--workflow-id <id>] [--provider <name>] [--baseline-tokens <n>] [--actual-context-tokens <n>] [--glialnode-overhead-tokens <n>] [--estimated-saved-tokens <n>] [--estimated-saved-ratio <0..1>] [--latency-ms <n>] [--cost-currency <code>] [--input-cost <n>] [--output-cost <n>] [--total-cost <n>] [--dimensions <json>] [--created-at <iso>] [--metrics-db <path>] [--json]",
    "  glialnode metrics token-report [--granularity day|week|month|all] [--metrics-db <path>] [--space-id <id>] [--scope-id <id>] [--agent-id <id>] [--project-id <id>] [--workflow-id <id>] [--operation <name>] [--provider <name>] [--model <model>] [--from <iso>] [--to <iso>] [--cost-currency <code>] [--input-cost-per-million <n>] [--output-cost-per-million <n>] [--json]",
    "  glialnode execution-context recommend --task <text> [--repo-id <id>] [--project-id <id>] [--workflow-id <id>] [--agent-id <id>] [--features a,b] [--available-skills a,b] [--available-tools a,b] [--records <path>] [--metrics-db <path>] [--max-recommendations <n>] [--json]",
    "  glialnode execution-context record-outcome --task <text> --outcome success|partial|failed|unknown [--repo-id <id>] [--project-id <id>] [--workflow-id <id>] [--agent-id <id>] [--features a,b] [--selected-skills a,b] [--selected-tools a,b] [--skipped-tools a,b] [--first-reads a,b] [--latency-ms <n>] [--tool-call-count <n>] [--input-tokens <n>] [--output-tokens <n>] [--confidence low|medium|high] [--retention-days <n>] [--metrics-db <path>] [--json]",
    "  glialnode execution-context list-outcomes [--repo-id <id>] [--project-id <id>] [--workflow-id <id>] [--agent-id <id>] [--outcome success|partial|failed|unknown] [--include-expired true|false] [--metrics-db <path>] [--limit <n>] [--json]",
    "  glialnode dashboard overview [--metrics-db <path>] [--metrics-disabled true|false] [--granularity day|week|month|all] [--from <iso>] [--to <iso>] [--cost-currency <code>] [--input-cost-per-million <n>] [--output-cost-per-million <n>] [--json]",
    "  glialnode dashboard executive [--metrics-db <path>] [--metrics-disabled true|false] [--granularity day|week|month|all] [--from <iso>] [--to <iso>] [--cost-currency <code>] [--input-cost-per-million <n>] [--output-cost-per-million <n>] [--json]",
    "  glialnode dashboard space --space-id <id> [--metrics-db <path>] [--metrics-disabled true|false] [--granularity day|week|month|all] [--from <iso>] [--to <iso>] [--cost-currency <code>] [--input-cost-per-million <n>] [--output-cost-per-million <n>] [--json]",
    "  glialnode dashboard agent --agent-id <id> [--metrics-db <path>] [--metrics-disabled true|false] [--granularity day|week|month|all] [--from <iso>] [--to <iso>] [--cost-currency <code>] [--input-cost-per-million <n>] [--output-cost-per-million <n>] [--json]",
    "  glialnode dashboard operations [--metrics-db <path>] [--metrics-disabled true|false] [--latest-backup-at <iso>] [--benchmark-baseline <path>] [--json]",
    "  glialnode dashboard memory-health [--stale-freshness-threshold <0..1>] [--json]",
    "  glialnode dashboard recall-quality [--metrics-db <path>] [--metrics-disabled true|false] [--space-id <id>] [--agent-id <id>] [--project-id <id>] [--workflow-id <id>] [--from <iso>] [--to <iso>] [--max-top-recalled <n>] [--max-never-recalled <n>] [--json]",
    "  glialnode dashboard trust [--preset-directory <path>] [--recent-trust-events <n>] [--json]",
    "  glialnode dashboard alerts [--stale-freshness-threshold <0..1>] [--latest-backup-at <iso>] [--memory-health-warning-below <0..100>] [--memory-health-critical-below <0..100>] [--stale-record-warning-ratio <0..1>] [--stale-record-critical-ratio <0..1>] [--low-confidence-warning-ratio <0..1>] [--low-confidence-critical-ratio <0..1>] [--backup-warning-age-hours <n>] [--backup-critical-age-hours <n>] [--database-warning-bytes <n>] [--database-critical-bytes <n>] [--json]",
    "  glialnode dashboard export --kind dashboard-html|token-roi|memory-health|recall-quality|trust|alerts --output <path> [--format html|json|csv] [--screenshot-output <path>] [--screenshot-width <n>] [--screenshot-height <n>] [dashboard filters...] [--json]",
    "  glialnode dashboard serve --duration-ms <n> --allow-origin <origin[,origin]> [--host 127.0.0.1] [--port 8787] [--probe-path <path>] [--probe-origin <origin>] [dashboard filters...] [--json]",
    "  glialnode preset list",
    "  glialnode preset show --name <preset> | --input <path>",
    "  glialnode preset diff --left <builtin:name|local:name|file:path> --right <builtin:name|local:name|file:path> [--directory <path>]",
    "  glialnode preset export --name <preset> --output <path>",
    "  glialnode preset register --input <path> [--name <name>] [--author <name>] [--version <semver>] [--directory <path>]",
    "  glialnode preset local-list [--directory <path>]",
    "  glialnode preset local-show --name <name> [--directory <path>]",
    "  glialnode preset keygen --name <name> [--signer <text>] [--directory <path>] [--overwrite]",
    "  glialnode preset key-list [--directory <path>]",
    "  glialnode preset key-show --name <name> [--directory <path>]",
    "  glialnode preset key-export --name <name> --output <path> [--directory <path>]",
    "  glialnode preset trust-local-key --name <key-name> [--trust-name <name>] [--directory <path>] [--overwrite]",
    "  glialnode preset trust-register --input <path> --name <name> [--signer <text>] [--source <text>] [--directory <path>] [--overwrite]",
    "  glialnode preset trust-list [--directory <path>]",
    "  glialnode preset trust-show --name <name> [--directory <path>]",
    "  glialnode preset trust-pack-register --name <name> [--description <text>] [--inherits <name>] [--base-profile permissive|signed|anchored] [--require-signer true|false] [--require-signature true|false] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>] [--trust-signer <a,b>] [--directory <path>] [--overwrite]",
    "  glialnode preset trust-pack-list [--directory <path>] [--json]",
    "  glialnode preset trust-pack-show --name <name> [--directory <path>] [--json]",
    "  glialnode preset trust-revoke --name <name> [--replaced-by <name>] [--directory <path>]",
    "  glialnode preset trust-rotate --name <name> --input <path> --next-name <name> [--signer <text>] [--source <text>] [--directory <path>] [--overwrite]",
    "  glialnode preset trust-profile-list",
    "  glialnode preset history --name <name> [--directory <path>]",
    "  glialnode preset rollback --name <name> --to-version <semver> [--author <name>] [--directory <path>]",
    "  glialnode preset promote --name <name> --channel <name> --version <semver> [--directory <path>]",
    "  glialnode preset channel-show --name <name> [--channel <name>] [--directory <path>]",
    "  glialnode preset channel-list --name <name> [--directory <path>]",
    "  glialnode preset channel-default --name <name> --channel <name> [--directory <path>]",
    "  glialnode preset channel-export --name <name> --output <path> [--directory <path>]",
    "  glialnode preset channel-import --input <path> [--name <name>] [--directory <path>]",
    "  glialnode preset bundle-export --name <name> --output <path> [--directory <path>]",
    "    [--origin <text>] [--signer <text>] [--signing-key <name>] [--signing-private-key <path>] [--signing-public-key <path>]",
    "  glialnode preset bundle-import --input <path> [--directory <path>] [--name <name>] [--space-id <id>] [--collision error|overwrite|rename] [--trust-profile permissive|signed|anchored] [--trust-pack <name>] [--require-signer] [--require-signature] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>] [--trust-signer <a,b>] [--trust-explain] [--json]",
    "  glialnode preset bundle-show --input <path> [--directory <path>] [--space-id <id>] [--trust-profile permissive|signed|anchored] [--trust-pack <name>] [--require-signer] [--require-signature] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>] [--trust-signer <a,b>] [--trust-explain] [--json]",
    "  glialnode space create --name <name> [--description <text>] [--preset balanced-default|execution-first|conservative-review|planning-heavy] [--preset-local <name>] [--preset-channel <name>] [--preset-directory <path>] [--preset-file <path>] [--provenance-trust-profile permissive|signed|anchored] [--provenance-trust-signer <a,b>] [--db <path>]",
    "  glialnode space list [--db <path>]",
    "  glialnode space show --id <id> [--db <path>] [--json]",
    "  glialnode space report --id <id> [--recent-events 10] [--db <path>] [--json]",
    "  glialnode space graph-export --id <id> [--format native|cytoscape|dot] [--include-scopes true|false] [--include-events true|false] [--output <path>] [--db <path>] [--json]",
    "  glialnode space inspect-export --id <id> --output <path> [--recent-events 20] [--include-scopes true|false] [--include-events true|false] [--include-trust-registry true|false] [--query-text <text>] [--query-scope-id <id>] [--query-tier <tier>] [--query-kind <kind>] [--query-visibility <visibility>] [--query-status <status>] [--query-limit <n>] [--query-support-limit <n>] [--query-bundle-consumer auto|balanced|planner|executor|reviewer] [--query-bundle-provenance-mode auto|minimal|balanced|preserve] [--directory <path>] [--db <path>] [--json]",
    "  glialnode space inspect-snapshot --id <id> --output <path> [--recent-events 20] [--include-scopes true|false] [--include-events true|false] [--include-trust-registry true|false] [--query-text <text>] [--query-scope-id <id>] [--query-tier <tier>] [--query-kind <kind>] [--query-visibility <visibility>] [--query-status <status>] [--query-limit <n>] [--query-support-limit <n>] [--query-bundle-consumer auto|balanced|planner|executor|reviewer] [--query-bundle-provenance-mode auto|minimal|balanced|preserve] [--directory <path>] [--db <path>] [--json]",
    "  glialnode space inspect-index-export --output <path> [--recent-events 10] [--include-graph-counts true|false] [--include-trust-registry true|false] [--directory <path>] [--db <path>] [--json]",
    "  glialnode space inspect-index-snapshot --output <path> [--recent-events 10] [--include-graph-counts true|false] [--include-trust-registry true|false] [--directory <path>] [--db <path>] [--json]",
    "  glialnode space inspect-pack-export --output-dir <path> [--recent-events 20] [--include-scopes true|false] [--include-events true|false] [--include-graph-counts true|false] [--include-trust-registry true|false] [--capture-screenshots true|false] [--screenshot-width <n>] [--screenshot-height <n>] [--query-text <text>] [--query-scope-id <id>] [--query-tier <tier>] [--query-kind <kind>] [--query-visibility <visibility>] [--query-status <status>] [--query-limit <n>] [--query-support-limit <n>] [--query-bundle-consumer auto|balanced|planner|executor|reviewer] [--query-bundle-provenance-mode auto|minimal|balanced|preserve] [--directory <path>] [--db <path>] [--json]",
    "  glialnode space inspect-pack-serve --input-dir <path> --duration-ms <n> [--host <host>] [--port <n>] [--probe-path <path>] [--db <path>] [--json]",
    "  glialnode space maintain --id <id> [--apply] [--db <path>]",
    "  glialnode space configure --id <id> [--preset balanced-default|execution-first|conservative-review|planning-heavy] [--preset-local <name>] [--preset-channel <name>] [--preset-directory <path>] [--preset-file <path>] [--settings <json>] [--provenance-trust-profile permissive|signed|anchored] [--provenance-trust-signer <a,b>] [--short-promote-importance-min 0.95] [--short-promote-confidence-min 0.95] [--mid-promote-importance-min 0.9] [--mid-promote-confidence-min 0.85] [--mid-promote-freshness-min 0.6] [--archive-importance-max 0.3] [--archive-confidence-max 0.4] [--archive-freshness-max 0.3] [--distill-min-cluster-size 2] [--distill-min-token-overlap 2] [--distill-supersede-sources true] [--distill-supersede-min-confidence 0.8] [--conflict-enabled true] [--conflict-min-token-overlap 2] [--conflict-confidence-penalty 0.15] [--decay-enabled true] [--decay-min-age-days 14] [--decay-confidence-per-day 0.01] [--decay-freshness-per-day 0.02] [--decay-min-confidence 0.2] [--decay-min-freshness 0.15] [--routing-prefer-reviewer-on-contested true] [--routing-prefer-reviewer-on-stale true] [--routing-prefer-reviewer-on-provenance true] [--routing-stale-threshold 0.35] [--routing-prefer-executor-on-actionable true] [--routing-prefer-planner-on-distilled true] [--reinforcement-enabled true] [--reinforcement-confidence-boost 0.08] [--reinforcement-freshness-boost 0.12] [--reinforcement-max-confidence 1] [--reinforcement-max-freshness 1] [--retention-short-days 7] [--retention-mid-days 30] [--retention-long-days 90] [--db <path>]",
    "  glialnode scope add --space-id <id> --type <type> [--label <text>] [--external-id <id>] [--parent-scope-id <id>] [--db <path>]",
    "  glialnode scope list --space-id <id> [--db <path>]",
    "  glialnode memory add --space-id <id> --scope-id <id> --scope-type <type> --tier <tier> --kind <kind> --content <text> [--summary <text>] [--compact-content <text>] [--tags a,b] [--visibility <visibility>] [--importance 0.7] [--confidence 0.8] [--freshness 0.6] [--db <path>]",
    "  glialnode memory search --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 10] [--semantic-prototype true|false] [--semantic-weight 0.35] [--semantic-gate-report <path>] [--semantic-gate-require-pass true|false] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>] [--json]",
    "  glialnode memory recall --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--semantic-prototype true|false] [--semantic-weight 0.35] [--semantic-gate-report <path>] [--semantic-gate-require-pass true|false] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>] [--json]",
    "  glialnode memory trace --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--semantic-prototype true|false] [--semantic-weight 0.35] [--semantic-gate-report <path>] [--semantic-gate-require-pass true|false] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>] [--json]",
    "  glialnode memory bundle --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--semantic-prototype true|false] [--semantic-weight 0.35] [--semantic-gate-report <path>] [--semantic-gate-require-pass true|false] [--bundle-profile balanced|planner|executor|reviewer] [--bundle-consumer auto|balanced|planner|executor|reviewer] [--bundle-provenance-mode auto|minimal|balanced|preserve] [--bundle-max-supporting 3] [--bundle-max-content-chars 240] [--bundle-prefer-compact true] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>] [--json]",
    "  glialnode memory semantic-eval --corpus <path> [--semantic-weight 0.35] [--min-delta-top1 0] [--output <path>] [--db <path>] [--json]",
    "  glialnode memory list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode memory compact --space-id <id> [--apply] [--db <path>]",
    "  glialnode memory decay --space-id <id> [--apply] [--db <path>]",
    "  glialnode memory reinforce --record-id <id> [--strength 1] [--reason <text>] [--db <path>]",
    "  glialnode memory learn-plan --space-id <id> [--min-successful-uses 2] [--max-suggestions 10] [--reinforcement-strength 1] [--contradiction-confidence-gap 0.2] [--db <path>] [--json]",
    "  glialnode memory retain --space-id <id> [--apply] [--db <path>]",
    "  glialnode event add --space-id <id> --scope-id <id> --scope-type <type> --actor-type <type> --actor-id <id> --event-type <type> --summary <text> [--payload <json>] [--db <path>]",
    "  glialnode event list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode link add --space-id <id> --from-record-id <id> --to-record-id <id> --type <relation> [--db <path>]",
    "  glialnode link list --space-id <id> [--record-id <id>] [--limit 10] [--db <path>]",
    "  glialnode export --space-id <id> [--output <path>] [--origin <name>] [--signer <name>] [--signing-private-key <path>] [--signing-key <name>] [--preset-directory <path>] [--db <path>]",
    "  glialnode import --input <path> [--collision error|overwrite|rename] [--trust-profile permissive|signed|anchored] [--trust-pack <name>] [--require-signer] [--require-signature] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>] [--trust-signer <a,b>] [--preset-directory <path>] [--preview] [--json] [--db <path>]",
    "  glialnode memory promote --record-id <id> [--db <path>]",
    "  glialnode memory archive --record-id <id> [--db <path>]",
    "  glialnode memory show --record-id <id> [--db <path>]",
  ].join("\n");
}

function wantsJson(parsed: ParsedArgs): boolean {
  return parsed.flags.json === "true";
}

function wantsJsonEnvelope(parsed: ParsedArgs): boolean {
  return parsed.flags["json-envelope"] === "true";
}

function resolveCommandPath(parsed: ParsedArgs): string {
  const [resource = "status", action] = parsed.positional;
  return action ? `${resource} ${action}` : resource;
}

function jsonResult(parsed: ParsedArgs, payload: unknown): CommandResult {
  const serializedPayload = wantsJsonEnvelope(parsed)
    ? {
        schemaVersion: CLI_JSON_CONTRACT_VERSION,
        command: resolveCommandPath(parsed),
        generatedAt: new Date().toISOString(),
        data: payload,
      }
    : payload;

  return {
    lines: JSON.stringify(serializedPayload, null, 2).split(/\r?\n/),
  };
}

async function runStatusCommand(parsed: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const payload = await buildStatusPayload(context);

  if (wantsJson(parsed)) {
    return jsonResult(parsed, payload);
  }

  return {
    lines: [
      `spaces=${payload.spaces}`,
      `status=${payload.status}`,
      `storageAdapter=${payload.storageContract.name}`,
      `storageDialect=${payload.storageContract.dialect}`,
      `storageSchemaVersion=${payload.storageContract.schemaVersion}`,
      `storageCrossProcessWrites=${payload.storageContract.capabilities.crossProcessWrites}`,
      `database=${payload.database.path ?? ""}`,
      `databaseExistedAtStartup=${formatOptionalBoolean(payload.database.existedAtStartup)}`,
      `databaseParentExistedAtStartup=${formatOptionalBoolean(payload.database.parentExistedAtStartup)}`,
      `schemaVersion=${payload.schema.version}`,
      `schemaLatest=${payload.schema.latest}`,
      `schemaUpToDate=${payload.schema.upToDate ? "yes" : "no"}`,
      `maintenanceSpaces=${payload.maintenance.spacesWithMaintenance}`,
      `maintenanceLatestRunAt=${payload.maintenance.latestRunAt ?? ""}`,
      `maintenanceCompactionDeltas=${formatCounts(payload.maintenance.compactionDeltas)}`,
      `maintenanceRetentionExpired=${payload.maintenance.retentionExpired}`,
      `maintenanceDecayDecayed=${payload.maintenance.decayDecayed}`,
      `maintenanceReinforcementUpdated=${payload.maintenance.reinforcementUpdated}`,
      `writeMode=${payload.runtime.writeMode}`,
      `journalMode=${payload.runtime.journalMode.toLowerCase()}`,
      `synchronous=${payload.runtime.synchronous.toLowerCase()}`,
      `busyTimeoutMs=${payload.runtime.busyTimeoutMs}`,
      `foreignKeys=${payload.runtime.foreignKeys ? "on" : "off"}`,
      `defensive=${payload.runtime.defensive === null ? "unsupported" : payload.runtime.defensive ? "on" : "off"}`,
      ...payload.runtime.writeGuarantees.map((guarantee) => `writeGuarantee=${guarantee}`),
      ...payload.runtime.writeNonGoals.map((nonGoal) => `writeNonGoal=${nonGoal}`),
    ],
  };
}

async function buildStatusPayload(context: CommandContext) {
  const spaces = await context.repository.listSpaces();
  const runtime = context.repository.getRuntimeSettings();
  const storageContract = describeStorageAdapter(sqliteAdapter);
  const maintenanceReports = await Promise.all(
    spaces.map((space) => context.repository.getSpaceReport(space.id, 1)),
  );
  const maintenance = summarizeMaintenanceAcrossSpaces(maintenanceReports);

  return {
    status: "ready" as const,
    storage: sqliteAdapter.name,
    storageContract,
    spaces: spaces.length,
    database: {
      path: context.databasePath ?? runtime.filename,
      existedAtStartup: context.databaseExistedAtStartup ?? null,
      parentExistedAtStartup: context.databaseParentExistedAtStartup ?? null,
    },
    schema: {
      version: context.repository.getSchemaVersion(),
      latest: sqliteAdapter.schemaVersion,
      upToDate: context.repository.getSchemaVersion() === sqliteAdapter.schemaVersion,
    },
    maintenance,
    runtime: {
      writeMode: runtime.writeMode,
      journalMode: runtime.journalMode,
      synchronous: runtime.synchronous,
      busyTimeoutMs: runtime.busyTimeoutMs,
      foreignKeys: runtime.foreignKeys,
      defensive: runtime.defensive,
      writeGuarantees: runtime.writeGuarantees,
      writeNonGoals: runtime.writeNonGoals,
    },
  };
}

function runDoctorCommand(parsed: ParsedArgs, context: CommandContext): CommandResult {
  const report = buildDoctorReport(parsed, context);

  if (wantsJson(parsed)) {
    return jsonResult(parsed, report);
  }

  return {
    lines: [
      `status=${report.status}`,
      `storage=${report.storage}`,
      `databasePath=${report.database.path ?? ""}`,
      `databaseExistedAtStartup=${formatOptionalBoolean(report.database.existedAtStartup)}`,
      `databaseParentExistedAtStartup=${formatOptionalBoolean(report.database.parentExistedAtStartup)}`,
      `databaseKind=${report.database.kind}`,
      `databaseSizeBytes=${report.database.sizeBytes ?? 0}`,
      `databaseWalSidecar=${report.database.walSidecarPresent ? "present" : "absent"}`,
      `databaseShmSidecar=${report.database.shmSidecarPresent ? "present" : "absent"}`,
      `schemaVersion=${report.schema.version}`,
      `schemaLatest=${report.schema.latest}`,
      `schemaUpToDate=${report.schema.upToDate ? "yes" : "no"}`,
      `writeMode=${report.runtime.writeMode}`,
      `journalMode=${report.runtime.journalMode.toLowerCase()}`,
      `synchronous=${report.runtime.synchronous.toLowerCase()}`,
      `busyTimeoutMs=${report.runtime.busyTimeoutMs}`,
      `foreignKeys=${report.runtime.foreignKeys ? "on" : "off"}`,
      `defensive=${report.runtime.defensive === null ? "unsupported" : report.runtime.defensive ? "on" : "off"}`,
      `presetDirectory=${report.presetRegistry.path}`,
      `presetDirectoryKind=${report.presetRegistry.kind}`,
      `presetFiles=${report.presetRegistry.presetFileCount}`,
      `presetHistorySnapshots=${report.presetRegistry.historySnapshotCount}`,
      `presetChannelFiles=${report.presetRegistry.channelFileCount}`,
      `signingKeysDirectory=${report.signerStore.path}`,
      `signingKeysDirectoryKind=${report.signerStore.kind}`,
      `signingKeys=${report.signerStore.fileCount}`,
      `trustedSignersDirectory=${report.trustStore.path}`,
      `trustedSignersDirectoryKind=${report.trustStore.kind}`,
      `trustedSigners=${report.trustStore.fileCount}`,
      `revokedTrustedSigners=${report.trustStore.revokedCount ?? 0}`,
      ...report.warnings.map((warning) => `warning=${warning}`),
    ],
  };
}

function buildDoctorReport(parsed: ParsedArgs, context: CommandContext) {
  const runtime = context.repository.getRuntimeSettings();
  const databasePath = context.databasePath ?? runtime.filename ?? null;
  const database = inspectDatabasePath(databasePath, {
    existedAtStartup: context.databaseExistedAtStartup,
    parentExistedAtStartup: context.databaseParentExistedAtStartup,
  });
  const presetDirectory = resolvePresetDirectory(parsed.flags["preset-directory"]);
  const presetRegistry = inspectPresetRegistry(presetDirectory);
  const signerStore = inspectJsonStoreDirectory(getSigningKeysDirectory(presetDirectory), {
    label: "Signing key store",
    modePolicy: "private",
    parseRecord: parseSigningKeyRecord,
  });
  const trustStore = inspectJsonStoreDirectory(getTrustedSignersDirectory(presetDirectory), {
    label: "Trusted signer store",
    modePolicy: "shared",
    parseRecord: parseTrustedSignerRecord,
    countRevoked: true,
  });

  const warnings = [
    ...database.warnings,
    ...presetRegistry.warnings,
    ...signerStore.warnings,
    ...trustStore.warnings,
  ];

  if (context.repository.getSchemaVersion() !== sqliteAdapter.schemaVersion) {
    warnings.push(
      `SQLite schema version ${context.repository.getSchemaVersion()} does not match latest ${sqliteAdapter.schemaVersion}.`,
    );
  }

  if (!runtime.foreignKeys) {
    warnings.push("SQLite foreign key enforcement is disabled.");
  }

  if (runtime.journalMode !== "WAL" && runtime.filename) {
    warnings.push(`SQLite journal mode is ${runtime.journalMode}; expected WAL for the default hardening contract.`);
  }

  if (runtime.busyTimeoutMs < 5000) {
    warnings.push(`SQLite busy timeout is ${runtime.busyTimeoutMs}ms; default hardened runtime uses at least 5000ms.`);
  }

  return {
    status: warnings.length > 0 ? "attention" as const : "ready" as const,
    storage: sqliteAdapter.name,
    database,
    schema: {
      version: context.repository.getSchemaVersion(),
      latest: sqliteAdapter.schemaVersion,
      upToDate: context.repository.getSchemaVersion() === sqliteAdapter.schemaVersion,
    },
    runtime: {
      writeMode: runtime.writeMode,
      journalMode: runtime.journalMode,
      synchronous: runtime.synchronous,
      busyTimeoutMs: runtime.busyTimeoutMs,
      foreignKeys: runtime.foreignKeys,
      defensive: runtime.defensive,
      writeGuarantees: runtime.writeGuarantees,
      writeNonGoals: runtime.writeNonGoals,
    },
    presetRegistry,
    signerStore,
    trustStore,
    warnings,
  };
}

function runStorageCommand(action: string, parsed: ParsedArgs): CommandResult {
  if (action === "contract") {
    const contract = describeStorageAdapter(sqliteAdapter);

    if (wantsJson(parsed)) {
      return jsonResult(parsed, contract);
    }

    return {
      lines: [
        `name=${contract.name}`,
        `dialect=${contract.dialect}`,
        `schemaVersion=${contract.schemaVersion}`,
        `localFirst=${contract.capabilities.localFirst ? "yes" : "no"}`,
        `serverBacked=${contract.capabilities.serverBacked ? "yes" : "no"}`,
        `fullTextSearch=${contract.capabilities.fullTextSearch ? "yes" : "no"}`,
        `crossProcessWrites=${contract.capabilities.crossProcessWrites}`,
        ...contract.guarantees.map((guarantee) => `guarantee=${guarantee}`),
        ...contract.nonGoals.map((nonGoal) => `nonGoal=${nonGoal}`),
      ],
    };
  }

  if (action === "migration-plan") {
    const target = createServerBackedStorageContract({
      name: parsed.flags.target ?? "server-backed",
      dialect: parsed.flags.target === "postgres" || parsed.flags.target === undefined
        ? "postgres"
        : parsed.flags.target,
      schemaVersion: parsed.flags["target-schema-version"]
        ? parseRequiredPositiveNumber(parsed.flags["target-schema-version"], "target-schema-version")
        : 1,
      fullTextSearch: parsed.flags["target-full-text-search"] !== undefined
        ? parseOptionalBoolean(parsed.flags["target-full-text-search"])
        : true,
    });
    const plan = planStorageBackendMigration(sqliteAdapter, target);

    if (wantsJson(parsed)) {
      return jsonResult(parsed, plan);
    }

    return {
      lines: [
        `source=${plan.source.name}/${plan.source.dialect}`,
        `target=${plan.target.name}/${plan.target.dialect}`,
        `compatible=${plan.compatible ? "yes" : "no"}`,
        `requiresSnapshotExport=${plan.requiresSnapshotExport ? "yes" : "no"}`,
        `requiresSchemaMigration=${plan.requiresSchemaMigration ? "yes" : "no"}`,
        ...plan.warnings.map((warning) => `warning=${warning}`),
        ...plan.steps.map((step, index) => `step${index + 1}=${step}`),
      ],
    };
  }

  return {
    lines: ["Unknown storage command.", usageText()],
  };
}

function runReleaseCommand(action: string, parsed: ParsedArgs): CommandResult {
  if (action !== "readiness") {
    return {
      lines: ["Unknown release command.", usageText()],
    };
  }

  const report = buildReleaseReadinessReport({
    rootDirectory: parsed.flags.root,
    testsGreen: parseFlagBooleanDefaultFalse(parsed.flags["tests-green"]),
    packGreen: parseFlagBooleanDefaultFalse(parsed.flags["pack-green"]),
    docsReviewed: parseFlagBooleanDefaultFalse(parsed.flags["docs-reviewed"]),
    treeClean: parseFlagBooleanDefaultFalse(parsed.flags["tree-clean"]),
    userApproved: parseFlagBooleanDefaultFalse(parsed.flags["user-approved"]),
  });

  if (wantsJson(parsed)) {
    return jsonResult(parsed, report);
  }

  return {
    lines: [
      `status=${report.status}`,
      `rootDirectory=${report.rootDirectory}`,
      `blockers=${report.blockers.length}`,
      ...report.checks.map((check) => `check=${check.id}:${check.status}:${check.summary}`),
    ],
  };
}

async function runMetricsCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (parseFlagBooleanDefaultFalse(parsed.flags["metrics-disabled"])) {
    throw new Error("Metrics repository is disabled by --metrics-disabled.");
  }

  const metricsDatabasePath = resolve(parsed.flags["metrics-db"] ?? resolveDefaultMetricsDatabasePath(context.databasePath));
  const metricsRepository = new SqliteMetricsRepository({ filename: metricsDatabasePath });

  try {
    if (action === "token-record") {
      assertNoRawTextMetricFlags(parsed.flags);
      const input = parseTokenUsageInput(parsed.flags);
      const record = await metricsRepository.recordTokenUsage(input);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          record,
        });
      }

      return {
        lines: [
          `id=${record.id}`,
          `metricsDatabase=${metricsDatabasePath}`,
          `operation=${record.operation}`,
          `model=${record.model}`,
          `inputTokens=${record.inputTokens}`,
          `outputTokens=${record.outputTokens}`,
          `estimatedSavedTokens=${record.estimatedSavedTokens ?? ""}`,
        ],
      };
    }

    if (action === "token-report") {
      const report = await metricsRepository.getTokenUsageReport(parseTokenUsageReportOptions(parsed.flags));

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          report,
        });
      }

      return {
        lines: [
          `metricsDatabase=${metricsDatabasePath}`,
          `granularity=${report.granularity}`,
          `records=${report.totals.recordCount}`,
          `inputTokens=${report.totals.inputTokens}`,
          `outputTokens=${report.totals.outputTokens}`,
          `baselineTokens=${report.totals.baselineTokens}`,
          `estimatedSavedTokens=${report.totals.estimatedSavedTokens}`,
          `estimatedSavedRatio=${report.totals.estimatedSavedRatio ?? ""}`,
          `costBefore=${report.totals.costBefore ?? ""}`,
          `costAfter=${report.totals.costAfter ?? ""}`,
          `costSaved=${report.totals.costSaved ?? ""}`,
          ...report.buckets.map((bucket) => `bucket=${bucket.key}:${bucket.totals.recordCount}:${bucket.totals.estimatedSavedTokens}`),
        ],
      };
    }
  } finally {
    metricsRepository.close();
  }

  return {
    lines: ["Unknown metrics command.", usageText()],
  };
}

async function runExecutionContextCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const metricsDatabasePath = resolve(parsed.flags["metrics-db"] ?? resolveDefaultMetricsDatabasePath(context.databasePath));

  if (action === "recommend") {
    const fileRecords = parseExecutionContextRecordsFile(parsed.flags.records);
    const metricsRecords = parsed.flags["metrics-db"] !== undefined
      ? await withMetricsRepository(metricsDatabasePath, (metricsRepository) =>
          metricsRepository.listExecutionContextRecords({
            repoId: parsed.flags["repo-id"],
            projectId: parsed.flags["project-id"],
            workflowId: parsed.flags["workflow-id"],
            agentId: parsed.flags["agent-id"],
            limit: parsePositiveOptionalNumber(parsed.flags["records-limit"], "records-limit"),
          }))
      : [];
    const recommendation = recommendExecutionContext({
      taskText: parseRequiredString(parsed.flags.task, "task"),
      scope: {
        repoId: parsed.flags["repo-id"],
        projectId: parsed.flags["project-id"],
        workflowId: parsed.flags["workflow-id"],
        agentId: parsed.flags["agent-id"],
      },
      features: parseCommaSeparatedList(parsed.flags.features),
      availableSkills: parseCommaSeparatedList(parsed.flags["available-skills"]),
      availableTools: parseCommaSeparatedList(parsed.flags["available-tools"]),
      records: [...fileRecords, ...metricsRecords],
      maxRecommendations: parsePositiveOptionalNumber(parsed.flags["max-recommendations"], "max-recommendations"),
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        metricsDatabasePath: parsed.flags["metrics-db"] !== undefined ? metricsDatabasePath : undefined,
        recommendation,
      });
    }

    return {
      lines: [
        `schemaVersion=${recommendation.schemaVersion}`,
        ...(parsed.flags["metrics-db"] !== undefined ? [`metricsDatabase=${metricsDatabasePath}`] : []),
        `confidence=${recommendation.confidence}`,
        `matchedRecords=${recommendation.matchedRecords}`,
        `ignoredExpiredRecords=${recommendation.ignoredExpiredRecords}`,
        `selectedSkills=${recommendation.selectedSkills.join(",")}`,
        `selectedTools=${recommendation.selectedTools.join(",")}`,
        `avoidTools=${recommendation.avoidTools.join(",")}`,
        `firstReads=${recommendation.firstReads.join(",")}`,
        ...recommendation.warnings.map((warning) => `warning=${warning}`),
      ],
    };
  }

  if (action === "record-outcome") {
    const input = parseExecutionOutcomeInput(parsed.flags);
    const record = await withMetricsRepository(metricsDatabasePath, (metricsRepository) =>
      metricsRepository.recordExecutionOutcome(input));

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        metricsDatabasePath,
        record,
      });
    }

    return {
      lines: [
        `id=${record.id}`,
        `metricsDatabase=${metricsDatabasePath}`,
        `fingerprint=${record.taskFingerprint.hash}`,
        `outcome=${record.outcome.state}`,
        `confidence=${record.confidence}`,
        `expiresAt=${record.expiresAt}`,
      ],
    };
  }

  if (action === "list-outcomes") {
    const filters = parseExecutionContextRecordFilters(parsed.flags);
    const records = await withMetricsRepository(metricsDatabasePath, (metricsRepository) =>
      metricsRepository.listExecutionContextRecords(filters));

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        metricsDatabasePath,
        records,
      });
    }

    return {
      lines: [
        `metricsDatabase=${metricsDatabasePath}`,
        `records=${records.length}`,
        ...records.map((record) =>
          `record=${record.id}:${record.outcome.state}:${record.confidence}:${record.taskFingerprint.hash}:${record.createdAt}`),
      ],
    };
  }

  return {
    lines: ["Unknown execution-context command.", usageText()],
  };
}

async function withMetricsRepository<T>(
  metricsDatabasePath: string,
  operation: (metricsRepository: SqliteMetricsRepository) => Promise<T>,
): Promise<T> {
  const metricsRepository = new SqliteMetricsRepository({ filename: metricsDatabasePath });
  try {
    return await operation(metricsRepository);
  } finally {
    metricsRepository.close();
  }
}

async function runDashboardCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const metricsDatabasePath = resolve(parsed.flags["metrics-db"] ?? resolveDefaultMetricsDatabasePath(context.databasePath));
  const client = new GlialNodeClient({
    repository: context.repository,
    filename: context.databasePath,
    metrics: {
      filename: metricsDatabasePath,
      disabled: parseFlagBooleanDefaultFalse(parsed.flags["metrics-disabled"]),
    },
  });

  try {
    const options = {
      staleFreshnessThreshold: parseOptionalNonNegativeNumber(parsed.flags["stale-freshness-threshold"], "stale-freshness-threshold"),
      latestBackupAt: parsed.flags["latest-backup-at"],
      tokenUsage: parseTokenUsageReportOptions(parsed.flags),
      alertThresholds: parseDashboardAlertThresholdFlags(parsed.flags),
      maxTopRecalled: parseOptionalNonNegativeInteger(parsed.flags["max-top-recalled"], "max-top-recalled"),
      maxNeverRecalled: parseOptionalNonNegativeInteger(parsed.flags["max-never-recalled"], "max-never-recalled"),
      presetDirectory: parsed.flags["preset-directory"],
      recentTrustEventLimit: parseOptionalNonNegativeInteger(parsed.flags["recent-trust-events"], "recent-trust-events"),
      operationsBenchmarkBaseline: parseOperationsBenchmarkBaselineFlag(parsed.flags["benchmark-baseline"]),
    };

    if (action === "serve") {
      const host = parsed.flags.host ?? "127.0.0.1";
      const allowedOrigins = parseDashboardAllowedOrigins(parsed.flags["allow-origin"]);
      const result = await serveDashboardApi({
        client,
        metricsDatabasePath,
        buildOptions: options,
        host,
        port: parsed.flags.port !== undefined ? parsePortNumber(parsed.flags.port) : 8787,
        durationMs: parseRequiredPositiveNumber(parsed.flags["duration-ms"], "duration-ms"),
        allowedOrigins,
        probePath: parsed.flags["probe-path"],
        probeOrigin: parsed.flags["probe-origin"],
      });

      if (wantsJson(parsed)) {
        return jsonResult(parsed, result);
      }

      return {
        lines: [
          "Dashboard API served.",
          `baseUrl=${result.baseUrl}`,
          `host=${result.host}`,
          `port=${result.port}`,
          `durationMs=${result.durationMs}`,
          `allowedOrigins=${result.allowedOrigins.join(",")}`,
          `probePath=${result.probePath ?? ""}`,
          `probeStatus=${result.probeStatus ?? ""}`,
        ],
      };
    }

    if (action === "memory-health") {
      const report = await client.buildMemoryHealthReport(options);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          report,
        });
      }

      return {
        lines: [
          `metricsDatabase=${metricsDatabasePath}`,
          `activeRecords=${report.activeRecords.value ?? ""}`,
          `staleRecords=${report.staleRecords.value ?? ""}`,
          `lowConfidenceRecords=${report.lowConfidenceRecords.value ?? ""}`,
          `archivedRecords=${report.archivedRecords.value ?? ""}`,
          `supersededRecords=${report.supersededRecords.value ?? ""}`,
          `expiredRecords=${report.expiredRecords.value ?? ""}`,
          `provenanceSummaryCount=${report.provenanceSummaryCount.value ?? ""}`,
          `spacesMissingMaintenance=${report.lifecycleDue.spacesMissingMaintenance.value ?? ""}`,
          `compactionCandidates=${report.lifecycleDue.compactionCandidates.value ?? ""}`,
          `retentionCandidates=${report.lifecycleDue.retentionCandidates.value ?? ""}`,
          `healthScore=${report.healthScore.value ?? ""}`,
          `latestMaintenanceAt=${report.latestMaintenanceAt.value ?? ""}`,
        ],
      };
    }

    if (action === "alerts") {
      const evaluation = await client.evaluateDashboardAlerts(options);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          evaluation,
        });
      }

      return {
        lines: [
          `schemaVersion=${evaluation.schemaVersion}`,
          `metricsDatabase=${metricsDatabasePath}`,
          `alerts=${evaluation.summary.total}`,
          `critical=${evaluation.summary.critical}`,
          `warning=${evaluation.summary.warning}`,
          `info=${evaluation.summary.info}`,
          `highestSeverity=${evaluation.summary.highestSeverity}`,
          ...evaluation.alerts.map((alert) => `alert=${alert.severity}:${alert.code}:${alert.message}`),
        ],
      };
    }

    if (action === "recall-quality") {
      const report = await client.buildRecallQualityReport(options);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          report,
        });
      }

      return {
        lines: [
          `schemaVersion=${report.schemaVersion}`,
          `metricsDatabase=${metricsDatabasePath}`,
          `recallRequests=${report.totals.recallRequests}`,
          `bundleRequests=${report.totals.bundleRequests}`,
          `traceRequests=${report.totals.traceRequests}`,
          `measuredLatencyRequests=${report.totals.measuredLatencyRequests}`,
          `averageLatencyMs=${report.totals.averageLatencyMs ?? ""}`,
          `p50LatencyMs=${report.totals.p50LatencyMs ?? ""}`,
          `p95LatencyMs=${report.totals.p95LatencyMs ?? ""}`,
          `compactVsFullUsageRatio=${report.totals.compactVsFullUsageRatio ?? ""}`,
          `topRecalled=${report.topRecalled.length}`,
          `neverRecalledCandidates=${report.neverRecalledCandidates.length}`,
        ],
      };
    }

    if (action === "trust") {
      const report = await client.buildTrustDashboardReport(options);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          report,
        });
      }

      return {
        lines: [
          `schemaVersion=${report.schemaVersion}`,
          `metricsDatabase=${metricsDatabasePath}`,
          `spaces=${report.totals.spaces}`,
          `spacesWithTrustProfile=${report.totals.spacesWithTrustProfile}`,
          `spacesNeedingTrustReview=${report.totals.spacesNeedingTrustReview}`,
          `provenanceEvents=${report.totals.provenanceEvents}`,
          `trustedSigners=${report.totals.trustedSigners}`,
          `activeTrustedSigners=${report.totals.activeTrustedSigners}`,
          `revokedTrustedSigners=${report.totals.revokedTrustedSigners}`,
          `trustPolicyPacks=${report.totals.trustPolicyPacks}`,
          `policyFailureEvents=${report.totals.policyFailureEvents}`,
        ],
      };
    }

    if (action === "export") {
      const exportKind = parseDashboardExportKind(parsed.flags.kind);
      const exportFormat = parseDashboardExportFormat(parsed.flags.format, exportKind);
      const outputPath = resolve(parseRequiredString(parsed.flags.output, "output"));
      const screenshotOutput = parsed.flags["screenshot-output"] === undefined
        ? undefined
        : resolve(parseRequiredString(parsed.flags["screenshot-output"], "screenshot-output"));
      const screenshotWidth = parsePositiveOptionalNumber(parsed.flags["screenshot-width"], "screenshot-width");
      const screenshotHeight = parsePositiveOptionalNumber(parsed.flags["screenshot-height"], "screenshot-height");

      if (screenshotOutput && exportKind !== "dashboard-html") {
        throw new Error("Dashboard screenshot capture is only supported for --kind dashboard-html.");
      }

      const artifact = await buildDashboardExportArtifact(client, exportKind, exportFormat, options);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, artifact.content, "utf8");
      const screenshotPath = screenshotOutput
        ? await captureDashboardHtmlScreenshot(outputPath, screenshotOutput, {
            width: screenshotWidth ?? 1440,
            height: screenshotHeight ?? 900,
          })
        : undefined;

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          metricsDatabasePath,
          kind: exportKind,
          format: exportFormat,
          outputPath,
          screenshotPath,
          screenshotsCaptured: Boolean(screenshotPath),
          bytes: Buffer.byteLength(artifact.content, "utf8"),
        });
      }

      return {
        lines: [
          "Dashboard export written.",
          `kind=${exportKind}`,
          `format=${exportFormat}`,
          `output=${outputPath}`,
          `screenshot=${screenshotPath ?? ""}`,
          `screenshotsCaptured=${screenshotPath ? "yes" : "no"}`,
          `bytes=${Buffer.byteLength(artifact.content, "utf8")}`,
        ],
      };
    }

    const snapshot = action === "overview"
      ? await client.buildDashboardOverviewSnapshot(options)
      : action === "executive"
      ? await client.buildExecutiveDashboardSnapshot(options)
      : action === "space"
      ? await client.buildSpaceDashboardSnapshot(parseRequiredString(parsed.flags["space-id"], "space-id"), options)
      : action === "agent"
      ? await client.buildAgentDashboardSnapshot(parseRequiredString(parsed.flags["agent-id"], "agent-id"), options)
      : action === "operations"
      ? await client.buildOperationsDashboardSnapshot(options)
      : undefined;

    if (!snapshot) {
      return {
        lines: ["Unknown dashboard command.", usageText()],
      };
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        metricsDatabasePath,
        snapshot,
      });
    }

    return {
      lines: [
        `schemaVersion=${snapshot.schemaVersion}`,
        `kind=${snapshot.kind}`,
        `metricsDatabase=${metricsDatabasePath}`,
        ...formatDashboardSnapshotCliLines(snapshot),
      ],
    };
  } finally {
    client.close();
  }
}

function formatDashboardSnapshotCliLines(snapshot: Awaited<ReturnType<GlialNodeClient["buildDashboardOverviewSnapshot"]>>
  | Awaited<ReturnType<GlialNodeClient["buildExecutiveDashboardSnapshot"]>>
  | Awaited<ReturnType<GlialNodeClient["buildOperationsDashboardSnapshot"]>>): string[] {
  if (snapshot.kind === "operations") {
    return [
      `backend=${snapshot.storage.backend.value ?? ""}`,
      `schemaVersionValue=${snapshot.storage.schemaVersion.value ?? ""}`,
      `databaseBytes=${snapshot.storage.databaseBytes.value ?? ""}`,
      `doctorStatus=${snapshot.reliability.doctorStatus.value ?? ""}`,
      `criticalWarnings=${snapshot.reliability.criticalWarnings.value ?? ""}`,
      `benchmarkRecords=${snapshot.performance?.benchmarkBaseline.records.value ?? ""}`,
      `benchmarkSearchMs=${snapshot.performance?.benchmarkBaseline.searchMs.value ?? ""}`,
      `benchmarkRecallMs=${snapshot.performance?.benchmarkBaseline.recallMs.value ?? ""}`,
    ];
  }

  if (snapshot.kind === "executive") {
    return [
      `activeSpaces=${snapshot.value.activeSpaces.value ?? ""}`,
      `savedTokens=${snapshot.value.savedTokens.value ?? ""}`,
      `savedTokensConfidence=${snapshot.value.savedTokens.confidence}`,
      `savedCost=${snapshot.value.savedCost.value ?? ""}`,
      `memoryHealthScore=${snapshot.risk.memoryHealthScore.value ?? ""}`,
      `openCriticalWarnings=${snapshot.risk.openCriticalWarnings.value ?? ""}`,
    ];
  }

  return [
    `activeSpaces=${snapshot.memory.activeSpaces.value ?? ""}`,
    `activeRecords=${snapshot.memory.activeRecords.value ?? ""}`,
    `staleRecords=${snapshot.memory.staleRecords.value ?? ""}`,
    `savedTokens=${snapshot.value.savedTokens.value ?? ""}`,
    `savedTokensConfidence=${snapshot.value.savedTokens.confidence}`,
    `savedCost=${snapshot.value.savedCost.value ?? ""}`,
    `maintenanceDue=${snapshot.operations.maintenanceDue.value ?? ""}`,
  ];
}

type DashboardExportKind = "dashboard-html" | "token-roi" | "memory-health" | "recall-quality" | "trust" | "alerts";
type DashboardExportFormat = "html" | "json" | "csv";

async function buildDashboardExportArtifact(
  client: GlialNodeClient,
  kind: DashboardExportKind,
  format: DashboardExportFormat,
  options: Parameters<GlialNodeClient["buildDashboardOverviewSnapshot"]>[0],
): Promise<{ content: string }> {
  if (kind === "dashboard-html") {
    if (format !== "html") {
      throw new Error("Dashboard HTML export only supports html format.");
    }

    const [executive, operations, memoryHealth, recallQuality, trust, alerts] = await Promise.all([
      client.buildExecutiveDashboardSnapshot(options),
      client.buildOperationsDashboardSnapshot(options),
      client.buildMemoryHealthReport(options),
      client.buildRecallQualityReport(options),
      client.buildTrustDashboardReport(options),
      client.evaluateDashboardAlerts(options),
    ]);

    return {
      content: renderDashboardHtml({ executive, operations, memoryHealth, recallQuality, trust, alerts }),
    };
  }

  if (kind === "token-roi") {
    if (format !== "json" && format !== "csv") {
      throw new Error("Dashboard token ROI export only supports json or csv format.");
    }

    const report = await client.getTokenUsageReport(options?.tokenUsage);
    return {
      content: format === "csv"
        ? formatTokenRoiCsv(report)
        : `${JSON.stringify({ schemaVersion: "1.0.0", kind, report }, null, 2)}\n`,
    };
  }

  if (format !== "json") {
    throw new Error(`Dashboard export kind '${kind}' only supports json format.`);
  }

  const payload = kind === "memory-health"
    ? await client.buildMemoryHealthReport(options)
    : kind === "recall-quality"
    ? await client.buildRecallQualityReport(options)
    : kind === "trust"
    ? await client.buildTrustDashboardReport(options)
    : await client.evaluateDashboardAlerts(options);

  return {
    content: `${JSON.stringify({ schemaVersion: "1.0.0", kind, payload }, null, 2)}\n`,
  };
}

async function captureDashboardHtmlScreenshot(
  htmlPath: string,
  screenshotPath: string,
  viewport: { width: number; height: number },
): Promise<string> {
  const runtimeImport = Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<{ chromium?: { launch?: (options?: { headless?: boolean }) => Promise<{
    newPage: (options: { viewportSize: { width: number; height: number } }) => Promise<{
      goto: (url: string, options: { waitUntil: string }) => Promise<void>;
      screenshot: (options: { path: string; fullPage: boolean; type: "png" }) => Promise<void>;
    }>;
    close: () => Promise<void>;
  }> } }>;
  const playwrightModule = await runtimeImport("playwright").catch(() => null);
  if (!playwrightModule || typeof playwrightModule.chromium?.launch !== "function") {
    throw new Error(
      "Dashboard screenshot capture requires the 'playwright' package. Install it or omit --screenshot-output.",
    );
  }

  mkdirSync(dirname(screenshotPath), { recursive: true });
  const browser = await playwrightModule.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewportSize: viewport,
    });
    await page.goto(pathToFileURL(htmlPath).toString(), {
      waitUntil: "networkidle",
    });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "png",
    });
  } finally {
    await browser.close();
  }

  return screenshotPath;
}

function formatTokenRoiCsv(report: Awaited<ReturnType<GlialNodeClient["getTokenUsageReport"]>>): string {
  const rows = [
    [
      "bucket",
      "records",
      "input_tokens",
      "output_tokens",
      "baseline_tokens",
      "actual_context_tokens",
      "glialnode_overhead_tokens",
      "estimated_saved_tokens",
      "estimated_saved_ratio",
      "latency_ms",
      "cost_before",
      "cost_after",
      "cost_saved",
      "recorded_cost",
    ],
    ...report.buckets.map((bucket) => [
      bucket.key,
      String(bucket.totals.recordCount),
      String(bucket.totals.inputTokens),
      String(bucket.totals.outputTokens),
      String(bucket.totals.baselineTokens),
      String(bucket.totals.actualContextTokens),
      String(bucket.totals.glialnodeOverheadTokens),
      String(bucket.totals.estimatedSavedTokens),
      String(bucket.totals.estimatedSavedRatio ?? ""),
      String(bucket.totals.latencyMs),
      String(bucket.totals.costBefore ?? ""),
      String(bucket.totals.costAfter ?? ""),
      String(bucket.totals.costSaved ?? ""),
      String(bucket.totals.recordedCost ?? ""),
    ]),
  ];

  return `${rows.map((row) => row.map(escapeCsvField).join(",")).join("\n")}\n`;
}

function escapeCsvField(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function parseDashboardExportKind(value: string | undefined): DashboardExportKind {
  if (
    value === "dashboard-html" ||
    value === "token-roi" ||
    value === "memory-health" ||
    value === "recall-quality" ||
    value === "trust" ||
    value === "alerts"
  ) {
    return value;
  }
  throw new Error(`Invalid --kind value: ${value ?? ""}`);
}

function parseDashboardExportFormat(value: string | undefined, kind: DashboardExportKind): DashboardExportFormat {
  if (value === undefined) {
    return kind === "dashboard-html" ? "html" : kind === "token-roi" ? "csv" : "json";
  }
  if (value === "html" || value === "json" || value === "csv") {
    return value;
  }
  throw new Error(`Invalid --format value: ${value}`);
}

async function runSpaceCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "create") {
    const name = requireFlag(parsed.flags, "name");
    const timestamp = new Date().toISOString();
    const id = createId("space");
    const preset = parseSpacePreset(parsed.flags.preset);
    const registeredPreset = parsed.flags["preset-local"]
      ? loadRegisteredPreset(parsed.flags["preset-local"], parsed.flags["preset-directory"])
      : undefined;
    const presetDefinition = parsed.flags["preset-file"]
      ? loadPresetDefinitionFromFile(parsed.flags["preset-file"])
      : undefined;
    const channelPreset = parsed.flags["preset-local"] && (
      parsed.flags["preset-channel"] ||
      readPresetChannels(resolvePresetDirectory(parsed.flags["preset-directory"]), parsed.flags["preset-local"]).defaultChannel
    )
      ? resolvePresetChannel(parsed.flags["preset-local"], parsed.flags["preset-channel"], parsed.flags["preset-directory"])
      : undefined;

    await context.repository.createSpace({
      id,
      name,
      description: parsed.flags.description,
      settings: mergeSpaceSettings(
        preset ? getSpacePreset(preset) : undefined,
        channelPreset?.settings,
        registeredPreset?.settings,
        presetDefinition?.settings,
        parseProvenanceFlags(parsed.flags),
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      lines: [
        "Space created.",
        `id=${id}`,
        `name=${name}`,
      ],
    };
  }

  if (action === "list") {
    const spaces = await context.repository.listSpaces();

    return {
      lines: [
        `spaces=${spaces.length}`,
        ...spaces.map((space) => `${space.id} ${space.name}`),
      ],
    };
  }

  if (action === "show") {
    const spaceId = requireFlag(parsed.flags, "id");
    const space = await requireSpace(context.repository, spaceId);
    const policyView = buildSpacePolicyView(space.settings);

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        space,
        policy: policyView,
      });
    }

    return {
      lines: [
        `id=${space.id}`,
        `name=${space.name}`,
        `description=${space.description ?? ""}`,
        `settings=${JSON.stringify(space.settings ?? {})}`,
        `effectiveSettings=${JSON.stringify(policyView.effective)}`,
        `settingsOrigin=${JSON.stringify(policyView.origin)}`,
      ],
    };
  }

  if (action === "configure") {
    const spaceId = requireFlag(parsed.flags, "id");
    const space = await requireSpace(context.repository, spaceId);
    const preset = parseSpacePreset(parsed.flags.preset);
    const registeredPreset = parsed.flags["preset-local"]
      ? loadRegisteredPreset(parsed.flags["preset-local"], parsed.flags["preset-directory"])
      : undefined;
    const presetDefinition = parsed.flags["preset-file"]
      ? loadPresetDefinitionFromFile(parsed.flags["preset-file"])
      : undefined;
    const channelPreset = parsed.flags["preset-local"] && (
      parsed.flags["preset-channel"] ||
      readPresetChannels(resolvePresetDirectory(parsed.flags["preset-directory"]), parsed.flags["preset-local"]).defaultChannel
    )
      ? resolvePresetChannel(parsed.flags["preset-local"], parsed.flags["preset-channel"], parsed.flags["preset-directory"])
      : undefined;
    const settingsFromJson = parsed.flags.settings ? parseSettingsFlag(parsed.flags.settings) : {};
    const settingsFromFlags = mergeSpaceSettings(
      undefined,
      parseCompactionFlags(parsed.flags),
      parseConflictFlags(parsed.flags),
      parseDecayFlags(parsed.flags),
      parseRoutingFlags(parsed.flags),
      parseReinforcementFlags(parsed.flags),
      parseRetentionFlags(parsed.flags),
      parseProvenanceFlags(parsed.flags),
    );
    const mergedSettings = mergeSpaceSettings(
      space.settings,
      preset ? getSpacePreset(preset) : undefined,
      channelPreset?.settings,
      registeredPreset?.settings,
      presetDefinition?.settings,
      settingsFromJson,
      settingsFromFlags,
    );

    await context.repository.createSpace({
      ...space,
      settings: mergedSettings,
      updatedAt: new Date().toISOString(),
    });

    return {
      lines: [
        "Space configured.",
        `id=${space.id}`,
        `settings=${JSON.stringify(mergedSettings)}`,
      ],
    };
  }

  if (action === "report") {
    const spaceId = requireFlag(parsed.flags, "id");
    const space = await requireSpace(context.repository, spaceId);
    const policyView = buildSpacePolicyView(space.settings);
    const report = await context.repository.getSpaceReport(
      spaceId,
      parsed.flags["recent-events"] ? Number(parsed.flags["recent-events"]) : 10,
    );

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        report,
        policy: policyView,
      });
    }

    return {
      lines: [
        `spaceId=${report.spaceId}`,
        `records=${report.recordCount}`,
        `events=${report.eventCount}`,
        `links=${report.linkCount}`,
        `tiers=${formatCounts(report.recordsByTier)}`,
        `statuses=${formatCounts(report.recordsByStatus)}`,
        `kinds=${formatCounts(report.recordsByKind)}`,
        `eventTypes=${formatCounts(report.eventCountsByType)}`,
        `provenanceSummaryRecords=${report.provenanceSummaryCount}`,
        `maintenanceLatestRunAt=${report.maintenance.latestRunAt ?? ""}`,
        `maintenanceLatestCompactionAt=${report.maintenance.latestCompactionAt ?? ""}`,
        `maintenanceLatestRetentionAt=${report.maintenance.latestRetentionAt ?? ""}`,
        `maintenanceLatestDecayAt=${report.maintenance.latestDecayAt ?? ""}`,
        `maintenanceLatestReinforcementAt=${report.maintenance.latestReinforcementAt ?? ""}`,
        `maintenanceCompactionDelta=${JSON.stringify(report.maintenance.latestCompactionDelta ?? {})}`,
        `maintenanceRetentionDelta=${JSON.stringify(report.maintenance.latestRetentionDelta ?? {})}`,
        `maintenanceDecayDelta=${JSON.stringify(report.maintenance.latestDecayDelta ?? {})}`,
        `maintenanceReinforcementDelta=${JSON.stringify(report.maintenance.latestReinforcementDelta ?? {})}`,
        `effectiveSettings=${JSON.stringify(policyView.effective)}`,
        `settingsOrigin=${JSON.stringify(policyView.origin)}`,
        `recentLifecycleEvents=${report.recentLifecycleEvents.length}`,
        ...report.recentLifecycleEvents.map(
          (event) => `${event.id} ${event.type} ${truncate(event.summary, 100)}`,
        ),
        `recentProvenanceEvents=${report.recentProvenanceEvents.length}`,
        ...report.recentProvenanceEvents.map(
          (event) => `${event.id} ${event.type} ${truncate(event.summary, 100)}`,
        ),
      ],
    };
  }

  if (action === "graph-export") {
    const spaceId = requireFlag(parsed.flags, "id");
    const format = parseGraphExportFormat(parsed.flags.format);
    const includeScopes = parsed.flags["include-scopes"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-scopes"])
      : true;
    const includeEvents = parsed.flags["include-events"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-events"])
      : true;
    const client = new GlialNodeClient({ repository: context.repository });
    const graph = await client.exportSpaceGraph(spaceId, { includeScopes, includeEvents });
    const payload = format === "native"
      ? graph
      : format === "cytoscape"
        ? convertSpaceGraphToCytoscape(graph)
        : convertSpaceGraphToDot(graph);

    if (parsed.flags.output) {
      const outputPath = resolve(parsed.flags.output);
      mkdirSync(dirname(outputPath), { recursive: true });
      const outputContents = typeof payload === "string"
        ? payload
        : JSON.stringify(payload, null, 2);
      writeFileSync(outputPath, outputContents, "utf8");

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          output: outputPath,
          format,
          metadata: graph.metadata,
          counts: graph.counts,
        });
      }

      return {
        lines: [
          "Space graph export written.",
          `format=${format}`,
          `spaceId=${graph.metadata.spaceId}`,
          `spaceName=${graph.metadata.spaceName}`,
          `nodes=${graph.metadata.nodeCount}`,
          `edges=${graph.metadata.edgeCount}`,
          `output=${outputPath}`,
        ],
      };
    }

    if (wantsJson(parsed)) {
      if (format === "dot") {
        return jsonResult(parsed, {
          format,
          metadata: graph.metadata,
          counts: graph.counts,
          dot: payload,
        });
      }
      return jsonResult(parsed, payload);
    }

    return {
      lines: format === "dot"
        ? String(payload).split(/\r?\n/)
        : JSON.stringify(payload, null, 2).split(/\r?\n/),
    };
  }

  if (action === "inspect-export") {
    const spaceId = requireFlag(parsed.flags, "id");
    const outputPath = requireFlag(parsed.flags, "output");
    const includeScopes = parsed.flags["include-scopes"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-scopes"])
      : true;
    const includeEvents = parsed.flags["include-events"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-events"])
      : true;
    const includeTrustRegistry = parsed.flags["include-trust-registry"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-trust-registry"])
      : true;
    const recentEventLimit = parsed.flags["recent-events"] !== undefined
      ? Number(parsed.flags["recent-events"])
      : 20;
    if (!Number.isFinite(recentEventLimit) || recentEventLimit <= 0) {
      throw new Error(`Invalid --recent-events value: ${parsed.flags["recent-events"] ?? ""}`);
    }
    const recall = parseInspectorRecallOptions(parsed.flags);

    const client = new GlialNodeClient({ repository: context.repository });
    const result = await client.exportSpaceInspectorHtml(spaceId, outputPath, {
      includeScopes,
      includeEvents,
      includeTrustRegistry,
      recentEventLimit,
      presetDirectory: parsed.flags.directory,
      recall,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        output: result.outputPath,
        space: {
          id: result.snapshot.space.id,
          name: result.snapshot.space.name,
        },
        report: {
          records: result.snapshot.report.recordCount,
          events: result.snapshot.report.eventCount,
          links: result.snapshot.report.linkCount,
        },
        graph: {
          nodes: result.snapshot.graph.metadata.nodeCount,
          edges: result.snapshot.graph.metadata.edgeCount,
        },
        recall: result.snapshot.recall
          ? {
              query: result.snapshot.recall.query,
              traceCount: result.snapshot.recall.traceCount,
            }
          : null,
        trustRegistryIncluded: Boolean(result.snapshot.trustRegistry),
      });
    }

    return {
      lines: [
        "Space inspector export written.",
        `spaceId=${result.snapshot.space.id}`,
        `spaceName=${result.snapshot.space.name}`,
        `records=${result.snapshot.report.recordCount}`,
        `events=${result.snapshot.report.eventCount}`,
        `links=${result.snapshot.report.linkCount}`,
        `graphNodes=${result.snapshot.graph.metadata.nodeCount}`,
        `graphEdges=${result.snapshot.graph.metadata.edgeCount}`,
        `riskLevel=${result.snapshot.risk.riskLevel}`,
        `recallTraceCount=${result.snapshot.recall?.traceCount ?? 0}`,
        `trustRegistryIncluded=${result.snapshot.trustRegistry ? "yes" : "no"}`,
        `output=${result.outputPath}`,
      ],
    };
  }

  if (action === "inspect-snapshot") {
    const spaceId = requireFlag(parsed.flags, "id");
    const outputPath = requireFlag(parsed.flags, "output");
    const includeScopes = parsed.flags["include-scopes"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-scopes"])
      : true;
    const includeEvents = parsed.flags["include-events"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-events"])
      : true;
    const includeTrustRegistry = parsed.flags["include-trust-registry"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-trust-registry"])
      : true;
    const recentEventLimit = parsed.flags["recent-events"] !== undefined
      ? Number(parsed.flags["recent-events"])
      : 20;
    if (!Number.isFinite(recentEventLimit) || recentEventLimit <= 0) {
      throw new Error(`Invalid --recent-events value: ${parsed.flags["recent-events"] ?? ""}`);
    }
    const recall = parseInspectorRecallOptions(parsed.flags);

    const client = new GlialNodeClient({ repository: context.repository });
    const result = await client.exportSpaceInspectorSnapshotToFile(spaceId, outputPath, {
      includeScopes,
      includeEvents,
      includeTrustRegistry,
      recentEventLimit,
      presetDirectory: parsed.flags.directory,
      recall,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        output: result.outputPath,
        space: {
          id: result.snapshot.space.id,
          name: result.snapshot.space.name,
        },
        risk: result.snapshot.risk,
        graph: {
          nodes: result.snapshot.graph.metadata.nodeCount,
          edges: result.snapshot.graph.metadata.edgeCount,
        },
        recall: result.snapshot.recall
          ? {
              query: result.snapshot.recall.query,
              traceCount: result.snapshot.recall.traceCount,
            }
          : null,
      });
    }

    return {
      lines: [
        "Space inspector snapshot written.",
        `spaceId=${result.snapshot.space.id}`,
        `spaceName=${result.snapshot.space.name}`,
        `riskLevel=${result.snapshot.risk.riskLevel}`,
        `graphNodes=${result.snapshot.graph.metadata.nodeCount}`,
        `graphEdges=${result.snapshot.graph.metadata.edgeCount}`,
        `recallTraceCount=${result.snapshot.recall?.traceCount ?? 0}`,
        `output=${result.outputPath}`,
      ],
    };
  }

  if (action === "inspect-index-export") {
    const outputPath = requireFlag(parsed.flags, "output");
    const includeTrustRegistry = parsed.flags["include-trust-registry"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-trust-registry"])
      : true;
    const includeGraphCounts = parsed.flags["include-graph-counts"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-graph-counts"])
      : true;
    const recentEventLimit = parsed.flags["recent-events"] !== undefined
      ? Number(parsed.flags["recent-events"])
      : 10;
    if (!Number.isFinite(recentEventLimit) || recentEventLimit <= 0) {
      throw new Error(`Invalid --recent-events value: ${parsed.flags["recent-events"] ?? ""}`);
    }
    const client = new GlialNodeClient({ repository: context.repository });
    const result = await client.exportSpaceInspectorIndexHtml(outputPath, {
      includeTrustRegistry,
      includeGraphCounts,
      recentEventLimit,
      presetDirectory: parsed.flags.directory,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        output: result.outputPath,
        totals: result.snapshot.totals,
        spaceCount: result.snapshot.metadata.spaceCount,
        trustRegistryIncluded: Boolean(result.snapshot.trustRegistry),
      });
    }

    return {
      lines: [
        "Space inspector index export written.",
        `spaces=${result.snapshot.metadata.spaceCount}`,
        `totalRecords=${result.snapshot.totals.records}`,
        `totalEvents=${result.snapshot.totals.events}`,
        `totalLinks=${result.snapshot.totals.links}`,
        `totalGraphNodes=${result.snapshot.totals.graphNodes}`,
        `totalGraphEdges=${result.snapshot.totals.graphEdges}`,
        `spacesNeedingTrustReview=${result.snapshot.totals.spacesNeedingTrustReview}`,
        `spacesWithContestedMemory=${result.snapshot.totals.spacesWithContestedMemory}`,
        `spacesWithStaleMemory=${result.snapshot.totals.spacesWithStaleMemory}`,
        `trustRegistryIncluded=${result.snapshot.trustRegistry ? "yes" : "no"}`,
        `output=${result.outputPath}`,
      ],
    };
  }

  if (action === "inspect-index-snapshot") {
    const outputPath = requireFlag(parsed.flags, "output");
    const includeTrustRegistry = parsed.flags["include-trust-registry"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-trust-registry"])
      : true;
    const includeGraphCounts = parsed.flags["include-graph-counts"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-graph-counts"])
      : true;
    const recentEventLimit = parsed.flags["recent-events"] !== undefined
      ? Number(parsed.flags["recent-events"])
      : 10;
    if (!Number.isFinite(recentEventLimit) || recentEventLimit <= 0) {
      throw new Error(`Invalid --recent-events value: ${parsed.flags["recent-events"] ?? ""}`);
    }
    const client = new GlialNodeClient({ repository: context.repository });
    const result = await client.exportSpaceInspectorIndexSnapshotToFile(outputPath, {
      includeTrustRegistry,
      includeGraphCounts,
      recentEventLimit,
      presetDirectory: parsed.flags.directory,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        output: result.outputPath,
        totals: result.snapshot.totals,
        spaceCount: result.snapshot.metadata.spaceCount,
        trustRegistryIncluded: Boolean(result.snapshot.trustRegistry),
      });
    }

    return {
      lines: [
        "Space inspector index snapshot written.",
        `spaces=${result.snapshot.metadata.spaceCount}`,
        `totalRecords=${result.snapshot.totals.records}`,
        `totalEvents=${result.snapshot.totals.events}`,
        `totalLinks=${result.snapshot.totals.links}`,
        `totalGraphNodes=${result.snapshot.totals.graphNodes}`,
        `totalGraphEdges=${result.snapshot.totals.graphEdges}`,
        `spacesNeedingTrustReview=${result.snapshot.totals.spacesNeedingTrustReview}`,
        `spacesWithContestedMemory=${result.snapshot.totals.spacesWithContestedMemory}`,
        `spacesWithStaleMemory=${result.snapshot.totals.spacesWithStaleMemory}`,
        `trustRegistryIncluded=${result.snapshot.trustRegistry ? "yes" : "no"}`,
        `output=${result.outputPath}`,
      ],
    };
  }

  if (action === "inspect-pack-export") {
    const outputDirectory = requireFlag(parsed.flags, "output-dir");
    const includeScopes = parsed.flags["include-scopes"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-scopes"])
      : true;
    const includeEvents = parsed.flags["include-events"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-events"])
      : true;
    const includeGraphCounts = parsed.flags["include-graph-counts"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-graph-counts"])
      : true;
    const includeTrustRegistry = parsed.flags["include-trust-registry"] !== undefined
      ? parseOptionalBoolean(parsed.flags["include-trust-registry"])
      : true;
    const captureScreenshots = parsed.flags["capture-screenshots"] !== undefined
      ? parseOptionalBoolean(parsed.flags["capture-screenshots"])
      : false;
    const recentEventLimit = parsed.flags["recent-events"] !== undefined
      ? Number(parsed.flags["recent-events"])
      : 20;
    if (!Number.isFinite(recentEventLimit) || recentEventLimit <= 0) {
      throw new Error(`Invalid --recent-events value: ${parsed.flags["recent-events"] ?? ""}`);
    }
    const recall = parseInspectorRecallOptions(parsed.flags);
    const screenshotWidth = parsePositiveOptionalNumber(parsed.flags["screenshot-width"], "screenshot-width");
    const screenshotHeight = parsePositiveOptionalNumber(parsed.flags["screenshot-height"], "screenshot-height");
    const screenshotViewport = screenshotWidth !== undefined || screenshotHeight !== undefined
      ? {
          width: screenshotWidth ?? 1440,
          height: screenshotHeight ?? 900,
        }
      : undefined;

    const client = new GlialNodeClient({ repository: context.repository });
    const result = await client.exportSpaceInspectorPack(outputDirectory, {
      recentEventLimit,
      includeScopes,
      includeEvents,
      includeGraphCounts,
      includeTrustRegistry,
      presetDirectory: parsed.flags.directory,
      recall,
      captureScreenshots,
      screenshotViewport,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        outputDirectory: result.outputDirectory,
        manifestPath: result.manifestPath,
        spaceCount: result.manifest.metadata.spaceCount,
        screenshotsCaptured: Boolean(result.manifest.files.indexScreenshot),
        totals: result.manifest.totals,
      });
    }

    return {
      lines: [
        "Space inspector pack export written.",
        `outputDirectory=${result.outputDirectory}`,
        `manifest=${result.manifestPath}`,
        `spaces=${result.manifest.metadata.spaceCount}`,
        `screenshotsCaptured=${result.manifest.files.indexScreenshot ? "yes" : "no"}`,
        `totalRecords=${result.manifest.totals.records}`,
        `totalEvents=${result.manifest.totals.events}`,
        `totalLinks=${result.manifest.totals.links}`,
        `spacesNeedingTrustReview=${result.manifest.totals.spacesNeedingTrustReview}`,
        `spacesWithContestedMemory=${result.manifest.totals.spacesWithContestedMemory}`,
        `spacesWithStaleMemory=${result.manifest.totals.spacesWithStaleMemory}`,
      ],
    };
  }

  if (action === "inspect-pack-serve") {
    const inputDirectory = resolve(requireFlag(parsed.flags, "input-dir"));
    const durationMs = parseRequiredPositiveNumber(parsed.flags["duration-ms"], "duration-ms");
    const host = parsed.flags.host ?? "127.0.0.1";
    const requestedPort = parsed.flags.port !== undefined
      ? parsePortNumber(parsed.flags.port)
      : 4173;
    const probePath = parsed.flags["probe-path"];

    const result = await serveInspectorPackDirectory({
      directory: inputDirectory,
      host,
      port: requestedPort,
      durationMs,
      probePath,
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, result);
    }

    return {
      lines: [
        "Space inspector pack served.",
        `directory=${result.directory}`,
        `baseUrl=${result.baseUrl}`,
        `host=${result.host}`,
        `port=${result.port}`,
        `durationMs=${result.durationMs}`,
        `probePath=${result.probePath ?? ""}`,
        `probeStatus=${result.probeStatus ?? ""}`,
      ],
    };
  }

  if (action === "maintain") {
    const spaceId = requireFlag(parsed.flags, "id");
    const shouldApply = parsed.flags.apply === "true";
    const space = await requireSpace(context.repository, spaceId);

    const initialRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const compactionPlan = planCompaction(initialRecords, space.settings?.compaction);
    const simulatedCompactionRecords = shouldApply
      ? initialRecords
      : mergeUpdatedRecords(initialRecords, applyCompactionPlan(compactionPlan));

    let compactionUpdates: MemoryRecord[] = [];
    if (shouldApply) {
      compactionUpdates = applyCompactionPlan(compactionPlan);
      for (const record of compactionUpdates) {
        await context.repository.writeRecord(record);
      }
      for (const record of createCompactionDistilledRecords(compactionPlan)) {
        await context.repository.writeRecord(record);
      }
      for (const event of createCompactionEvents(compactionPlan)) {
        await context.repository.appendEvent(event);
      }
      for (const link of createCompactionDistillationLinks(compactionPlan)) {
        await context.repository.linkRecords(link);
      }
      const summaryRecord = createCompactionSummaryRecord(compactionPlan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createCompactionSummaryLinks(summaryRecord, compactionPlan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const retentionInputRecords = shouldApply
      ? await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : simulatedCompactionRecords;
    const decayPlan = planDecay(retentionInputRecords, space.settings?.decay);

    if (shouldApply) {
      const decayUpdates = applyDecayPlan(decayPlan);
      for (const record of decayUpdates) {
        await context.repository.writeRecord(record);
      }
      for (const event of createDecayEvents(decayPlan)) {
        await context.repository.appendEvent(event);
      }
      const summaryRecord = createDecaySummaryRecord(decayPlan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createDecaySummaryLinks(summaryRecord, decayPlan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const retentionPlan = planRetention(
      shouldApply
        ? await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
        : mergeUpdatedRecords(retentionInputRecords, applyDecayPlan(decayPlan)),
      space.settings?.retentionDays,
    );

    if (shouldApply) {
      const retentionUpdates = applyRetentionPlan(retentionPlan);
      for (const record of retentionUpdates) {
        await context.repository.writeRecord(record);
      }
      for (const event of createRetentionEvents(retentionPlan)) {
        await context.repository.appendEvent(event);
      }
      const summaryRecord = createRetentionSummaryRecord(retentionPlan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, retentionPlan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Maintenance applied." : "Maintenance dry run.",
        "phase=compaction",
        ...summarizeCompactionPlan(compactionPlan),
        "phase=decay",
        ...summarizeDecayPlan(decayPlan),
        "phase=retention",
        ...summarizeRetentionPlan(retentionPlan),
      ],
    };
  }

  return {
    lines: ["Unknown space command.", usageText()],
  };
}

async function runPresetCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "list") {
    const presets = listSpacePresetDefinitions();
    return {
      lines: [
        `presets=${presets.length}`,
        ...presets.map((preset) => `${preset.name} ${preset.summary}`),
      ],
    };
  }

  if (action === "show") {
    const preset = parsed.flags.input
      ? loadPresetDefinitionFromFile(parsed.flags.input)
      : getSpacePresetDefinition(parseRequiredSpacePreset(requireFlag(parsed.flags, "name")));
    return {
      lines: [
        `name=${preset.name}`,
        `summary=${preset.summary}`,
        `version=${preset.version ?? ""}`,
        `author=${preset.author ?? ""}`,
        `source=${preset.source ?? ""}`,
        `createdAt=${preset.createdAt ?? ""}`,
        `updatedAt=${preset.updatedAt ?? ""}`,
        `settings=${JSON.stringify(preset.settings)}`,
      ],
    };
  }

  if (action === "export") {
    const preset = getSpacePresetDefinition(parseRequiredSpacePreset(requireFlag(parsed.flags, "name")));
    const outputPath = resolve(requireFlag(parsed.flags, "output"));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, stringifySpacePresetDefinition(preset), "utf8");

    return {
      lines: [
        "Preset exported.",
        `name=${preset.name}`,
        `output=${outputPath}`,
      ],
    };
  }

  if (action === "diff") {
    const left = resolvePresetReference(requireFlag(parsed.flags, "left"), parsed.flags.directory);
    const right = resolvePresetReference(requireFlag(parsed.flags, "right"), parsed.flags.directory);
    const diff = diffSpacePresetDefinitions(left, right);

    return {
      lines: [
        `left=${diff.left.name}@${diff.left.version ?? ""}`,
        `right=${diff.right.name}@${diff.right.version ?? ""}`,
        `metadataChanges=${diff.metadata.length}`,
        ...diff.metadata.map(
          (change) => `metadata ${change.path}: ${formatDiffValue(change.left)} -> ${formatDiffValue(change.right)}`,
        ),
        `settingChanges=${diff.settings.length}`,
        ...diff.settings.map(
          (change) => `${change.path}: ${formatDiffValue(change.left)} -> ${formatDiffValue(change.right)}`,
        ),
      ],
    };
  }

  if (action === "register") {
    const preset = loadPresetDefinitionFromFile(requireFlag(parsed.flags, "input"));
    const now = new Date().toISOString();
    const registered = {
      ...preset,
      name: parsed.flags.name ?? preset.name,
      author: parsed.flags.author ?? preset.author,
      version: parsed.flags.version ?? preset.version ?? "1.0.0",
      source: requireFlag(parsed.flags, "input"),
      createdAt: preset.createdAt ?? now,
      updatedAt: now,
    };
    const directory = resolvePresetDirectory(parsed.flags.directory);
    mkdirSync(directory, { recursive: true });
    writePresetFiles(directory, registered);
    const outputPath = join(directory, `${toPresetFileName(registered.name)}.json`);

    return {
      lines: [
        "Preset registered.",
        `name=${registered.name}`,
        `output=${outputPath}`,
      ],
    };
  }

  if (action === "local-list") {
    const presets = listRegisteredPresets(parsed.flags.directory);
    return {
      lines: [
        `presets=${presets.length}`,
        ...presets.map((preset) => `${preset.name} ${preset.summary}`),
      ],
    };
  }

  if (action === "local-show") {
    const preset = loadRegisteredPreset(requireFlag(parsed.flags, "name"), parsed.flags.directory);
    return {
      lines: [
        `name=${preset.name}`,
        `summary=${preset.summary}`,
        `version=${preset.version ?? ""}`,
        `author=${preset.author ?? ""}`,
        `source=${preset.source ?? ""}`,
        `createdAt=${preset.createdAt ?? ""}`,
        `updatedAt=${preset.updatedAt ?? ""}`,
        `settings=${JSON.stringify(preset.settings)}`,
      ],
    };
  }

  if (action === "keygen") {
    const name = requireFlag(parsed.flags, "name");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const recordPath = getSigningKeyPath(directory, name);
    if (parsed.flags.overwrite !== "true" && existsSync(recordPath)) {
      throw new Error(`Signing key already exists: ${name}`);
    }

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const timestamp = new Date().toISOString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const record = {
      name,
      algorithm: "ed25519" as const,
      signer: parsed.flags.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeSigningKeyRecord(directory, record);

    return {
      lines: [
        "Signing key generated.",
        `name=${record.name}`,
        `algorithm=${record.algorithm}`,
        `signer=${record.signer ?? ""}`,
        `keyId=${record.keyId}`,
      ],
    };
  }

  if (action === "key-list") {
    const keys = listSigningKeyRecords(resolvePresetDirectory(parsed.flags.directory));
    return {
      lines: [
        `keys=${keys.length}`,
        ...keys.map((record) => `${record.name} ${record.keyId} signer=${record.signer ?? ""}`),
      ],
    };
  }

  if (action === "key-show") {
    const record = readSigningKeyRecord(resolvePresetDirectory(parsed.flags.directory), requireFlag(parsed.flags, "name"));
    return {
      lines: [
        `name=${record.name}`,
        `algorithm=${record.algorithm}`,
        `signer=${record.signer ?? ""}`,
        `keyId=${record.keyId}`,
        `createdAt=${record.createdAt}`,
        `updatedAt=${record.updatedAt}`,
      ],
    };
  }

  if (action === "key-export") {
    const record = readSigningKeyRecord(resolvePresetDirectory(parsed.flags.directory), requireFlag(parsed.flags, "name"));
    const outputPath = resolve(requireFlag(parsed.flags, "output"));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, record.publicKeyPem, "utf8");

    return {
      lines: [
        "Signing public key exported.",
        `name=${record.name}`,
        `output=${outputPath}`,
        `keyId=${record.keyId}`,
      ],
    };
  }

  if (action === "trust-local-key") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const key = readSigningKeyRecord(directory, requireFlag(parsed.flags, "name"));
    const trustName = parsed.flags["trust-name"] ?? key.name;
    const recordPath = getTrustedSignerPath(directory, trustName);
    if (parsed.flags.overwrite !== "true" && existsSync(recordPath)) {
      throw new Error(`Trusted signer already exists: ${trustName}`);
    }

    const timestamp = new Date().toISOString();
    const record = {
      name: trustName,
      algorithm: "ed25519" as const,
      signer: key.signer,
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      source: `signing-key:${key.name}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);

    return {
      lines: [
        "Trusted signer registered from local key.",
        `name=${record.name}`,
        `keyId=${record.keyId}`,
        `signer=${record.signer ?? ""}`,
      ],
    };
  }

  if (action === "trust-register") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const name = requireFlag(parsed.flags, "name");
    const recordPath = getTrustedSignerPath(directory, name);
    if (parsed.flags.overwrite !== "true" && existsSync(recordPath)) {
      throw new Error(`Trusted signer already exists: ${name}`);
    }

    const publicKeyPem = readTextFile(resolve(requireFlag(parsed.flags, "input")));
    const timestamp = new Date().toISOString();
    const record = {
      name,
      algorithm: "ed25519" as const,
      signer: parsed.flags.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      source: parsed.flags.source ?? requireFlag(parsed.flags, "input"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);

    return {
      lines: [
        "Trusted signer registered.",
        `name=${record.name}`,
        `keyId=${record.keyId}`,
        `signer=${record.signer ?? ""}`,
      ],
    };
  }

  if (action === "trust-list") {
    const signers = listTrustedSignerRecords(resolvePresetDirectory(parsed.flags.directory));
    return {
      lines: [
        `trustedSigners=${signers.length}`,
        ...signers.map((record) => `${record.name} ${record.keyId} signer=${record.signer ?? ""}`),
      ],
    };
  }

  if (action === "trust-show") {
    const record = readTrustedSignerRecord(resolvePresetDirectory(parsed.flags.directory), requireFlag(parsed.flags, "name"));
    return {
      lines: [
        `name=${record.name}`,
        `algorithm=${record.algorithm}`,
        `signer=${record.signer ?? ""}`,
        `keyId=${record.keyId}`,
        `source=${record.source ?? ""}`,
        `createdAt=${record.createdAt}`,
        `updatedAt=${record.updatedAt}`,
        `revokedAt=${record.revokedAt ?? ""}`,
        `replacedBy=${record.replacedBy ?? ""}`,
      ],
    };
  }

  if (action === "trust-pack-register") {
    const name = requireFlag(parsed.flags, "name");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const client = new GlialNodeClient({ repository: context.repository, presetDirectory: directory });
    const pack = client.registerTrustPolicyPack(name, {
      description: parsed.flags.description,
      inheritsFrom: parsed.flags.inherits,
      baseProfile: parsed.flags["base-profile"] ? parseTrustProfileFlag(parsed.flags["base-profile"]) : undefined,
      policy: parsePresetTrustPolicy(parsed.flags),
      overwrite: parsed.flags.overwrite === "true",
      directory,
    });

    return {
      lines: [
        "Trust policy pack registered.",
        `name=${pack.name}`,
        `baseProfile=${pack.baseProfile ?? ""}`,
        `inheritsFrom=${pack.inheritsFrom ?? ""}`,
      ],
    };
  }

  if (action === "trust-pack-list") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const client = new GlialNodeClient({ repository: context.repository, presetDirectory: directory });
    const packs = client.listTrustPolicyPacks(directory);

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        count: packs.length,
        packs,
      });
    }

    return {
      lines: [
        `trustPacks=${packs.length}`,
        ...packs.map((pack) => `${pack.name} baseProfile=${pack.baseProfile ?? ""} inheritsFrom=${pack.inheritsFrom ?? ""}`),
      ],
    };
  }

  if (action === "trust-pack-show") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const client = new GlialNodeClient({ repository: context.repository, presetDirectory: directory });
    const pack = client.resolveTrustPolicyPack(requireFlag(parsed.flags, "name"), directory);

    if (wantsJson(parsed)) {
      return jsonResult(parsed, pack);
    }

    return {
      lines: [
        `name=${pack.name}`,
        `baseProfile=${pack.baseProfile ?? ""}`,
        `inheritsFrom=${pack.inheritsFrom ?? ""}`,
        `description=${pack.description ?? ""}`,
        `policy=${JSON.stringify(pack.policy)}`,
        `createdAt=${pack.createdAt}`,
        `updatedAt=${pack.updatedAt}`,
      ],
    };
  }

  if (action === "trust-profile-list") {
    return {
      lines: [
        "profiles=3",
        "permissive requireSigner=false requireSignature=false anchorsOptional=true",
        "signed requireSigner=true requireSignature=true anchorsOptional=true",
        "anchored requireSigner=true requireSignature=true anchorsOptional=false",
      ],
    };
  }

  if (action === "trust-revoke") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const name = requireFlag(parsed.flags, "name");
    const record = readTrustedSignerRecord(directory, name);
    const revoked = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
      replacedBy: parsed.flags["replaced-by"] ?? record.replacedBy,
      updatedAt: new Date().toISOString(),
    };
    writeTrustedSignerRecord(directory, revoked);

    return {
      lines: [
        "Trusted signer revoked.",
        `name=${revoked.name}`,
        `revokedAt=${revoked.revokedAt ?? ""}`,
        `replacedBy=${revoked.replacedBy ?? ""}`,
      ],
    };
  }

  if (action === "trust-rotate") {
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const currentName = requireFlag(parsed.flags, "name");
    const nextName = requireFlag(parsed.flags, "next-name");
    const inputPath = resolve(requireFlag(parsed.flags, "input"));
    const nextPath = getTrustedSignerPath(directory, nextName);
    if (parsed.flags.overwrite !== "true" && existsSync(nextPath)) {
      throw new Error(`Trusted signer already exists: ${nextName}`);
    }

    const publicKeyPem = readTextFile(inputPath);
    const timestamp = new Date().toISOString();
    const nextRecord = {
      name: nextName,
      algorithm: "ed25519" as const,
      signer: parsed.flags.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      source: parsed.flags.source ?? requireFlag(parsed.flags, "input"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, nextRecord);

    const currentRecord = readTrustedSignerRecord(directory, currentName);
    const revoked = {
      ...currentRecord,
      revokedAt: currentRecord.revokedAt ?? timestamp,
      replacedBy: nextName,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, revoked);

    return {
      lines: [
        "Trusted signer rotated.",
        `name=${currentName}`,
        `replacedBy=${nextName}`,
        `keyId=${nextRecord.keyId}`,
      ],
    };
  }

  if (action === "history") {
    const history = listRegisteredPresetHistory(requireFlag(parsed.flags, "name"), parsed.flags.directory);
    return {
      lines: [
        `versions=${history.length}`,
        ...history.map(
          (preset) =>
            `${preset.version ?? ""} updatedAt=${preset.updatedAt ?? ""} source=${preset.source ?? ""} author=${preset.author ?? ""}`,
        ),
      ],
    };
  }

  if (action === "rollback") {
    const name = requireFlag(parsed.flags, "name");
    const version = requireFlag(parsed.flags, "to-version");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const target = requirePresetHistoryVersion(listRegisteredPresetHistory(name, directory), name, version);
    const rolledBack = {
      ...target,
      name,
      author: parsed.flags.author ?? target.author,
      source: `rollback:${version}`,
      updatedAt: new Date().toISOString(),
    };
    mkdirSync(directory, { recursive: true });
    writePresetFiles(directory, rolledBack);

    return {
      lines: [
        "Preset rolled back.",
        `name=${rolledBack.name}`,
        `version=${rolledBack.version ?? ""}`,
        `source=${rolledBack.source ?? ""}`,
      ],
    };
  }

  if (action === "promote") {
    const name = requireFlag(parsed.flags, "name");
    const channel = requireFlag(parsed.flags, "channel");
    const version = requireFlag(parsed.flags, "version");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    requirePresetHistoryVersion(listRegisteredPresetHistory(name, directory), name, version);
    const current = readPresetChannels(directory, name);
    const next = {
      ...current,
      name,
      channels: {
        ...current.channels,
        [channel]: version,
      },
    };
    writePresetChannels(directory, next);

    return {
      lines: [
        "Preset promoted.",
        `name=${name}`,
        `channel=${channel}`,
        `version=${version}`,
      ],
    };
  }

  if (action === "channel-default") {
    const name = requireFlag(parsed.flags, "name");
    const channel = requireFlag(parsed.flags, "channel");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const current = readPresetChannels(directory, name);
    if (!current.channels[channel]) {
      throw new Error(`Unknown preset channel for ${name}: ${channel}`);
    }
    const next = {
      ...current,
      defaultChannel: channel,
    };
    writePresetChannels(directory, next);

    return {
      lines: [
        "Preset default channel set.",
        `name=${name}`,
        `defaultChannel=${channel}`,
      ],
    };
  }

  if (action === "channel-export") {
    const name = requireFlag(parsed.flags, "name");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const state = readPresetChannels(directory, name);
    const outputPath = resolve(requireFlag(parsed.flags, "output"));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(state, null, 2), "utf8");

    return {
      lines: [
        "Preset channels exported.",
        `name=${name}`,
        `output=${outputPath}`,
      ],
    };
  }

  if (action === "channel-import") {
    const inputPath = resolve(requireFlag(parsed.flags, "input"));
    const imported = parsePresetChannelState(readTextFile(inputPath));
    const state = {
      ...imported,
      name: parsed.flags.name ?? imported.name,
    };
    const directory = resolvePresetDirectory(parsed.flags.directory);
    writePresetChannels(directory, state);

    return {
      lines: [
        "Preset channels imported.",
        `name=${state.name}`,
        `channels=${Object.keys(state.channels).length}`,
        `defaultChannel=${state.defaultChannel ?? ""}`,
      ],
    };
  }

  if (action === "bundle-export") {
    const name = requireFlag(parsed.flags, "name");
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const signingKey = parsed.flags["signing-key"]
      ? readSigningKeyRecord(directory, parsed.flags["signing-key"])
      : undefined;
    const signingPrivateKeyPem = parsed.flags["signing-private-key"]
      ? readTextFile(resolve(parsed.flags["signing-private-key"]))
      : signingKey?.privateKeyPem;
    const signingPublicKeyPem = signingPrivateKeyPem
      ? (parsed.flags["signing-public-key"]
          ? readTextFile(resolve(parsed.flags["signing-public-key"]))
          : signingKey?.publicKeyPem ?? createPublicKey(createPrivateKey(signingPrivateKeyPem)).export({ type: "spki", format: "pem" }).toString())
      : undefined;
    const bundle: ReturnType<typeof parsePresetBundle> = {
      metadata: {
        bundleFormatVersion: PRESET_BUNDLE_FORMAT_VERSION,
        glialnodeVersion: GLIALNODE_VERSION,
        nodeEngine: GLIALNODE_NODE_ENGINE,
        origin: parsed.flags.origin,
        signer: parsed.flags.signer ?? signingKey?.signer,
        checksumAlgorithm: "sha256" as const,
        checksum: "",
        signatureAlgorithm: signingPublicKeyPem ? "ed25519" as const : undefined,
        signerKeyId: signingPublicKeyPem ? computeSignerKeyId(signingPublicKeyPem) : undefined,
        signerPublicKey: signingPublicKeyPem,
        signature: undefined,
      },
      exportedAt: new Date().toISOString(),
      preset: loadRegisteredPreset(name, directory),
      history: listRegisteredPresetHistory(name, directory),
      channels: readPresetChannels(directory, name),
    };
    bundle.metadata.checksum = computePresetBundleChecksum(bundle);
    if (signingPrivateKeyPem) {
      bundle.metadata.signature = computePresetBundleSignature(bundle, signingPrivateKeyPem);
    }
    const outputPath = resolve(requireFlag(parsed.flags, "output"));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(bundle, null, 2), "utf8");

    return {
      lines: [
        "Preset bundle exported.",
        `name=${name}`,
        `output=${outputPath}`,
        `versions=${bundle.history.length}`,
        `checksum=${bundle.metadata.checksum}`,
        `signed=${Boolean(bundle.metadata.signature)}`,
      ],
    };
  }

  if (action === "bundle-import") {
    const inputPath = resolve(requireFlag(parsed.flags, "input"));
    const imported = parsePresetBundle(readTextFile(inputPath));
    const requestedName = parsed.flags.name ?? imported.preset.name;
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const collisionPolicy = parseImportCollisionPolicy(parsed.flags.collision);
    const space = parsed.flags["space-id"]
      ? await requireSpace(context.repository, parsed.flags["space-id"])
      : undefined;
    const provenanceSettings = space?.settings?.provenance;
    const directoryClient = new GlialNodeClient({ repository: context.repository, presetDirectory: directory });
    const trustPack = resolveTrustPolicyPackFromFlags(directoryClient, parsed, directory);
    const trustProfile = parseTrustProfileFlag(parsed.flags["trust-profile"] ?? provenanceSettings?.trustProfile ?? trustPack?.baseProfile);
    const mergedTrustPolicy = mergePresetTrustPolicyFromSettings(parsePresetTrustPolicy(parsed.flags), provenanceSettings);
    const effectiveTrustPolicy = mergePresetTrustPolicy(toPresetTrustPolicyInput(trustPack?.policy), mergedTrustPolicy);
    const validation = validatePresetBundle(
      imported,
      resolvePresetTrustPolicy(
        effectiveTrustPolicy,
        directory,
        trustProfile,
      ),
      trustProfile,
    );
    const client = new GlialNodeClient({ repository: context.repository });
    const stored = client.importPresetBundle(inputPath, {
      directory,
      name: requestedName,
      trustPolicy: effectiveTrustPolicy,
      trustProfile,
      collisionPolicy,
    });
    const importedPresetName = stored.preset.name;

    if (space) {
      await ensureSpaceAuditScope(context.repository, space.id);
      const event = createPresetBundleAuditEvent(space.id, "bundle_imported", `Imported preset bundle ${importedPresetName}.`, {
        bundleName: imported.preset.name,
        importedPresetName,
        trusted: validation.trusted,
        trustProfile: validation.report.trustProfile,
        signer: validation.metadata.signer,
        signerKeyId: validation.report.signerKeyId,
        origin: validation.metadata.origin,
        matchedTrustedSignerNames: validation.report.matchedTrustedSignerNames,
        warnings: validation.warnings,
      });
      await context.repository.appendEvent(event);
      await context.repository.writeRecord(createPresetBundleAuditSummaryRecord(space.id, event));
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        importedPresetName,
        requestedPresetName: requestedName,
        bundleName: imported.preset.name,
        collisionPolicy,
        versions: stored.history.length,
        defaultChannel: stored.channels.defaultChannel,
        trusted: validation.trusted,
        validation,
      });
    }

    return {
      lines: [
        "Preset bundle imported.",
        `name=${importedPresetName}`,
        `requestedName=${requestedName}`,
        `collisionPolicy=${collisionPolicy}`,
        `versions=${stored.history.length}`,
        `defaultChannel=${stored.channels.defaultChannel ?? ""}`,
        `trusted=${validation.trusted}`,
        ...validation.warnings.map((warning) => `warning=${warning}`),
      ],
    };
  }

  if (action === "bundle-show") {
    const inputPath = resolve(requireFlag(parsed.flags, "input"));
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const trustExplain = parsed.flags["trust-explain"] === "true";
    const space = parsed.flags["space-id"]
      ? await requireSpace(context.repository, parsed.flags["space-id"])
      : undefined;
    const provenanceSettings = space?.settings?.provenance;
    const bundle = parsePresetBundle(readTextFile(inputPath));
    const directoryClient = new GlialNodeClient({ repository: context.repository, presetDirectory: directory });
    const trustPack = resolveTrustPolicyPackFromFlags(directoryClient, parsed, directory);
    const trustProfile = parseTrustProfileFlag(parsed.flags["trust-profile"] ?? provenanceSettings?.trustProfile ?? trustPack?.baseProfile);
    const mergedTrustPolicy = mergePresetTrustPolicyFromSettings(parsePresetTrustPolicy(parsed.flags), provenanceSettings);
    const effectiveTrustPolicy = mergePresetTrustPolicy(toPresetTrustPolicyInput(trustPack?.policy), mergedTrustPolicy);
    let resolvedTrustPolicy: ResolvedPresetTrustPolicy;
    try {
      resolvedTrustPolicy = resolvePresetTrustPolicy(effectiveTrustPolicy, directory, trustProfile);
    } catch (error) {
      if (!trustExplain) {
        throw error;
      }

      const failures = extractTrustFailureMessages(error);
      const failedValidation = buildFailedPresetBundleValidationReport(bundle, effectiveTrustPolicy, trustProfile, failures);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          bundle,
          validation: failedValidation,
        });
      }

      return {
        lines: [
          `name=${bundle.preset.name}`,
          `trusted=false`,
          `trustProfile=${trustProfile}`,
          `effectivePolicy=${JSON.stringify(effectiveTrustPolicy)}`,
          `requestedTrustedSigners=${failedValidation.report.requestedTrustedSignerNames.join(",")}`,
          `unmatchedTrustedSigners=${failedValidation.report.unmatchedTrustedSignerNames.join(",")}`,
          `policyFailures=${failedValidation.report.policyFailures.length}`,
          ...failedValidation.report.policyFailures.map((failure) => `policyFailure=${failure}`),
        ],
      };
    }

    let validation: ReturnType<typeof validatePresetBundle>;
    try {
      validation = validatePresetBundle(bundle, resolvedTrustPolicy, trustProfile);
    } catch (error) {
      if (!trustExplain) {
        throw error;
      }

      const failures = extractTrustFailureMessages(error);
      const failedValidation = buildFailedPresetBundleValidationReport(bundle, resolvedTrustPolicy, trustProfile, failures);

      if (wantsJson(parsed)) {
        return jsonResult(parsed, {
          bundle,
          validation: failedValidation,
        });
      }

      return {
        lines: [
          `name=${bundle.preset.name}`,
          `trusted=false`,
          `trustProfile=${trustProfile}`,
          `reportSignerKeyId=${failedValidation.report.signerKeyId ?? ""}`,
          `matchedTrustedSigners=${failedValidation.report.matchedTrustedSignerNames.join(",")}`,
          `requestedTrustedSigners=${failedValidation.report.requestedTrustedSignerNames.join(",")}`,
          `unmatchedTrustedSigners=${failedValidation.report.unmatchedTrustedSignerNames.join(",")}`,
          `effectivePolicy=${JSON.stringify(failedValidation.report.effectivePolicy)}`,
          `policyFailures=${failedValidation.report.policyFailures.length}`,
          ...failedValidation.report.policyFailures.map((failure) => `policyFailure=${failure}`),
        ],
      };
    }

    if (space) {
      await ensureSpaceAuditScope(context.repository, space.id);
      const event = createPresetBundleAuditEvent(space.id, "bundle_reviewed", `Reviewed preset bundle ${bundle.preset.name}.`, {
        bundleName: bundle.preset.name,
        trusted: validation.trusted,
        trustProfile: validation.report.trustProfile,
        signer: validation.metadata.signer,
        signerKeyId: validation.report.signerKeyId,
        origin: validation.metadata.origin,
        matchedTrustedSignerNames: validation.report.matchedTrustedSignerNames,
        warnings: validation.warnings,
      });
      await context.repository.appendEvent(event);
      await context.repository.writeRecord(createPresetBundleAuditSummaryRecord(space.id, event));
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        bundle,
        validation,
      });
    }

    return {
      lines: [
        `name=${bundle.preset.name}`,
        `bundleFormatVersion=${bundle.metadata.bundleFormatVersion}`,
        `glialnodeVersion=${bundle.metadata.glialnodeVersion}`,
        `nodeEngine=${bundle.metadata.nodeEngine}`,
        `origin=${bundle.metadata.origin ?? ""}`,
        `signer=${bundle.metadata.signer ?? ""}`,
        `checksumAlgorithm=${bundle.metadata.checksumAlgorithm}`,
        `checksum=${bundle.metadata.checksum}`,
        `signatureAlgorithm=${bundle.metadata.signatureAlgorithm ?? ""}`,
        `signerKeyId=${bundle.metadata.signerKeyId ?? ""}`,
        `signed=${Boolean(bundle.metadata.signature)}`,
        `versions=${bundle.history.length}`,
        `defaultChannel=${bundle.channels.defaultChannel ?? ""}`,
        `trusted=${validation.trusted}`,
        `trustProfile=${validation.report.trustProfile}`,
        `reportSignerKeyId=${validation.report.signerKeyId ?? ""}`,
        `matchedTrustedSigners=${validation.report.matchedTrustedSignerNames.join(",")}`,
        `requestedTrustedSigners=${validation.report.requestedTrustedSignerNames.join(",")}`,
        `unmatchedTrustedSigners=${validation.report.unmatchedTrustedSignerNames.join(",")}`,
        `revokedTrustedSigners=${validation.report.revokedTrustedSignerNames.join(",")}`,
        `effectivePolicy=${JSON.stringify(validation.report.effectivePolicy)}`,
        `policyFailures=${validation.report.policyFailures.length}`,
        `warnings=${validation.warnings.length}`,
        ...validation.warnings.map((warning) => `warning=${warning}`),
      ],
    };
  }

  if (action === "channel-list") {
    const state = readPresetChannels(resolvePresetDirectory(parsed.flags.directory), requireFlag(parsed.flags, "name"));
    return {
      lines: [
        `channels=${Object.keys(state.channels).length}`,
        `defaultChannel=${state.defaultChannel ?? ""}`,
        ...Object.entries(state.channels)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([channel, version]) => `${channel}=${version}`),
      ],
    };
  }

  if (action === "channel-show") {
    const name = requireFlag(parsed.flags, "name");
    const channel = parsed.flags.channel;
    const directory = resolvePresetDirectory(parsed.flags.directory);
    const state = readPresetChannels(directory, name);
    const resolvedChannel = channel ?? state.defaultChannel;
    if (!resolvedChannel) {
      throw new Error(`No preset channel selected for ${name}.`);
    }
    const version = state.channels[resolvedChannel];
    if (!version) {
      throw new Error(`Unknown preset channel for ${name}: ${resolvedChannel}`);
    }
    const preset = requirePresetHistoryVersion(listRegisteredPresetHistory(name, directory), name, version);

    return {
      lines: [
        `name=${preset.name}`,
        `channel=${resolvedChannel}`,
        `version=${preset.version ?? ""}`,
        `author=${preset.author ?? ""}`,
        `source=${preset.source ?? ""}`,
        `settings=${JSON.stringify(preset.settings)}`,
      ],
    };
  }

  return {
    lines: ["Unknown preset command.", usageText()],
  };
}

async function runScopeCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const type = requireScopeType(parsed.flags["type"]);
    const timestamp = new Date().toISOString();
    const id = createId("scope");

    await context.repository.upsertScope({
      id,
      spaceId,
      type,
      externalId: parsed.flags["external-id"],
      label: parsed.flags.label,
      parentScopeId: parsed.flags["parent-scope-id"],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      lines: [
        "Scope added.",
        `id=${id}`,
        `spaceId=${spaceId}`,
        `type=${type}`,
      ],
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const scopes = await context.repository.listScopes(spaceId);

    return {
      lines: [
        `scopes=${scopes.length}`,
        ...scopes.map((scope) => `${scope.id} ${scope.type}${scope.label ? ` ${scope.label}` : ""}`),
      ],
    };
  }

  return {
    lines: ["Unknown scope command.", usageText()],
  };
}

async function runMemoryCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "semantic-eval") {
    const corpusPath = requireFlag(parsed.flags, "corpus");
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as SemanticEvalCorpus;
    const report = evaluateSemanticPrototypeCorpus(corpus, {
      semanticWeight: parsed.flags["semantic-weight"] !== undefined
        ? parseOptionalNumber(parsed.flags["semantic-weight"])
        : undefined,
      minDeltaTop1Accuracy: parsed.flags["min-delta-top1"] !== undefined
        ? parseOptionalNumber(parsed.flags["min-delta-top1"])
        : undefined,
    });

    if (parsed.flags.output) {
      writeJsonFileAtomic(parsed.flags.output, JSON.stringify(report, null, 2));
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, report);
    }

    return {
      lines: [
        `reportId=${report.reportId}`,
        `generatedAt=${report.generatedAt}`,
        `corpusVersion=${report.corpus.version}`,
        `scenarios=${report.corpus.scenarioCount}`,
        `scoredScenarios=${report.corpus.scoredScenarioCount}`,
        `semanticWeight=${report.semantic.semanticWeight}`,
        `lexicalTop1Accuracy=${report.metrics.lexicalTop1Accuracy.toFixed(3)}`,
        `semanticTop1Accuracy=${report.metrics.semanticTop1Accuracy.toFixed(3)}`,
        `deltaTop1Accuracy=${report.metrics.deltaTop1Accuracy.toFixed(3)}`,
        `minDeltaTop1Accuracy=${report.passCriteria.minDeltaTop1Accuracy.toFixed(3)}`,
        `passed=${report.passed ? "yes" : "no"}`,
        `gateReason=${report.gate.reason}`,
        ...(parsed.flags.output ? [`output=${parsed.flags.output}`] : []),
      ],
    };
  }

  if (action === "add") {
    const input = createMemoryInput(parsed);
    const space = await requireSpace(context.repository, input.spaceId);
    const record = createMemoryRecord(input);

    await context.repository.writeRecord(record);

    const existingRecords = await context.repository.listRecords(input.spaceId, Number.MAX_SAFE_INTEGER);
    const conflicts = detectConflicts(record, existingRecords, space.settings?.conflict);

    for (const action of conflicts) {
      await context.repository.writeRecord(action.updatedConflictingRecord);
    }

    for (const link of createConflictLinks(conflicts)) {
      await context.repository.linkRecords(link);
    }

    for (const event of createConflictEvents(conflicts)) {
      await context.repository.appendEvent(event);
    }

    return {
      lines: [
        "Memory record added.",
        `id=${record.id}`,
        `tier=${record.tier}`,
        `kind=${record.kind}`,
        `conflicts=${conflicts.length}`,
      ],
    };
  }

  if (action === "search") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    let records = await context.repository.searchRecords({
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    });
    records = applySemanticPrototypeRerankFromFlags(records, parsed.flags.text, parsed.flags);

    if (parsed.flags.reinforce === "true" && records.length > 0) {
      const space = await requireSpace(context.repository, spaceId);
      const availableRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
      const reinforceLimit = parsed.flags["reinforce-limit"]
        ? Number(parsed.flags["reinforce-limit"])
        : records.length;
      const plan = planReinforcement(availableRecords, space.settings?.reinforcement, {
        recordIds: records.slice(0, Math.max(reinforceLimit, 0)).map((record) => record.id),
        strength: parseOptionalNumber(parsed.flags["reinforce-strength"]),
        reason: parsed.flags["reinforce-reason"] ?? "successful-retrieval",
      });

      for (const updatedRecord of applyReinforcementPlan(plan)) {
        await context.repository.writeRecord(updatedRecord);
      }

      for (const event of createReinforcementEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createReinforcementSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        query: {
          spaceId,
          text: parsed.flags.text,
          scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
          tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
          kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
          visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
          statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
          limit: parsed.flags.limit ? Number(parsed.flags.limit) : 10,
          semantic: parseSemanticPrototypeOptions(parsed.flags),
        },
        count: records.length,
        records,
      });
    }

    return {
      lines: [
        `records=${records.length}`,
        ...records.map(
          (record) =>
            `${record.id} ${record.tier} ${record.kind} ${truncate(record.summary ?? record.content, 80)}`,
        ),
      ],
    };
  }

  if (action === "recall") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const query = {
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 3,
    };
    let records = await context.repository.searchRecords(query);
    records = applySemanticPrototypeRerankFromFlags(records, parsed.flags.text, parsed.flags);

    if (parsed.flags.reinforce === "true" && records.length > 0) {
      const space = await requireSpace(context.repository, spaceId);
      const availableRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
      const reinforceLimit = parsed.flags["reinforce-limit"]
        ? Number(parsed.flags["reinforce-limit"])
        : records.length;
      const plan = planReinforcement(availableRecords, space.settings?.reinforcement, {
        recordIds: records.slice(0, Math.max(reinforceLimit, 0)).map((record) => record.id),
        strength: parseOptionalNumber(parsed.flags["reinforce-strength"]),
        reason: parsed.flags["reinforce-reason"] ?? "successful-retrieval",
      });

      for (const updatedRecord of applyReinforcementPlan(plan)) {
        await context.repository.writeRecord(updatedRecord);
      }

      for (const event of createReinforcementEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createReinforcementSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const allRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const packs = [];
    for (const primary of records) {
      const links = await context.repository.listLinksForRecord(primary.id);
      const pack = buildRecallPack(primary, allRecords, links, {
        queryText: parsed.flags.text,
        supportLimit: parsed.flags["support-limit"] ? Number(parsed.flags["support-limit"]) : 3,
      });
      packs.push(pack);
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        query: {
          ...query,
          semantic: parseSemanticPrototypeOptions(parsed.flags),
        },
        count: packs.length,
        packs,
      });
    }

    const lines = [`packs=${packs.length}`];
    for (const pack of packs) {
      lines.push(
        `primary=${pack.primary.id} ${pack.primary.tier} ${pack.primary.kind} ${truncate(pack.primary.summary ?? pack.primary.content, 80)}`,
      );

      for (const support of pack.supporting) {
        lines.push(
          `support=${support.id} ${support.tier} ${support.kind} ${truncate(support.summary ?? support.content, 80)}`,
        );
      }

      lines.push(`links=${pack.links.length}`);
    }

    return { lines };
  }

  if (action === "trace") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const query = {
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 3,
    };
    let records = await context.repository.searchRecords(query);
    records = applySemanticPrototypeRerankFromFlags(records, parsed.flags.text, parsed.flags);

    if (parsed.flags.reinforce === "true" && records.length > 0) {
      const space = await requireSpace(context.repository, spaceId);
      const availableRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
      const reinforceLimit = parsed.flags["reinforce-limit"]
        ? Number(parsed.flags["reinforce-limit"])
        : records.length;
      const plan = planReinforcement(availableRecords, space.settings?.reinforcement, {
        recordIds: records.slice(0, Math.max(reinforceLimit, 0)).map((record) => record.id),
        strength: parseOptionalNumber(parsed.flags["reinforce-strength"]),
        reason: parsed.flags["reinforce-reason"] ?? "successful-retrieval",
      });

      for (const updatedRecord of applyReinforcementPlan(plan)) {
        await context.repository.writeRecord(updatedRecord);
      }

      for (const event of createReinforcementEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createReinforcementSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const allRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const traces = [];
    for (const primary of records) {
      const links = await context.repository.listLinksForRecord(primary.id);
      const pack = buildRecallPack(primary, allRecords, links, {
        queryText: parsed.flags.text,
        supportLimit: parsed.flags["support-limit"] ? Number(parsed.flags["support-limit"]) : 3,
      });
      traces.push(buildRecallTrace(pack, parsed.flags.text));
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        query: {
          ...query,
          semantic: parseSemanticPrototypeOptions(parsed.flags),
        },
        count: traces.length,
        traces,
      });
    }

    const lines = [`traces=${traces.length}`];
    for (const trace of traces) {
      lines.push(`summary=${trace.summary}`);
      for (const citation of trace.citations) {
        lines.push(
          `cite=${citation.role}:${citation.recordId}${citation.relation ? `:${citation.relation}` : ""} reason=${citation.reason} excerpt=${truncate(citation.excerpt, 80)}`,
        );
      }
    }

    return { lines };
  }

  if (action === "bundle") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const query = {
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 3,
    };
    let records = await context.repository.searchRecords(query);
    records = applySemanticPrototypeRerankFromFlags(records, parsed.flags.text, parsed.flags);

    if (parsed.flags.reinforce === "true" && records.length > 0) {
      const availableRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
      const reinforceLimit = parsed.flags["reinforce-limit"]
        ? Number(parsed.flags["reinforce-limit"])
        : records.length;
      const plan = planReinforcement(availableRecords, space.settings?.reinforcement, {
        recordIds: records.slice(0, Math.max(reinforceLimit, 0)).map((record) => record.id),
        strength: parseOptionalNumber(parsed.flags["reinforce-strength"]),
        reason: parsed.flags["reinforce-reason"] ?? "successful-retrieval",
      });

      for (const updatedRecord of applyReinforcementPlan(plan)) {
        await context.repository.writeRecord(updatedRecord);
      }

      for (const event of createReinforcementEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createReinforcementSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const allRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const bundles = [];
    for (const primary of records) {
      const links = await context.repository.listLinksForRecord(primary.id);
      const pack = buildRecallPack(primary, allRecords, links, {
        queryText: parsed.flags.text,
        supportLimit: parsed.flags["support-limit"] ? Number(parsed.flags["support-limit"]) : 3,
      });
      bundles.push(buildMemoryBundle(pack, {
        queryText: parsed.flags.text,
        profile: parseBundleProfile(parsed.flags["bundle-profile"]),
        consumer: parseBundleConsumer(parsed.flags["bundle-consumer"]),
        provenanceMode: parseBundleProvenanceMode(parsed.flags["bundle-provenance-mode"]),
        routingPolicy: space.settings?.routing,
        maxSupporting: parseOptionalNumber(parsed.flags["bundle-max-supporting"]),
        maxContentChars: parseOptionalNumber(parsed.flags["bundle-max-content-chars"]),
        preferCompact: parsed.flags["bundle-prefer-compact"] !== undefined
          ? parseOptionalBoolean(parsed.flags["bundle-prefer-compact"])
          : undefined,
      }));
    }

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        query: {
          ...query,
          semantic: parseSemanticPrototypeOptions(parsed.flags),
        },
        count: bundles.length,
        bundles,
      });
    }

    return {
      lines: JSON.stringify(bundles, null, 2).split(/\r?\n/),
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const records = await context.repository.listRecords(
      spaceId,
      parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    );

    return {
      lines: [
        `records=${records.length}`,
        ...records.map(
          (record) =>
            `${record.id} ${record.tier} ${record.kind} ${record.status} ${truncate(record.summary ?? record.content, 80)}`,
        ),
      ],
    };
  }

  if (action === "promote") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const promoted = promoteRecord(record);

    await context.repository.writeRecord(promoted);

    return {
      lines: [
        "Memory record promoted.",
        `id=${promoted.id}`,
        `tier=${promoted.tier}`,
      ],
    };
  }

  if (action === "archive") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const archived = updateRecordStatus(record, "archived");

    await context.repository.writeRecord(archived);

    return {
      lines: [
        "Memory record archived.",
        `id=${archived.id}`,
        `status=${archived.status}`,
      ],
    };
  }

  if (action === "show") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const links = await context.repository.listLinksForRecord(recordId);

    return {
      lines: [
        `id=${record.id}`,
        `spaceId=${record.spaceId}`,
        `scopeId=${record.scope.id}`,
        `scopeType=${record.scope.type}`,
        `tier=${record.tier}`,
        `kind=${record.kind}`,
        `status=${record.status}`,
        `visibility=${record.visibility}`,
        `tags=${record.tags.join(",")}`,
        `summary=${record.summary ?? ""}`,
        `compactContent=${record.compactContent ?? ""}`,
        `compactSource=${record.compactSource ?? ""}`,
        `content=${record.content}`,
        `links=${links.length}`,
        ...links.map((link) => `${link.id} ${link.type} ${link.fromRecordId} -> ${link.toRecordId}`),
      ],
    };
  }

  if (action === "compact") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planCompaction(records, space.settings?.compaction);
    const shouldApply = parsed.flags.apply === "true";

    if (shouldApply) {
      const updates = applyCompactionPlan(plan);

      for (const record of updates) {
        await context.repository.writeRecord(record);
      }

      for (const record of createCompactionDistilledRecords(plan)) {
        await context.repository.writeRecord(record);
      }

      const events = createCompactionEvents(plan);
      for (const event of events) {
        await context.repository.appendEvent(event);
      }

      for (const link of createCompactionDistillationLinks(plan)) {
        await context.repository.linkRecords(link);
      }

      const summaryRecord = createCompactionSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);

        for (const link of createCompactionSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Compaction applied." : "Compaction dry run.",
        ...summarizeCompactionPlan(plan),
      ],
    };
  }

  if (action === "retain") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planRetention(records, space.settings?.retentionDays);
    const shouldApply = parsed.flags.apply === "true";

    if (shouldApply) {
      const updates = applyRetentionPlan(plan);
      for (const record of updates) {
        await context.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createRetentionSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Retention applied." : "Retention dry run.",
        ...summarizeRetentionPlan(plan),
      ],
    };
  }

  if (action === "decay") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planDecay(records, space.settings?.decay);
    const shouldApply = parsed.flags.apply === "true";

    if (shouldApply) {
      for (const record of applyDecayPlan(plan)) {
        await context.repository.writeRecord(record);
      }

      for (const event of createDecayEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createDecaySummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createDecaySummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Decay applied." : "Decay dry run.",
        ...summarizeDecayPlan(plan),
      ],
    };
  }

  if (action === "reinforce") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const space = await requireSpace(context.repository, record.spaceId);
    const records = await context.repository.listRecords(record.spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planReinforcement(records, space.settings?.reinforcement, {
      recordIds: [recordId],
      strength: parseOptionalNumber(parsed.flags.strength),
      reason: parsed.flags.reason,
    });

    for (const updatedRecord of applyReinforcementPlan(plan)) {
      await context.repository.writeRecord(updatedRecord);
    }

    for (const event of createReinforcementEvents(plan)) {
      await context.repository.appendEvent(event);
    }

    const summaryRecord = createReinforcementSummaryRecord(plan);
    if (summaryRecord) {
      await context.repository.writeRecord(summaryRecord);
      for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
        await context.repository.linkRecords(link);
      }
    }

    return {
      lines: [
        "Reinforcement applied.",
        ...summarizeReinforcementPlan(plan),
      ],
    };
  }

  if (action === "learn-plan") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const events = await context.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER);
    const links = await context.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planLearningLoop(records, events, links, {
      policy: parseLearningLoopPolicyFlags(parsed.flags),
    });

    if (wantsJson(parsed)) {
      return jsonResult(parsed, {
        spaceId,
        plan,
      });
    }

    return {
      lines: [
        "Learning loop plan.",
        `recordsReviewed=${plan.summary.recordsReviewed}`,
        `suggestions=${plan.summary.suggestions}`,
        `reinforcementCandidates=${plan.summary.reinforcementCandidates}`,
        `contradictionCandidates=${plan.summary.contradictionCandidates}`,
        ...plan.suggestions.map((suggestion) =>
          `suggestion=${suggestion.type} priority=${suggestion.priority} record=${suggestion.recordId}${suggestion.relatedRecordId ? ` related=${suggestion.relatedRecordId}` : ""} action=${suggestion.recommendedAction} reason=${suggestion.reason}`,
        ),
      ],
    };
  }

  return {
    lines: ["Unknown memory command.", usageText()],
  };
}

async function runEventCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const timestamp = new Date().toISOString();
    const event = {
      id: createId("evt"),
      spaceId: requireFlag(parsed.flags, "space-id"),
      scope: {
        id: requireFlag(parsed.flags, "scope-id"),
        type: requireScopeType(parsed.flags["scope-type"]),
      },
      actorType: requireActorType(parsed.flags["actor-type"]),
      actorId: requireFlag(parsed.flags, "actor-id"),
      type: requireEventType(parsed.flags["event-type"]),
      summary: requireFlag(parsed.flags, "summary"),
      payload: parsed.flags.payload ? parseJsonFlag(parsed.flags.payload) : undefined,
      createdAt: timestamp,
    };

    await context.repository.appendEvent(event);

    return {
      lines: [
        "Event added.",
        `id=${event.id}`,
        `type=${event.type}`,
      ],
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const events = await context.repository.listEvents(
      spaceId,
      parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    );

    return {
      lines: [
        `events=${events.length}`,
        ...events.map(
          (event) =>
            `${event.id} ${event.type} ${event.actorType}:${event.actorId} ${truncate(event.summary, 80)}`,
        ),
      ],
    };
  }

  return {
    lines: ["Unknown event command.", usageText()],
  };
}

async function runLinkCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const link: MemoryRecordLink = {
      id: createId("link"),
      spaceId: requireFlag(parsed.flags, "space-id"),
      fromRecordId: requireFlag(parsed.flags, "from-record-id"),
      toRecordId: requireFlag(parsed.flags, "to-record-id"),
      type: requireLinkType(parsed.flags.type),
      createdAt: new Date().toISOString(),
    };

    await context.repository.linkRecords(link);

    return {
      lines: ["Link added.", `id=${link.id}`, `type=${link.type}`],
    };
  }

  if (action === "list") {
    const recordId = parsed.flags["record-id"];
    const links = recordId
      ? await context.repository.listLinksForRecord(recordId)
      : await context.repository.listLinks(
          requireFlag(parsed.flags, "space-id"),
          parsed.flags.limit ? Number(parsed.flags.limit) : 10,
        );

    return {
      lines: [
        `links=${links.length}`,
        ...links.map((link) => `${link.id} ${link.type} ${link.fromRecordId} -> ${link.toRecordId}`),
      ],
    };
  }

  return {
    lines: ["Unknown link command.", usageText()],
  };
}

async function runExportCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const spaceId = requireFlag(parsed.flags, "space-id");
  const client = new GlialNodeClient({ repository: context.repository });
  const presetDirectory = resolvePresetDirectory(parsed.flags["preset-directory"]);
  const signingKeyRecord = parsed.flags["signing-key"]
    ? readSigningKeyRecord(presetDirectory, parsed.flags["signing-key"])
    : undefined;
  const signingPrivateKeyPem = parsed.flags["signing-private-key"]
    ? readTextFile(resolve(parsed.flags["signing-private-key"]))
    : signingKeyRecord?.privateKeyPem;
  const signer = parsed.flags.signer ?? signingKeyRecord?.signer;
  const snapshot = await client.exportSpace(spaceId, {
    origin: parsed.flags.origin,
    signer,
    signingPrivateKeyPem,
  });
  const output = JSON.stringify(snapshot, null, 2);

  if (parsed.flags.output) {
    const outputPath = resolve(parsed.flags.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output, "utf8");

    return {
      lines: [
        "Export written.",
        `output=${outputPath}`,
      ],
    };
  }

  return {
    lines: output.split(/\r?\n/),
  };
}

async function runImportCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const inputPath = resolve(requireFlag(parsed.flags, "input"));
  const client = new GlialNodeClient({ repository: context.repository });
  const presetDirectory = resolvePresetDirectory(parsed.flags["preset-directory"]);
  const trustPack = resolveTrustPolicyPackFromFlags(client, parsed, presetDirectory);
  const trustProfile = parseTrustProfileFlag(parsed.flags["trust-profile"] ?? trustPack?.baseProfile);
  const trustPolicy = mergePresetTrustPolicy(toPresetTrustPolicyInput(trustPack?.policy), parsePresetTrustPolicy(parsed.flags));
  const collisionPolicy = parseImportCollisionPolicy(parsed.flags.collision);
  const preview = parsed.flags.preview === "true";

  if (preview) {
    const previewResult = await client.previewSnapshotImportFromFile(inputPath, {
      trustPolicy,
      trustProfile,
      directory: presetDirectory,
      collisionPolicy,
    });

    const payload = {
      ...previewResult,
      schema: {
        version: context.repository.getSchemaVersion(),
        latest: sqliteAdapter.schemaVersion,
        upToDate: context.repository.getSchemaVersion() === sqliteAdapter.schemaVersion,
      },
    };

    if (parsed.flags.json === "true") {
      return {
        lines: [JSON.stringify(payload, null, 2)],
      };
    }

    return {
      lines: [
        "Import preview.",
        `applyAllowed=${previewResult.applyAllowed}`,
        `requestedSpaceId=${previewResult.requestedSpace.id}`,
        `requestedSpaceName=${previewResult.requestedSpace.name}`,
        `targetSpaceId=${previewResult.targetSpace.id}`,
        `targetSpaceName=${previewResult.targetSpace.name}`,
        `spaceExistsAtTarget=${previewResult.existingSpace ? "yes" : "no"}`,
        `identityRemapped=${previewResult.identityRemapped}`,
        `collisionPolicy=${previewResult.collisionPolicy}`,
        `trustProfile=${previewResult.trustProfile}`,
        `snapshotFormatVersion=${previewResult.snapshotMetadata.snapshotFormatVersion}`,
        `signed=${previewResult.snapshotMetadata.signed}`,
        `trusted=${previewResult.validation?.trusted ?? false}`,
        `schemaVersion=${payload.schema.version}`,
        `schemaLatest=${payload.schema.latest}`,
        `schemaUpToDate=${payload.schema.upToDate ? "yes" : "no"}`,
        `scopes=${previewResult.importedCounts.scopes}`,
        `events=${previewResult.importedCounts.events}`,
        `records=${previewResult.importedCounts.records}`,
        `links=${previewResult.importedCounts.links}`,
        `blockingIssues=${previewResult.blockingIssues.length}`,
        ...previewResult.blockingIssues.map((issue) => `blockingIssue=${issue}`),
      ],
    };
  }

  const validation = await client.validateSnapshot(
    JSON.parse(readTextFile(inputPath)) as Parameters<typeof client.validateSnapshot>[0],
    trustPolicy,
    trustProfile,
    presetDirectory,
  );
  const imported = await client.importSnapshotFromFile(inputPath, {
    trustPolicy,
    trustProfile,
    directory: presetDirectory,
    collisionPolicy,
  });

  if (parsed.flags.json === "true") {
    return {
      lines: [
        JSON.stringify({
          spaceId: imported.space.id,
          spaceName: imported.space.name,
          collisionPolicy,
          importedCounts: {
            scopes: imported.scopes.length,
            events: imported.events.length,
            records: imported.records.length,
            links: imported.links.length,
          },
          validation,
        }, null, 2),
      ],
    };
  }

  return {
    lines: [
      "Import completed.",
      `spaceId=${imported.space.id}`,
      `spaceName=${imported.space.name}`,
      `collisionPolicy=${collisionPolicy}`,
      `snapshotFormatVersion=${imported.metadata.snapshotFormatVersion}`,
      `signed=${Boolean(imported.metadata.signature)}`,
      `trusted=${validation.trusted}`,
      `warnings=${validation.warnings.join(" | ") || "none"}`,
      `scopes=${imported.scopes.length}`,
      `events=${imported.events.length}`,
      `records=${imported.records.length}`,
      `links=${imported.links.length}`,
    ],
  };
}

function createMemoryInput(parsed: ParsedArgs): CreateMemoryRecordInput {
  return {
    spaceId: requireFlag(parsed.flags, "space-id"),
    tier: requireTier(parsed.flags.tier),
    kind: requireKind(parsed.flags.kind),
    content: requireFlag(parsed.flags, "content"),
    summary: parsed.flags.summary,
    compactContent: parsed.flags["compact-content"],
    scope: {
      id: requireFlag(parsed.flags, "scope-id"),
      type: requireScopeType(parsed.flags["scope-type"]),
    },
    visibility: parsed.flags.visibility
      ? requireVisibility(parsed.flags.visibility)
      : undefined,
    status: parsed.flags.status
      ? requireStatus(parsed.flags.status)
      : undefined,
    tags: parsed.flags.tags ? parsed.flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
    importance: parsed.flags.importance ? Number(parsed.flags.importance) : undefined,
    confidence: parsed.flags.confidence ? Number(parsed.flags.confidence) : undefined,
    freshness: parsed.flags.freshness ? Number(parsed.flags.freshness) : undefined,
  };
}

function requireFlag(flags: Record<string, string>, key: string): string {
  const value = flags[key];

  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }

  return value;
}

function parseCsvFlag(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function parsePresetTrustPolicy(flags: Record<string, string>) {
  return {
    requireSigner: flags["require-signer"] !== undefined
      ? parseOptionalBoolean(flags["require-signer"])
      : undefined,
    requireSignature: flags["require-signature"] !== undefined
      ? parseOptionalBoolean(flags["require-signature"])
      : undefined,
    allowedOrigins: parseCsvFlag(flags["allow-origin"]),
    allowedSigners: parseCsvFlag(flags["allow-signer"]),
    allowedSignerKeyIds: parseCsvFlag(flags["allow-key-id"]),
    trustedSignerNames: parseCsvFlag(flags["trust-signer"]),
  };
}

function mergePresetTrustPolicy(
  base: ReturnType<typeof parsePresetTrustPolicy> | undefined,
  override: ReturnType<typeof parsePresetTrustPolicy> | undefined,
): ReturnType<typeof parsePresetTrustPolicy> {
  return {
    requireSigner: override?.requireSigner ?? base?.requireSigner,
    requireSignature: override?.requireSignature ?? base?.requireSignature,
    allowedOrigins: mergeStringLists(base?.allowedOrigins, override?.allowedOrigins),
    allowedSigners: mergeStringLists(base?.allowedSigners, override?.allowedSigners),
    allowedSignerKeyIds: mergeStringLists(base?.allowedSignerKeyIds, override?.allowedSignerKeyIds),
    trustedSignerNames: mergeStringLists(base?.trustedSignerNames, override?.trustedSignerNames),
  };
}

function toPresetTrustPolicyInput(policy: {
  requireSigner?: boolean;
  requireSignature?: boolean;
  allowedOrigins?: string[];
  allowedSigners?: string[];
  allowedSignerKeyIds?: string[];
  trustedSignerNames?: string[];
} | undefined): ReturnType<typeof parsePresetTrustPolicy> {
  return {
    requireSigner: policy?.requireSigner,
    requireSignature: policy?.requireSignature,
    allowedOrigins: policy?.allowedOrigins,
    allowedSigners: policy?.allowedSigners,
    allowedSignerKeyIds: policy?.allowedSignerKeyIds,
    trustedSignerNames: policy?.trustedSignerNames,
  };
}

function resolveTrustPolicyPackFromFlags(
  client: GlialNodeClient,
  parsed: ParsedArgs,
  directory: string,
) {
  const trustPackName = parsed.flags["trust-pack"] ?? process.env.GLIALNODE_TRUST_POLICY_PACK;
  if (!trustPackName) {
    return undefined;
  }

  return client.resolveTrustPolicyPack(trustPackName, directory);
}

function parseImportCollisionPolicy(
  value: string | undefined,
): "error" | "overwrite" | "rename" {
  const resolved = value ?? "error";
  switch (resolved) {
    case "error":
    case "overwrite":
    case "rename":
      return resolved;
    default:
      throw new Error(`Invalid collision policy: ${value}`);
  }
}

function parseTrustProfileFlag(value: string | undefined): "permissive" | "signed" | "anchored" {
  if (!value || value === "permissive" || value === "signed" || value === "anchored") {
    return (value ?? "permissive") as "permissive" | "signed" | "anchored";
  }

  throw new Error(`Invalid trust profile: ${value}`);
}

function requireScopeType(value: string | undefined): ScopeType {
  const allowed: ScopeType[] = [
    "memory_space",
    "orchestrator",
    "agent",
    "subagent",
    "session",
    "task",
    "project",
  ];

  if (!value || !allowed.includes(value as ScopeType)) {
    throw new Error(`Invalid scope type: ${value ?? "undefined"}`);
  }

  return value as ScopeType;
}

function requireTier(value: string | undefined): MemoryTier {
  const allowed: MemoryTier[] = ["short", "mid", "long"];

  if (!value || !allowed.includes(value as MemoryTier)) {
    throw new Error(`Invalid memory tier: ${value ?? "undefined"}`);
  }

  return value as MemoryTier;
}

function requireKind(value: string | undefined): MemoryKind {
  const allowed: MemoryKind[] = [
    "fact",
    "decision",
    "preference",
    "task",
    "summary",
    "blocker",
    "artifact",
    "attempt",
    "error",
  ];

  if (!value || !allowed.includes(value as MemoryKind)) {
    throw new Error(`Invalid memory kind: ${value ?? "undefined"}`);
  }

  return value as MemoryKind;
}

function requireVisibility(value: string | undefined): MemoryVisibility {
  const allowed: MemoryVisibility[] = ["private", "shared", "space"];

  if (!value || !allowed.includes(value as MemoryVisibility)) {
    throw new Error(`Invalid memory visibility: ${value ?? "undefined"}`);
  }

  return value as MemoryVisibility;
}

function requireStatus(value: string | undefined): RecordStatus {
  const allowed: RecordStatus[] = ["active", "archived", "superseded", "expired"];

  if (!value || !allowed.includes(value as RecordStatus)) {
    throw new Error(`Invalid memory status: ${value ?? "undefined"}`);
  }

  return value as RecordStatus;
}

function requireActorType(value: string | undefined): ActorType {
  const allowed: ActorType[] = ["user", "system", "orchestrator", "agent", "subagent", "tool"];

  if (!value || !allowed.includes(value as ActorType)) {
    throw new Error(`Invalid actor type: ${value ?? "undefined"}`);
  }

  return value as ActorType;
}

function requireEventType(value: string | undefined): EventType {
  const allowed: EventType[] = [
    "request_received",
    "decision_made",
    "task_started",
    "task_completed",
    "tool_called",
    "tool_succeeded",
    "tool_failed",
    "memory_written",
    "memory_promoted",
    "memory_archived",
    "memory_expired",
    "memory_conflicted",
    "memory_superseded",
    "memory_decayed",
    "memory_reinforced",
    "bundle_reviewed",
    "bundle_imported",
  ];

  if (!value || !allowed.includes(value as EventType)) {
    throw new Error(`Invalid event type: ${value ?? "undefined"}`);
  }

  return value as EventType;
}

function requireLinkType(value: string | undefined): MemoryRecordLink["type"] {
  const allowed: MemoryRecordLink["type"][] = [
    "derived_from",
    "supports",
    "contradicts",
    "supersedes",
    "references",
  ];

  if (!value || !allowed.includes(value as MemoryRecordLink["type"])) {
    throw new Error(`Invalid link type: ${value ?? "undefined"}`);
  }

  return value as MemoryRecordLink["type"];
}

function parseBundleProfile(value: string | undefined): "balanced" | "planner" | "executor" | "reviewer" | undefined {
  if (value === undefined) {
    return undefined;
  }

  const allowed = new Set(["balanced", "planner", "executor", "reviewer"]);
  if (!allowed.has(value)) {
    throw new Error(`Invalid bundle profile: ${value}`);
  }

  return value as "balanced" | "planner" | "executor" | "reviewer";
}

function parseBundleConsumer(
  value: string | undefined,
): "auto" | "balanced" | "planner" | "executor" | "reviewer" | undefined {
  if (value === undefined) {
    return undefined;
  }

  const allowed = new Set(["auto", "balanced", "planner", "executor", "reviewer"]);
  if (!allowed.has(value)) {
    throw new Error(`Invalid bundle consumer: ${value}`);
  }

  return value as "auto" | "balanced" | "planner" | "executor" | "reviewer";
}

function parseBundleProvenanceMode(
  value: string | undefined,
): "auto" | "minimal" | "balanced" | "preserve" | undefined {
  if (value === undefined) {
    return undefined;
  }

  const allowed = new Set(["auto", "minimal", "balanced", "preserve"]);
  if (!allowed.has(value)) {
    throw new Error(`Invalid bundle provenance mode: ${value}`);
  }

  return value as "auto" | "minimal" | "balanced" | "preserve";
}

function parseInspectorRecallQuery(flags: Record<string, string>) {
  const hasRecallFlag = [
    "query-text",
    "query-scope-id",
    "query-tier",
    "query-kind",
    "query-visibility",
    "query-status",
    "query-limit",
  ].some((key) => flags[key] !== undefined);

  if (!hasRecallFlag) {
    return undefined;
  }

  return {
    text: flags["query-text"],
    scopeIds: flags["query-scope-id"] ? [flags["query-scope-id"]] : undefined,
    tiers: flags["query-tier"] ? [requireTier(flags["query-tier"])] : undefined,
    kinds: flags["query-kind"] ? [requireKind(flags["query-kind"])] : undefined,
    visibility: flags["query-visibility"] ? [requireVisibility(flags["query-visibility"])] : undefined,
    statuses: flags["query-status"] ? [requireStatus(flags["query-status"])] : undefined,
    limit: parsePositiveOptionalNumber(flags["query-limit"], "query-limit"),
  };
}

function parseInspectorRecallOptions(flags: Record<string, string>) {
  const query = parseInspectorRecallQuery(flags);
  if (!query) {
    return undefined;
  }

  return {
    query,
    primaryLimit: parsePositiveOptionalNumber(flags["query-limit"], "query-limit"),
    supportLimit: parsePositiveOptionalNumber(flags["query-support-limit"], "query-support-limit"),
    bundleConsumer: parseBundleConsumer(flags["query-bundle-consumer"]),
    bundleProvenanceMode: parseBundleProvenanceMode(flags["query-bundle-provenance-mode"]),
  };
}

function parseTokenUsageInput(flags: Record<string, string>): RecordTokenUsageInput {
  return {
    spaceId: flags["space-id"],
    scopeId: flags["scope-id"],
    agentId: flags["agent-id"],
    projectId: flags["project-id"],
    workflowId: flags["workflow-id"],
    operation: parseRequiredString(flags.operation, "operation"),
    provider: flags.provider,
    model: parseRequiredString(flags.model, "model"),
    baselineTokens: parseOptionalNonNegativeInteger(flags["baseline-tokens"], "baseline-tokens"),
    actualContextTokens: parseOptionalNonNegativeInteger(flags["actual-context-tokens"], "actual-context-tokens"),
    glialnodeOverheadTokens: parseOptionalNonNegativeInteger(flags["glialnode-overhead-tokens"], "glialnode-overhead-tokens"),
    inputTokens: parseRequiredNonNegativeInteger(flags["input-tokens"], "input-tokens"),
    outputTokens: parseRequiredNonNegativeInteger(flags["output-tokens"], "output-tokens"),
    estimatedSavedTokens: parseOptionalNonNegativeInteger(flags["estimated-saved-tokens"], "estimated-saved-tokens"),
    estimatedSavedRatio: parseOptionalRatio(flags["estimated-saved-ratio"], "estimated-saved-ratio"),
    latencyMs: parseOptionalNonNegativeNumber(flags["latency-ms"], "latency-ms"),
    costCurrency: flags["cost-currency"],
    inputCost: parseOptionalNonNegativeNumber(flags["input-cost"], "input-cost"),
    outputCost: parseOptionalNonNegativeNumber(flags["output-cost"], "output-cost"),
    totalCost: parseOptionalNonNegativeNumber(flags["total-cost"], "total-cost"),
    dimensions: flags.dimensions ? parseTokenUsageDimensions(flags.dimensions) : undefined,
    createdAt: flags["created-at"],
  };
}

function parseTokenUsageReportOptions(flags: Record<string, string>): TokenUsageReportOptions {
  return {
    granularity: parseTokenUsageGranularity(flags.granularity),
    spaceId: flags["space-id"],
    scopeId: flags["scope-id"],
    agentId: flags["agent-id"],
    projectId: flags["project-id"],
    workflowId: flags["workflow-id"],
    operation: flags.operation,
    provider: flags.provider,
    model: flags.model,
    from: flags.from,
    to: flags.to,
    costModel: parseTokenCostModel(flags),
  };
}

function parseDashboardAlertThresholdFlags(flags: Record<string, string>) {
  return {
    memoryHealthWarningBelow: parseOptionalNonNegativeNumber(flags["memory-health-warning-below"], "memory-health-warning-below"),
    memoryHealthCriticalBelow: parseOptionalNonNegativeNumber(flags["memory-health-critical-below"], "memory-health-critical-below"),
    staleRecordWarningRatio: parseOptionalRatio(flags["stale-record-warning-ratio"], "stale-record-warning-ratio"),
    staleRecordCriticalRatio: parseOptionalRatio(flags["stale-record-critical-ratio"], "stale-record-critical-ratio"),
    lowConfidenceWarningRatio: parseOptionalRatio(flags["low-confidence-warning-ratio"], "low-confidence-warning-ratio"),
    lowConfidenceCriticalRatio: parseOptionalRatio(flags["low-confidence-critical-ratio"], "low-confidence-critical-ratio"),
    backupWarningAgeHours: parseOptionalNonNegativeNumber(flags["backup-warning-age-hours"], "backup-warning-age-hours"),
    backupCriticalAgeHours: parseOptionalNonNegativeNumber(flags["backup-critical-age-hours"], "backup-critical-age-hours"),
    databaseWarningBytes: parseOptionalNonNegativeNumber(flags["database-warning-bytes"], "database-warning-bytes"),
    databaseCriticalBytes: parseOptionalNonNegativeNumber(flags["database-critical-bytes"], "database-critical-bytes"),
  };
}

function parseOperationsBenchmarkBaselineFlag(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(resolve(value), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("--benchmark-baseline must point to a benchmark JSON object.");
  }

  const root = parsed as {
    generatedAt?: unknown;
    results?: unknown;
  };
  if (typeof root.generatedAt !== "string" || Number.isNaN(Date.parse(root.generatedAt))) {
    throw new Error("--benchmark-baseline JSON must include generatedAt.");
  }
  if (!Array.isArray(root.results) || root.results.length === 0) {
    throw new Error("--benchmark-baseline JSON must include at least one result.");
  }

  const result = root.results
    .map((entry) => parseOperationsBenchmarkResult(entry))
    .sort((left, right) => right.records - left.records)[0];
  if (!result) {
    throw new Error("--benchmark-baseline JSON did not include a usable result.");
  }

  return {
    generatedAt: root.generatedAt,
    ...result,
  };
}

function parseExecutionContextRecordsFile(value: string | undefined): ExecutionContextRecord[] {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(resolve(value), "utf8")) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
    ? (parsed as { records: unknown[] }).records
    : undefined;

  if (!records) {
    throw new Error("--records must point to a JSON array or object with a records array.");
  }

  return records.map((entry) => {
    const record = entry as ExecutionContextRecord;
    assertExecutionContextRecord(record);
    return record;
  });
}

function parseExecutionOutcomeInput(flags: Record<string, string>): RecordExecutionOutcomeInput {
  return {
    taskText: parseRequiredString(flags.task, "task"),
    scope: {
      repoId: flags["repo-id"],
      projectId: flags["project-id"],
      workflowId: flags["workflow-id"],
      agentId: flags["agent-id"],
    },
    features: parseCommaSeparatedList(flags.features),
    selectedSkills: parseCommaSeparatedList(flags["selected-skills"]),
    selectedTools: parseCommaSeparatedList(flags["selected-tools"]),
    skippedTools: parseCommaSeparatedList(flags["skipped-tools"]),
    firstReads: parseCommaSeparatedList(flags["first-reads"]),
    outcome: {
      state: parseExecutionOutcomeState(flags.outcome),
      latencyMs: parseOptionalNonNegativeNumber(flags["latency-ms"], "latency-ms"),
      toolCallCount: parseOptionalNonNegativeInteger(flags["tool-call-count"], "tool-call-count"),
      inputTokens: parseOptionalNonNegativeInteger(flags["input-tokens"], "input-tokens"),
      outputTokens: parseOptionalNonNegativeInteger(flags["output-tokens"], "output-tokens"),
      notes: parseCommaSeparatedList(flags.notes),
    },
    confidence: parseExecutionContextConfidence(flags.confidence),
    createdAt: flags["created-at"],
    retentionDays: parsePositiveOptionalNumber(flags["retention-days"], "retention-days"),
  };
}

function parseExecutionContextRecordFilters(flags: Record<string, string>): ExecutionContextRecordFilters {
  return {
    fingerprintHash: flags["fingerprint-hash"],
    repoId: flags["repo-id"],
    projectId: flags["project-id"],
    workflowId: flags["workflow-id"],
    agentId: flags["agent-id"],
    outcomeState: flags.outcome ? parseExecutionOutcomeState(flags.outcome) : undefined,
    from: flags.from,
    to: flags.to,
    includeExpired: parseOptionalBoolean(flags["include-expired"]) ?? false,
    limit: parsePositiveOptionalNumber(flags.limit, "limit"),
  };
}

function parseExecutionOutcomeState(
  value: string | undefined,
): NonNullable<RecordExecutionOutcomeInput["outcome"]>["state"] {
  if (value === "success" || value === "partial" || value === "failed" || value === "unknown") {
    return value;
  }
  throw new Error(`Invalid --outcome value: ${value ?? "undefined"}`);
}

function parseExecutionContextConfidence(
  value: string | undefined,
): RecordExecutionOutcomeInput["confidence"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`Invalid --confidence value: ${value}`);
}

function parseCommaSeparatedList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOperationsBenchmarkResult(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("--benchmark-baseline result entries must be objects.");
  }
  const result = value as Record<string, unknown>;
  return {
    records: readRequiredNumber(result, "records"),
    searchMs: readRequiredNumber(result, "searchMs"),
    recallMs: readRequiredNumber(result, "recallMs"),
    bundleBuildMs: readRequiredNumber(result, "bundleBuildMs"),
    compactionDryRunMs: readRequiredNumber(result, "compactionDryRunMs"),
    reportMs: readRequiredNumber(result, "reportMs"),
  };
}

function readRequiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`--benchmark-baseline result field '${key}' must be a non-negative number.`);
  }
  return value;
}

function parseTokenCostModel(flags: Record<string, string>): TokenCostModel | undefined {
  if (flags["input-cost-per-million"] === undefined && flags["output-cost-per-million"] === undefined) {
    return undefined;
  }

  return {
    currency: flags["cost-currency"] ?? "USD",
    provider: flags["cost-provider"] ?? flags.provider,
    model: flags["cost-model"] ?? flags.model,
    inputCostPerMillionTokens: parseRequiredNonNegativeNumber(flags["input-cost-per-million"], "input-cost-per-million"),
    outputCostPerMillionTokens: parseRequiredNonNegativeNumber(flags["output-cost-per-million"], "output-cost-per-million"),
  };
}

function parseTokenUsageGranularity(value: string | undefined): TokenUsageGranularity {
  if (value === undefined) {
    return "day";
  }
  if (value === "day" || value === "week" || value === "month" || value === "all") {
    return value;
  }
  throw new Error(`Invalid --granularity value: ${value}`);
}

function parseTokenUsageDimensions(value: string): Record<string, string | number | boolean | null> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--dimensions must be a JSON object.");
  }

  const dimensions = parsed as Record<string, unknown>;
  for (const [key, entry] of Object.entries(dimensions)) {
    if (key.trim().length === 0) {
      throw new Error("--dimensions cannot include empty keys.");
    }
    if (!["string", "number", "boolean"].includes(typeof entry) && entry !== null) {
      throw new Error(`--dimensions value for ${key} must be a string, number, boolean, or null.`);
    }
  }

  return dimensions as Record<string, string | number | boolean | null>;
}

function assertNoRawTextMetricFlags(flags: Record<string, string>): void {
  const forbiddenFlags = [
    "api-key",
    "completion",
    "completion-text",
    "content",
    "memory-content",
    "memory-text",
    "messages",
    "prompt",
    "prompt-text",
    "raw",
    "raw-text",
    "request-body",
    "response-body",
    "secret",
    "secret-value",
  ];
  const found = forbiddenFlags.find((flag) => flags[flag] !== undefined);
  if (found) {
    throw new Error(`Metrics commands do not accept raw text or secret payloads: --${found}`);
  }
}

function parsePositiveOptionalNumber(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${flagName} value: ${value}`);
  }
  return parsed;
}

function parseLearningLoopPolicyFlags(flags: Record<string, string>): Partial<LearningLoopPolicy> {
  return {
    minSuccessfulUses: parsePositiveOptionalNumber(flags["min-successful-uses"], "min-successful-uses"),
    maxSuggestions: parsePositiveOptionalNumber(flags["max-suggestions"], "max-suggestions"),
    reinforcementStrength: parsePositiveOptionalNumber(flags["reinforcement-strength"], "reinforcement-strength"),
    contradictionConfidenceGap: parsePositiveOptionalNumber(flags["contradiction-confidence-gap"], "contradiction-confidence-gap"),
  };
}

function parseRequiredPositiveNumber(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new Error(`Missing required flag: --${flagName}`);
  }
  return parsePositiveOptionalNumber(value, flagName) as number;
}

function parseRequiredString(value: string | undefined, flagName: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required flag: --${flagName}`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --${flagName} value: ${value}`);
  }
  return parsed;
}

function parseRequiredNonNegativeInteger(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new Error(`Missing required flag: --${flagName}`);
  }
  return parseOptionalNonNegativeInteger(value, flagName) as number;
}

function parseOptionalNonNegativeNumber(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --${flagName} value: ${value}`);
  }
  return parsed;
}

function parseRequiredNonNegativeNumber(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new Error(`Missing required flag: --${flagName}`);
  }
  return parseOptionalNonNegativeNumber(value, flagName) as number;
}

function parseOptionalRatio(value: string | undefined, flagName: string): number | undefined {
  const parsed = parseOptionalNonNegativeNumber(value, flagName);
  if (parsed !== undefined && parsed > 1) {
    throw new Error(`Invalid --${flagName} value: ${value}`);
  }
  return parsed;
}

function parsePortNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid --port value: ${value}`);
  }
  return parsed;
}

function parseSemanticPrototypeOptions(flags: Record<string, string>) {
  const enabled = flags["semantic-prototype"] !== undefined
    ? parseOptionalBoolean(flags["semantic-prototype"])
    : false;
  const semanticWeight = flags["semantic-weight"] !== undefined
    ? parseOptionalNumber(flags["semantic-weight"])
    : undefined;
  const requireGatePass = flags["semantic-gate-require-pass"] !== undefined
    ? parseOptionalBoolean(flags["semantic-gate-require-pass"])
    : false;
  const gateReportPath = flags["semantic-gate-report"];
  const gateReport = gateReportPath ? readSemanticEvalReport(gateReportPath) : undefined;
  if (semanticWeight !== undefined && (semanticWeight < 0 || semanticWeight > 1)) {
    throw new Error(`Invalid --semantic-weight value: ${flags["semantic-weight"]}`);
  }
  if (requireGatePass && !gateReport) {
    throw new Error("Missing required semantic gate report: pass --semantic-gate-report <path>.");
  }

  return {
    enabled,
    semanticWeight,
    gate: requireGatePass || gateReport
      ? {
          requirePass: requireGatePass,
          passed: gateReport?.passed,
          reportId: gateReport?.reportId,
          reason: gateReport?.gate?.reason,
        }
      : undefined,
  };
}

function applySemanticPrototypeRerankFromFlags(
  records: MemoryRecord[],
  queryText: string | undefined,
  flags: Record<string, string>,
): MemoryRecord[] {
  const semanticOptions = parseSemanticPrototypeOptions(flags);
  const reranked = rerankRecordsWithSemanticPrototype(records, queryText, semanticOptions);
  return reranked.records;
}

function readSemanticEvalReport(path: string): SemanticEvalReport {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SemanticEvalReport>;
  if (parsed.schemaVersion !== "1.0.0") {
    throw new Error(`Unsupported semantic eval report schema version in ${path}.`);
  }
  if (typeof parsed.passed !== "boolean") {
    throw new Error(`Invalid semantic eval report in ${path}: missing boolean 'passed'.`);
  }
  if (!parsed.gate || typeof parsed.gate.reason !== "string") {
    throw new Error(`Invalid semantic eval report in ${path}: missing gate.reason.`);
  }
  if (!parsed.reportId || typeof parsed.reportId !== "string") {
    throw new Error(`Invalid semantic eval report in ${path}: missing reportId.`);
  }
  return parsed as SemanticEvalReport;
}

async function serveDashboardApi(options: {
  client: GlialNodeClient;
  metricsDatabasePath: string;
  buildOptions: Parameters<GlialNodeClient["buildDashboardOverviewSnapshot"]>[0];
  host: string;
  port: number;
  durationMs: number;
  allowedOrigins: readonly string[];
  probePath?: string;
  probeOrigin?: string;
}) {
  assertLoopbackDashboardHost(options.host);
  assertDashboardPrivacyPolicy(createDefaultDashboardPrivacyPolicy({
    accessMode: "local_read_only_http",
    allowedOrigins: options.allowedOrigins,
  }));

  const server = createServer((request, response) => {
    void handleDashboardApiRequest(options, request, response).catch((error: unknown) => {
      writeDashboardJson(response, 500, {
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "Dashboard API request failed.",
        },
      });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  try {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : options.port;
    const baseUrl = `http://${formatHostForUrl(options.host)}:${activePort}`;
    let probeStatus: number | undefined;
    let probeSchemaVersion: string | undefined;
    let probeRoute: string | undefined;
    let probeAllowOrigin: string | null | undefined;
    if (options.probePath) {
      const normalizedProbePath = options.probePath.startsWith("/")
        ? options.probePath
        : `/${options.probePath}`;
      const probeResponse = await fetch(`${baseUrl}${normalizedProbePath}`, {
        headers: options.probeOrigin ? { Origin: options.probeOrigin } : undefined,
      });
      probeStatus = probeResponse.status;
      probeAllowOrigin = probeResponse.headers.get("access-control-allow-origin");
      const probeText = await probeResponse.text();
      const probePayload = parseOptionalDashboardProbeJson(probeText);
      probeSchemaVersion = readStringField(probePayload, "schemaVersion");
      probeRoute = readStringField(probePayload, "route");
    }

    await delay(options.durationMs);
    return {
      host: options.host,
      port: activePort,
      baseUrl,
      durationMs: options.durationMs,
      allowedOrigins: [...options.allowedOrigins],
      routes: [
        "/overview",
        "/executive",
        "/spaces",
        "/spaces/:id",
        "/agents",
        "/agents/:id",
        "/metrics/token-usage",
        "/trust",
        "/ops",
      ],
      probePath: options.probePath,
      probeOrigin: options.probeOrigin,
      probeStatus,
      probeSchemaVersion,
      probeRoute,
      probeAllowOrigin,
    };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  }
}

async function handleDashboardApiRequest(
  options: {
    client: GlialNodeClient;
    metricsDatabasePath: string;
    buildOptions: Parameters<GlialNodeClient["buildDashboardOverviewSnapshot"]>[0];
    allowedOrigins: readonly string[];
  },
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!applyDashboardCors(request, response, options.allowedOrigins)) {
    writeDashboardJson(response, 403, {
      error: {
        code: "origin_not_allowed",
        message: "Dashboard API origin is not allowed.",
      },
    });
    return;
  }

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    writeDashboardJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "Dashboard API is read-only and supports GET, HEAD, and OPTIONS only.",
      },
    });
    return;
  }

  const url = parseDashboardRequestUrl(request.url);
  if (!url) {
    writeDashboardJson(response, 400, {
      error: {
        code: "invalid_url",
        message: "Dashboard API request URL could not be parsed.",
      },
    }, method);
    return;
  }

  const route = normalizeDashboardRoute(url.pathname);
  const data = await resolveDashboardApiRoute(options.client, options.metricsDatabasePath, options.buildOptions, route);
  if (!data) {
    writeDashboardJson(response, 404, {
      route,
      error: {
        code: "not_found",
        message: "Dashboard API route was not found.",
      },
    }, method);
    return;
  }

  writeDashboardJson(response, 200, {
    route,
    data,
  }, method);
}

async function resolveDashboardApiRoute(
  client: GlialNodeClient,
  metricsDatabasePath: string,
  options: Parameters<GlialNodeClient["buildDashboardOverviewSnapshot"]>[0],
  route: string,
): Promise<unknown | undefined> {
  const buildOptions = options ?? {};
  if (route === "/health") {
    return {
      status: "ready",
      metricsDatabasePath,
    };
  }
  if (route === "/overview") {
    return {
      metricsDatabasePath,
      snapshot: await client.buildDashboardOverviewSnapshot(buildOptions),
    };
  }
  if (route === "/executive") {
    return {
      metricsDatabasePath,
      snapshot: await client.buildExecutiveDashboardSnapshot(buildOptions),
    };
  }
  if (route === "/ops" || route === "/operations") {
    return {
      metricsDatabasePath,
      snapshot: await client.buildOperationsDashboardSnapshot(buildOptions),
    };
  }
  if (route === "/spaces") {
    const spaces = await client.listSpaces();
    return {
      spaces: spaces.map(formatDashboardSpaceSummary),
    };
  }
  if (route.startsWith("/spaces/")) {
    const spaceId = decodeDashboardRouteId(route.slice("/spaces/".length));
    if (!spaceId) return undefined;
    const space = (await client.listSpaces()).find((entry) => entry.id === spaceId);
    if (!space) return undefined;
    return {
      space: formatDashboardSpaceSummary(space),
      snapshot: await client.buildSpaceDashboardSnapshot(spaceId, buildOptions),
    };
  }
  if (route === "/agents") {
    const agents = await listDashboardAgents(client);
    return { agents };
  }
  if (route.startsWith("/agents/")) {
    const agentId = decodeDashboardRouteId(route.slice("/agents/".length));
    if (!agentId) return undefined;
    return {
      agentId,
      snapshot: await client.buildAgentDashboardSnapshot(agentId, buildOptions),
    };
  }
  if (route === "/metrics/token-usage") {
    return {
      metricsDatabasePath,
      report: await client.getTokenUsageReport(buildOptions.tokenUsage),
    };
  }
  if (route === "/trust") {
    return {
      report: await client.buildTrustDashboardReport(buildOptions),
    };
  }
  return undefined;
}

async function listDashboardAgents(client: GlialNodeClient): Promise<Array<{
  id: string;
  spaceId: string;
  type: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}>> {
  const spaces = await client.listSpaces();
  const scoped = await Promise.all(spaces.map(async (space) => client.listScopes(space.id)));
  return scoped
    .flat()
    .filter((scope) => scope.type === "agent")
    .map((scope) => ({
      id: scope.id,
      spaceId: scope.spaceId,
      type: scope.type,
      label: scope.label ?? "",
      createdAt: scope.createdAt,
      updatedAt: scope.updatedAt,
    }));
}

function formatDashboardSpaceSummary(space: MemorySpace): {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: space.id,
    name: space.name,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

function writeDashboardJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  method = "GET",
): void {
  const body = `${JSON.stringify({
    schemaVersion: CLI_JSON_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    ...payload as Record<string, unknown>,
  }, null, 2)}\n`;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function applyDashboardCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): boolean {
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "300");

  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (!allowedOrigins.includes(origin)) {
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  return true;
}

function parseDashboardRequestUrl(value: string | undefined): URL | null {
  try {
    return new URL(value ?? "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

function normalizeDashboardRoute(pathname: string): string {
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return normalized || "/";
}

function decodeDashboardRouteId(value: string): string | undefined {
  const decoded = safelyDecodeUriComponent(value);
  return decoded && decoded.trim().length > 0 ? decoded : undefined;
}

function parseDashboardAllowedOrigins(value: string | undefined): readonly string[] {
  const origins = parseCsvFlag(value) ?? [];
  if (origins.length === 0) {
    throw new Error("Missing required flag --allow-origin for local dashboard HTTP mode.");
  }
  for (const origin of origins) {
    assertHttpOrigin(origin);
  }
  return origins;
}

function assertHttpOrigin(origin: string): void {
  if (origin === "null") {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid --allow-origin value: ${origin}`);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`Invalid --allow-origin value: ${origin}`);
  }
}

function assertLoopbackDashboardHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Dashboard API host must be a loopback address: 127.0.0.1, localhost, or ::1.");
  }
}

function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function parseOptionalDashboardProbeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

async function serveInspectorPackDirectory(options: {
  directory: string;
  host: string;
  port: number;
  durationMs: number;
  probePath?: string;
}) {
  const directoryStat = safeStat(options.directory);
  if (!directoryStat || !directoryStat.isDirectory()) {
    throw new Error(`Inspector pack directory does not exist or is not a directory: ${options.directory}`);
  }

  const server = createServer((request, response) => {
    serveStaticDirectoryRequest(options.directory, request, response);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  try {
    const address = server.address();
    const activePort = typeof address === "object" && address
      ? address.port
      : options.port;
    const baseUrl = `http://${options.host}:${activePort}`;
    let probeStatus: number | undefined;
    if (options.probePath) {
      const normalizedProbePath = options.probePath.startsWith("/")
        ? options.probePath
        : `/${options.probePath}`;
      const probeResponse = await fetch(`${baseUrl}${normalizedProbePath}`);
      probeStatus = probeResponse.status;
    }

    await delay(options.durationMs);
    return {
      directory: options.directory,
      host: options.host,
      port: activePort,
      baseUrl,
      durationMs: options.durationMs,
      probePath: options.probePath,
      probeStatus,
    };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  }
}

function serveStaticDirectoryRequest(
  rootDirectory: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.statusCode = 405;
    response.end("Method not allowed.");
    return;
  }

  const requestUrl = request.url ?? "/";
  const requestPath = requestUrl.split("?", 1)[0] ?? "/";
  const decodedPath = safelyDecodeUriComponent(requestPath);
  if (decodedPath === null) {
    response.statusCode = 400;
    response.end("Invalid request path.");
    return;
  }

  const targetRelativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const normalizedRelativePath = targetRelativePath.replace(/\//g, sep);
  const resolvedTargetPath = resolve(rootDirectory, normalizedRelativePath);
  const normalizedRoot = `${resolve(rootDirectory)}${sep}`;
  if (!resolvedTargetPath.startsWith(normalizedRoot) && resolvedTargetPath !== resolve(rootDirectory)) {
    response.statusCode = 403;
    response.end("Forbidden.");
    return;
  }

  let finalPath = resolvedTargetPath;
  const targetStat = safeStat(finalPath);
  if (targetStat?.isDirectory()) {
    finalPath = join(finalPath, "index.html");
  }
  const fileStat = safeStat(finalPath);
  if (!fileStat || !fileStat.isFile()) {
    response.statusCode = 404;
    response.end("Not found.");
    return;
  }

  const body = readFileSync(finalPath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypeForPath(finalPath));
  response.setHeader("Cache-Control", "no-store");
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function contentTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safelyDecodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function parseSpacePreset(value: string | undefined): SpacePresetName | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseRequiredSpacePreset(value);
}

function parseRequiredSpacePreset(value: string): SpacePresetName {
  if (!isSpacePresetName(value)) {
    throw new Error(`Invalid space preset: ${value}`);
  }

  return value;
}

function parseJsonFlag(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function parseSettingsFlag(value: string): MemorySpace["settings"] {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings must be a JSON object.");
  }

  return parsed as MemorySpace["settings"];
}

function parseCompactionFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const compactionEntries: Array<[keyof CompactionPolicy, number | undefined]> = [
    ["shortPromoteImportanceMin", parseOptionalNumber(flags["short-promote-importance-min"])],
    ["shortPromoteConfidenceMin", parseOptionalNumber(flags["short-promote-confidence-min"])],
    ["midPromoteImportanceMin", parseOptionalNumber(flags["mid-promote-importance-min"])],
    ["midPromoteConfidenceMin", parseOptionalNumber(flags["mid-promote-confidence-min"])],
    ["midPromoteFreshnessMin", parseOptionalNumber(flags["mid-promote-freshness-min"])],
    ["archiveImportanceMax", parseOptionalNumber(flags["archive-importance-max"])],
    ["archiveConfidenceMax", parseOptionalNumber(flags["archive-confidence-max"])],
    ["archiveFreshnessMax", parseOptionalNumber(flags["archive-freshness-max"])],
    ["distillMinClusterSize", parseOptionalNumber(flags["distill-min-cluster-size"])],
    ["distillMinTokenOverlap", parseOptionalNumber(flags["distill-min-token-overlap"])],
    ["distillSupersedeMinConfidence", parseOptionalNumber(flags["distill-supersede-min-confidence"])],
  ];

  const compaction = Object.fromEntries(
    compactionEntries.filter(([, value]) => value !== undefined),
  ) as Partial<CompactionPolicy>;

  if (flags["distill-supersede-sources"] !== undefined) {
    compaction.distillSupersedeSources = parseOptionalBoolean(flags["distill-supersede-sources"]);
  }

  if (Object.keys(compaction).length === 0) {
    return {};
  }

  return { compaction };
}

function parseRetentionFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const retentionDays = {
    short: parseOptionalNumber(flags["retention-short-days"]),
    mid: parseOptionalNumber(flags["retention-mid-days"]),
    long: parseOptionalNumber(flags["retention-long-days"]),
  };

  const filtered = Object.fromEntries(
    Object.entries(retentionDays).filter(([, value]) => value !== undefined),
  ) as NonNullable<MemorySpace["settings"]>["retentionDays"];

  if (Object.keys(filtered as object).length === 0) {
    return {};
  }

  return { retentionDays: filtered };
}

function parseConflictFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const conflictEntries: Array<[keyof ConflictPolicy, number | boolean | undefined]> = [
    ["minTokenOverlap", parseOptionalNumber(flags["conflict-min-token-overlap"])],
    ["confidencePenalty", parseOptionalNumber(flags["conflict-confidence-penalty"])],
  ];

  const conflict = Object.fromEntries(
    conflictEntries.filter(([, value]) => value !== undefined),
  ) as Partial<ConflictPolicy>;

  if (flags["conflict-enabled"] !== undefined) {
    conflict.enabled = parseOptionalBoolean(flags["conflict-enabled"]);
  }

  if (Object.keys(conflict).length === 0) {
    return {};
  }

  return { conflict };
}

function parseDecayFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const decayEntries: Array<[keyof DecayPolicy, number | boolean | undefined]> = [
    ["minAgeDays", parseOptionalNumber(flags["decay-min-age-days"])],
    ["confidenceDecayPerDay", parseOptionalNumber(flags["decay-confidence-per-day"])],
    ["freshnessDecayPerDay", parseOptionalNumber(flags["decay-freshness-per-day"])],
    ["minConfidence", parseOptionalNumber(flags["decay-min-confidence"])],
    ["minFreshness", parseOptionalNumber(flags["decay-min-freshness"])],
  ];

  const decay = Object.fromEntries(
    decayEntries.filter(([, value]) => value !== undefined),
  ) as Partial<DecayPolicy>;

  if (flags["decay-enabled"] !== undefined) {
    decay.enabled = parseOptionalBoolean(flags["decay-enabled"]);
  }

  if (Object.keys(decay).length === 0) {
    return {};
  }

  return { decay };
}

function parseReinforcementFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const reinforcementEntries: Array<[keyof ReinforcementPolicy, number | boolean | undefined]> = [
    ["confidenceBoost", parseOptionalNumber(flags["reinforcement-confidence-boost"])],
    ["freshnessBoost", parseOptionalNumber(flags["reinforcement-freshness-boost"])],
    ["maxConfidence", parseOptionalNumber(flags["reinforcement-max-confidence"])],
    ["maxFreshness", parseOptionalNumber(flags["reinforcement-max-freshness"])],
  ];

  const reinforcement = Object.fromEntries(
    reinforcementEntries.filter(([, value]) => value !== undefined),
  ) as Partial<ReinforcementPolicy>;

  if (flags["reinforcement-enabled"] !== undefined) {
    reinforcement.enabled = parseOptionalBoolean(flags["reinforcement-enabled"]);
  }

  if (Object.keys(reinforcement).length === 0) {
    return {};
  }

  return { reinforcement };
}

function parseRoutingFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const routingEntries: Array<[keyof RoutingPolicy, number | boolean | undefined]> = [
    ["staleThreshold", parseOptionalNumber(flags["routing-stale-threshold"])],
  ];

  const routing = Object.fromEntries(
    routingEntries.filter(([, value]) => value !== undefined),
  ) as Partial<RoutingPolicy>;

  if (flags["routing-prefer-reviewer-on-contested"] !== undefined) {
    routing.preferReviewerOnContested = parseOptionalBoolean(flags["routing-prefer-reviewer-on-contested"]);
  }

  if (flags["routing-prefer-reviewer-on-stale"] !== undefined) {
    routing.preferReviewerOnStale = parseOptionalBoolean(flags["routing-prefer-reviewer-on-stale"]);
  }

  if (flags["routing-prefer-reviewer-on-provenance"] !== undefined) {
    routing.preferReviewerOnProvenance = parseOptionalBoolean(flags["routing-prefer-reviewer-on-provenance"]);
  }

  if (flags["routing-prefer-executor-on-actionable"] !== undefined) {
    routing.preferExecutorOnActionable = parseOptionalBoolean(flags["routing-prefer-executor-on-actionable"]);
  }

  if (flags["routing-prefer-planner-on-distilled"] !== undefined) {
    routing.preferPlannerOnDistilled = parseOptionalBoolean(flags["routing-prefer-planner-on-distilled"]);
  }

  if (Object.keys(routing).length === 0) {
    return {};
  }

  return { routing };
}

function parseProvenanceFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const provenance: NonNullable<MemorySpace["settings"]>["provenance"] = {};

  if (flags["provenance-trust-profile"] !== undefined) {
    provenance.trustProfile = parseTrustProfileFlag(flags["provenance-trust-profile"]);
  }

  if (flags["provenance-trust-signer"] !== undefined) {
    provenance.trustedSignerNames = parseCsvFlag(flags["provenance-trust-signer"]);
  }

  if (Object.keys(provenance).length === 0) {
    return {};
  }

  return { provenance };
}

function mergeSpaceSettings(
  ...settings: Array<MemorySpace["settings"] | undefined>
): MemorySpace["settings"] {
  const [existing, ...rest] = settings;

  return {
    ...(existing ?? {}),
    ...Object.assign({}, ...rest.map((entry) => entry ?? {})),
    retentionDays: {
      ...(existing?.retentionDays ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.retentionDays ?? {})),
    },
    compaction: {
      ...(existing?.compaction ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.compaction ?? {})),
    },
    conflict: {
      ...(existing?.conflict ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.conflict ?? {})),
    },
    decay: {
      ...(existing?.decay ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.decay ?? {})),
    },
    reinforcement: {
      ...(existing?.reinforcement ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.reinforcement ?? {})),
    },
    routing: {
      ...(existing?.routing ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.routing ?? {})),
    },
    provenance: {
      ...(existing?.provenance ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.provenance ?? {})),
      trustedSignerNames: mergeStringLists(
        existing?.provenance?.trustedSignerNames,
        Object.assign([], ...rest.map((entry) => entry?.provenance?.trustedSignerNames ?? [])) as string[],
      ),
    },
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value ?? "undefined"}`);
}

function parseFlagBooleanDefaultFalse(value: string | undefined): boolean {
  return value === undefined ? false : parseOptionalBoolean(value);
}

function parseGraphExportFormat(value: string | undefined): SpaceGraphExportFormat {
  if (!value) {
    return "native";
  }

  if (value === "native" || value === "cytoscape" || value === "dot") {
    return value;
  }

  throw new Error(`Invalid graph export format: ${value}`);
}

async function requireRecord(
  repository: SqliteMemoryRepository,
  recordId: string,
): Promise<MemoryRecord> {
  const record = await repository.getRecord(recordId);

  if (!record) {
    throw new Error(`Unknown record: ${recordId}`);
  }

  return record;
}

async function requireSpace(
  repository: SqliteMemoryRepository,
  spaceId: string,
): Promise<MemorySpace> {
  const space = await repository.getSpace(spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  return space;
}

function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}

function loadPresetDefinitionFromFile(path: string) {
  return parseSpacePresetDefinition(readTextFile(resolve(path)));
}

function resolvePresetReference(reference: string, directory: string | undefined) {
  const [kind, ...rest] = reference.split(":");
  const value = rest.join(":");

  if (!kind || !value) {
    throw new Error(`Invalid preset reference: ${reference}`);
  }

  if (kind === "builtin") {
    return getSpacePresetDefinition(parseRequiredSpacePreset(value));
  }

  if (kind === "local") {
    return loadRegisteredPreset(value, directory);
  }

  if (kind === "file") {
    return loadPresetDefinitionFromFile(value);
  }

  throw new Error(`Unsupported preset reference kind: ${kind}`);
}

function resolvePresetDirectory(directory: string | undefined): string {
  return resolve(directory ?? ".glialnode/presets");
}

function listRegisteredPresets(directory: string | undefined) {
  const resolvedDirectory = resolvePresetDirectory(directory);
  if (!existsSync(resolvedDirectory)) {
    return [];
  }

  return readdirSync(resolvedDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => loadPresetDefinitionFromFile(join(resolvedDirectory, entry)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function loadRegisteredPreset(name: string, directory: string | undefined) {
  const resolvedDirectory = resolvePresetDirectory(directory);
  const candidatePath = join(resolvedDirectory, `${toPresetFileName(name)}.json`);
  if (existsSync(candidatePath)) {
    return loadPresetDefinitionFromFile(candidatePath);
  }

  const preset = listRegisteredPresets(resolvedDirectory).find((entry) => entry.name === name);
  if (!preset) {
    throw new Error(`Unknown registered preset: ${name}`);
  }

  return preset;
}

function resolvePresetChannel(name: string, channel: string | undefined, directory: string | undefined) {
  const resolvedDirectory = resolvePresetDirectory(directory);
  const state = readPresetChannels(resolvedDirectory, name);
  const resolvedChannel = channel ?? state.defaultChannel;
  if (!resolvedChannel) {
    throw new Error(`No preset channel selected for ${name}.`);
  }
  const version = state.channels[resolvedChannel];
  if (!version) {
    throw new Error(`Unknown preset channel for ${name}: ${resolvedChannel}`);
  }

  return requirePresetHistoryVersion(listRegisteredPresetHistory(name, resolvedDirectory), name, version);
}

function listRegisteredPresetHistory(name: string, directory: string | undefined) {
  const resolvedDirectory = resolvePresetDirectory(directory);
  const historyDirectory = join(resolvedDirectory, ".versions", toPresetFileName(name));
  if (!existsSync(historyDirectory)) {
    return [];
  }

  return readdirSync(historyDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => loadPresetDefinitionFromFile(join(historyDirectory, entry)))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function requirePresetHistoryVersion(
  history: ReturnType<typeof listRegisteredPresetHistory>,
  name: string,
  version: string,
) {
  const match = history.find((preset) => preset.version === version);
  if (!match) {
    throw new Error(`Unknown preset version for ${name}: ${version}`);
  }

  return match;
}

function readPresetChannels(directory: string, name: string): { name: string; channels: Record<string, string>; defaultChannel?: string } {
  const channelsPath = join(directory, ".channels", `${toPresetFileName(name)}.json`);
  if (!existsSync(channelsPath)) {
    return {
      name,
      channels: {},
    };
  }

  const parsed = parsePresetChannelState(readTextFile(channelsPath));
  return {
    ...parsed,
    name,
  };
}

function writePresetChannels(directory: string, state: { name: string; channels: Record<string, string>; defaultChannel?: string }) {
  const channelsDirectory = join(directory, ".channels");
  ensureDirectoryWithMode(channelsDirectory, 0o755);
  const channelsPath = join(channelsDirectory, `${toPresetFileName(state.name)}.json`);
  writeJsonFileAtomic(channelsPath, JSON.stringify(state, null, 2), 0o644);
}

function getSigningKeysDirectory(directory: string): string {
  return join(directory, ".keys");
}

function getSigningKeyPath(directory: string, name: string): string {
  return join(getSigningKeysDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeSigningKeyRecord(
  directory: string,
  record: {
    name: string;
    algorithm: "ed25519";
    signer?: string;
    keyId: string;
    publicKeyPem: string;
    privateKeyPem: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const keysDirectory = getSigningKeysDirectory(directory);
  ensureDirectoryWithMode(keysDirectory, 0o700);
  writeJsonFileAtomic(getSigningKeyPath(directory, record.name), JSON.stringify(record, null, 2), 0o600);
}

function readSigningKeyRecord(directory: string, name: string): {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  updatedAt: string;
} {
  const recordPath = getSigningKeyPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown signing key: ${name}`);
  }

  return parseSigningKeyRecord(readTextFile(recordPath));
}

function listSigningKeyRecords(directory: string): Array<ReturnType<typeof parseSigningKeyRecord>> {
  const keysDirectory = getSigningKeysDirectory(directory);
  if (!existsSync(keysDirectory)) {
    return [];
  }

  return readdirSync(keysDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseSigningKeyRecord(readTextFile(join(keysDirectory, entry))))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getTrustedSignersDirectory(directory: string): string {
  return join(directory, ".trusted");
}

function getTrustedSignerPath(directory: string, name: string): string {
  return join(getTrustedSignersDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeTrustedSignerRecord(
  directory: string,
  record: {
    name: string;
    algorithm: "ed25519";
    signer?: string;
    keyId: string;
    publicKeyPem: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const trustDirectory = getTrustedSignersDirectory(directory);
  ensureDirectoryWithMode(trustDirectory, 0o755);
  writeJsonFileAtomic(getTrustedSignerPath(directory, record.name), JSON.stringify(record, null, 2), 0o644);
}

function readTrustedSignerRecord(directory: string, name: string): {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  replacedBy?: string;
} {
  const recordPath = getTrustedSignerPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown trusted signer: ${name}`);
  }

  return parseTrustedSignerRecord(readTextFile(recordPath));
}

function listTrustedSignerRecords(directory: string): Array<ReturnType<typeof parseTrustedSignerRecord>> {
  const trustDirectory = getTrustedSignersDirectory(directory);
  if (!existsSync(trustDirectory)) {
    return [];
  }

  return readdirSync(trustDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseTrustedSignerRecord(readTextFile(join(trustDirectory, entry))))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTrustedSignerRecord(value: string): {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  replacedBy?: string;
} {
  const parsed = JSON.parse(value) as {
    name?: unknown;
    algorithm?: unknown;
    signer?: unknown;
    keyId?: unknown;
    publicKeyPem?: unknown;
    source?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    revokedAt?: unknown;
    replacedBy?: unknown;
  };

  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid trusted signer record: missing name.");
  }
  if (parsed.algorithm !== "ed25519") {
    throw new Error(`Invalid trusted signer algorithm: ${String(parsed.algorithm ?? "undefined")}`);
  }
  if (typeof parsed.publicKeyPem !== "string" || !parsed.publicKeyPem) {
    throw new Error("Invalid trusted signer record: missing public key.");
  }

  const timestamp = new Date().toISOString();
  return {
    name: parsed.name,
    algorithm: "ed25519",
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    keyId: typeof parsed.keyId === "string" && parsed.keyId ? parsed.keyId : computeSignerKeyId(parsed.publicKeyPem),
    publicKeyPem: parsed.publicKeyPem,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
    revokedAt: typeof parsed.revokedAt === "string" ? parsed.revokedAt : undefined,
    replacedBy: typeof parsed.replacedBy === "string" ? parsed.replacedBy : undefined,
  };
}

function parseSigningKeyRecord(value: string): {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  updatedAt: string;
} {
  const parsed = JSON.parse(value) as {
    name?: unknown;
    algorithm?: unknown;
    signer?: unknown;
    keyId?: unknown;
    publicKeyPem?: unknown;
    privateKeyPem?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };

  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid signing key record: missing name.");
  }
  if (parsed.algorithm !== "ed25519") {
    throw new Error(`Invalid signing key algorithm: ${String(parsed.algorithm ?? "undefined")}`);
  }
  if (typeof parsed.publicKeyPem !== "string" || typeof parsed.privateKeyPem !== "string") {
    throw new Error("Invalid signing key record: missing PEM material.");
  }

  const timestamp = new Date().toISOString();
  return {
    name: parsed.name,
    algorithm: "ed25519",
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    keyId: typeof parsed.keyId === "string" && parsed.keyId ? parsed.keyId : computeSignerKeyId(parsed.publicKeyPem),
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
  };
}

function writePresetFiles(directory: string, preset: ReturnType<typeof parseSpacePresetDefinition>) {
  const outputPath = join(directory, `${toPresetFileName(preset.name)}.json`);
  ensureDirectoryWithMode(directory, 0o755);
  writeJsonFileAtomic(outputPath, stringifySpacePresetDefinition(preset), 0o644);

  writePresetHistoryFile(directory, preset);
}

function writePresetHistoryFile(directory: string, preset: ReturnType<typeof parseSpacePresetDefinition>) {
  const historyDirectory = join(directory, ".versions", toPresetFileName(preset.name));
  ensureDirectoryWithMode(historyDirectory, 0o755);
  const historyPath = join(
    historyDirectory,
    `${toPresetHistoryTimestamp(preset.updatedAt)}--${toPresetVersionFileName(preset.version ?? "1.0.0")}.json`,
  );
  writeJsonFileAtomic(historyPath, stringifySpacePresetDefinition(preset), 0o644);
}

function parsePresetChannelState(value: string): { name: string; channels: Record<string, string>; defaultChannel?: string } {
  const parsed = JSON.parse(value) as {
    name?: unknown;
    channels?: unknown;
    defaultChannel?: unknown;
  };

  return {
    name: typeof parsed.name === "string" ? parsed.name : "preset",
    channels: parsed.channels && typeof parsed.channels === "object" && !Array.isArray(parsed.channels)
      ? { ...(parsed.channels as Record<string, string>) }
      : {},
    defaultChannel: typeof parsed.defaultChannel === "string" ? parsed.defaultChannel : undefined,
  };
}

function parsePresetBundle(value: string): {
  metadata: {
    bundleFormatVersion: number;
    glialnodeVersion: string;
    nodeEngine: string;
    origin?: string;
    signer?: string;
    checksumAlgorithm: "sha256";
    checksum: string;
    signatureAlgorithm?: "ed25519";
    signerKeyId?: string;
    signerPublicKey?: string;
    signature?: string;
  };
  exportedAt: string;
  preset: ReturnType<typeof parseSpacePresetDefinition>;
  history: Array<ReturnType<typeof parseSpacePresetDefinition>>;
  channels: ReturnType<typeof parsePresetChannelState>;
} {
  const parsed = JSON.parse(value) as {
    metadata?: unknown;
    exportedAt?: unknown;
    preset?: unknown;
    history?: unknown;
    channels?: unknown;
  };

  return {
    metadata: parsePresetBundleMetadata(JSON.stringify(parsed.metadata ?? {})),
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    preset: parseSpacePresetDefinition(JSON.stringify(parsed.preset ?? {})),
    history: Array.isArray(parsed.history)
      ? parsed.history.map((entry) => parseSpacePresetDefinition(JSON.stringify(entry)))
      : [],
    channels: parsePresetChannelState(JSON.stringify(parsed.channels ?? {})),
  };
}

function parsePresetBundleMetadata(value: string): {
  bundleFormatVersion: number;
  glialnodeVersion: string;
  nodeEngine: string;
  origin?: string;
  signer?: string;
  checksumAlgorithm: "sha256";
  checksum: string;
  signatureAlgorithm?: "ed25519";
  signerKeyId?: string;
  signerPublicKey?: string;
  signature?: string;
} {
  const parsed = JSON.parse(value) as {
    bundleFormatVersion?: unknown;
    glialnodeVersion?: unknown;
    nodeEngine?: unknown;
    origin?: unknown;
    signer?: unknown;
    checksumAlgorithm?: unknown;
    checksum?: unknown;
    signatureAlgorithm?: unknown;
    signerKeyId?: unknown;
    signerPublicKey?: unknown;
    signature?: unknown;
  };

  return {
    bundleFormatVersion: typeof parsed.bundleFormatVersion === "number"
      ? parsed.bundleFormatVersion
      : PRESET_BUNDLE_FORMAT_VERSION,
    glialnodeVersion: typeof parsed.glialnodeVersion === "string"
      ? parsed.glialnodeVersion
      : GLIALNODE_VERSION,
    nodeEngine: typeof parsed.nodeEngine === "string"
      ? parsed.nodeEngine
      : GLIALNODE_NODE_ENGINE,
    origin: typeof parsed.origin === "string" ? parsed.origin : undefined,
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    checksumAlgorithm: parsed.checksumAlgorithm === "sha256" ? "sha256" : "sha256",
    checksum: typeof parsed.checksum === "string" ? parsed.checksum : "",
    signatureAlgorithm: parsed.signatureAlgorithm === "ed25519" ? "ed25519" : undefined,
    signerKeyId: typeof parsed.signerKeyId === "string" ? parsed.signerKeyId : undefined,
    signerPublicKey: typeof parsed.signerPublicKey === "string" ? parsed.signerPublicKey : undefined,
    signature: typeof parsed.signature === "string" ? parsed.signature : undefined,
  };
}

interface TrustedSignerNameResolution {
  allowedSignerKeyIds: string[];
  trustedSignerNamesByKeyId: Record<string, string[]>;
  revokedTrustedSignerNames: string[];
}

interface ResolvedPresetTrustPolicy extends ReturnType<typeof parsePresetTrustPolicy> {
  trustedSignerNamesByKeyId?: Record<string, string[]>;
  revokedTrustedSignerNames?: string[];
}

function validatePresetBundle(
  bundle: ReturnType<typeof parsePresetBundle>,
  trustPolicy: {
    requireSigner?: boolean;
    requireSignature?: boolean;
    allowedOrigins?: string[];
    allowedSigners?: string[];
    allowedSignerKeyIds?: string[];
    trustedSignerNames?: string[];
  } = {},
  trustProfile: "permissive" | "signed" | "anchored" = "permissive",
) {
  const resolvedTrustPolicy = trustPolicy as ResolvedPresetTrustPolicy;
  if (bundle.metadata.bundleFormatVersion !== PRESET_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported preset bundle format: ${bundle.metadata.bundleFormatVersion}. Expected ${PRESET_BUNDLE_FORMAT_VERSION}.`,
    );
  }

  const warnings: string[] = [];
  const trustWarnings: string[] = [];
  const trustedSignerMatch = resolveTrustedSignerMatch(bundle, resolvedTrustPolicy);
  const matchedTrustedSignerNames = trustedSignerMatch.matchedTrustedSignerNames;
  const requestedTrustedSignerNames = trustedSignerMatch.requestedTrustedSignerNames;
  const revokedTrustedSignerNames = trustedSignerMatch.revokedTrustedSignerNames;
  const unmatchedTrustedSignerNames = trustedSignerMatch.unmatchedTrustedSignerNames;
  if (bundle.metadata.glialnodeVersion !== GLIALNODE_VERSION) {
    warnings.push(
      `Bundle was exported by GlialNode ${bundle.metadata.glialnodeVersion}; current runtime is ${GLIALNODE_VERSION}.`,
    );
  }

  if (bundle.metadata.nodeEngine !== GLIALNODE_NODE_ENGINE) {
    warnings.push(
      `Bundle targets Node ${bundle.metadata.nodeEngine}; current package requires ${GLIALNODE_NODE_ENGINE}.`,
    );
  }

  const expectedChecksum = computePresetBundleChecksum(bundle);
  if (bundle.metadata.checksum !== expectedChecksum) {
    throw new Error("Preset bundle checksum verification failed.");
  }

  if (trustPolicy.requireSigner && !bundle.metadata.signer) {
    trustWarnings.push("Preset bundle is unsigned.");
  }

  if (trustPolicy.requireSignature && !bundle.metadata.signature) {
    trustWarnings.push("Preset bundle is unsigned by key.");
  }

  if (trustPolicy.allowedOrigins?.length) {
    if (!bundle.metadata.origin) {
      trustWarnings.push("Preset bundle origin is missing.");
    } else if (!trustPolicy.allowedOrigins.includes(bundle.metadata.origin)) {
      trustWarnings.push(`Preset bundle origin is not allowed: ${bundle.metadata.origin}`);
    }
  }

  if (trustPolicy.allowedSigners?.length) {
    if (!bundle.metadata.signer) {
      trustWarnings.push("Preset bundle signer is missing.");
    } else if (!trustPolicy.allowedSigners.includes(bundle.metadata.signer)) {
      trustWarnings.push(`Preset bundle signer is not allowed: ${bundle.metadata.signer}`);
    }
  }

  if (bundle.metadata.signature) {
    if (bundle.metadata.signatureAlgorithm !== "ed25519") {
      throw new Error(`Unsupported preset bundle signature algorithm: ${bundle.metadata.signatureAlgorithm ?? "unknown"}.`);
    }

    if (!bundle.metadata.signerPublicKey) {
      throw new Error("Preset bundle signature is missing signer public key.");
    }

    const signerKeyId = computeSignerKeyId(bundle.metadata.signerPublicKey);
    if (bundle.metadata.signerKeyId && bundle.metadata.signerKeyId !== signerKeyId) {
      throw new Error("Preset bundle signer key id verification failed.");
    }

    if (!verifyPresetBundleSignature(bundle)) {
      throw new Error("Preset bundle signature verification failed.");
    }

    if (trustPolicy.allowedSignerKeyIds?.length && !trustPolicy.allowedSignerKeyIds.includes(signerKeyId)) {
      trustWarnings.push(`Preset bundle signer key id is not allowed: ${signerKeyId}`);
    }
  } else if (trustPolicy.allowedSignerKeyIds?.length) {
    trustWarnings.push("Preset bundle signer key id is missing.");
  }

  if (trustWarnings.length > 0) {
    throw new Error(`Preset bundle trust validation failed: ${trustWarnings.join("; ")}`);
  }

  return {
    metadata: bundle.metadata,
    warnings,
    trustWarnings,
    trusted: true,
    report: {
      trustProfile,
      effectivePolicy: trustPolicy,
      signerKeyId: bundle.metadata.signerKeyId
        ?? (bundle.metadata.signerPublicKey ? computeSignerKeyId(bundle.metadata.signerPublicKey) : undefined),
      matchedTrustedSignerNames,
      requestedTrustedSignerNames,
      unmatchedTrustedSignerNames,
      revokedTrustedSignerNames,
      signed: Boolean(bundle.metadata.signature),
      policyFailures: [...trustWarnings],
    },
  };
}

function resolveTrustedSignerMatch(
  bundle: ReturnType<typeof parsePresetBundle>,
  trustPolicy: ResolvedPresetTrustPolicy,
): {
  signerKeyId?: string;
  matchedTrustedSignerNames: string[];
  requestedTrustedSignerNames: string[];
  revokedTrustedSignerNames: string[];
  unmatchedTrustedSignerNames: string[];
} {
  const requestedTrustedSignerNames = [...(trustPolicy.trustedSignerNames ?? [])];
  const revokedTrustedSignerNames = [...(trustPolicy.revokedTrustedSignerNames ?? [])];
  const signerKeyId = bundle.metadata.signerKeyId
    ?? (bundle.metadata.signerPublicKey ? computeSignerKeyId(bundle.metadata.signerPublicKey) : undefined);
  const matchedTrustedSignerNames = signerKeyId
    ? [...(trustPolicy.trustedSignerNamesByKeyId?.[signerKeyId] ?? [])]
    : [];
  const unmatchedTrustedSignerNames = requestedTrustedSignerNames.filter((name) =>
    !matchedTrustedSignerNames.includes(name) && !revokedTrustedSignerNames.includes(name)
  );

  return {
    signerKeyId,
    matchedTrustedSignerNames,
    requestedTrustedSignerNames,
    revokedTrustedSignerNames,
    unmatchedTrustedSignerNames,
  };
}

function extractTrustFailureMessages(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = "Preset bundle trust validation failed:";

  if (message.startsWith(prefix)) {
    return message
      .slice(prefix.length)
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [message];
}

function buildFailedPresetBundleValidationReport(
  bundle: ReturnType<typeof parsePresetBundle>,
  trustPolicy: ReturnType<typeof parsePresetTrustPolicy> | ResolvedPresetTrustPolicy,
  trustProfile: "permissive" | "signed" | "anchored",
  policyFailures: string[],
) {
  const resolvedTrustPolicy = trustPolicy as ResolvedPresetTrustPolicy;
  const trustedSignerMatch = resolveTrustedSignerMatch(bundle, resolvedTrustPolicy);

  return {
    metadata: bundle.metadata,
    warnings: [] as string[],
    trustWarnings: policyFailures,
    trusted: false,
    report: {
      trustProfile,
      effectivePolicy: trustPolicy,
      signerKeyId: trustedSignerMatch.signerKeyId,
      matchedTrustedSignerNames: trustedSignerMatch.matchedTrustedSignerNames,
      requestedTrustedSignerNames: trustedSignerMatch.requestedTrustedSignerNames,
      unmatchedTrustedSignerNames: trustedSignerMatch.unmatchedTrustedSignerNames,
      revokedTrustedSignerNames: trustedSignerMatch.revokedTrustedSignerNames,
      signed: Boolean(bundle.metadata.signature),
      policyFailures,
    },
  };
}

function resolvePresetTrustPolicy(
  trustPolicy: ReturnType<typeof parsePresetTrustPolicy>,
  directory: string,
  trustProfile: "permissive" | "signed" | "anchored" = "permissive",
): ResolvedPresetTrustPolicy {
  const profilePolicy = getPresetTrustProfile(trustProfile);
  const basePolicy = {
    ...profilePolicy,
    ...trustPolicy,
    allowedOrigins: mergeStringLists(profilePolicy.allowedOrigins, trustPolicy.allowedOrigins),
    allowedSigners: mergeStringLists(profilePolicy.allowedSigners, trustPolicy.allowedSigners),
    allowedSignerKeyIds: mergeStringLists(profilePolicy.allowedSignerKeyIds, trustPolicy.allowedSignerKeyIds),
    trustedSignerNames: mergeStringLists(profilePolicy.trustedSignerNames, trustPolicy.trustedSignerNames),
  };

  if (!basePolicy.trustedSignerNames?.length) {
    if (trustProfile === "anchored" && !basePolicy.allowedSignerKeyIds?.length) {
      throw new Error("Trust profile 'anchored' requires trusted signers or allowed signer key ids.");
    }
    return basePolicy;
  }

  const trustedSignerResolution = resolveTrustedSignerNames(basePolicy.trustedSignerNames, directory);
  if (trustedSignerResolution.revokedTrustedSignerNames.length > 0) {
    throw new Error(`Trusted signers are revoked: ${trustedSignerResolution.revokedTrustedSignerNames.join(", ")}`);
  }

  return {
    ...basePolicy,
    allowedSignerKeyIds: Array.from(new Set([
      ...(basePolicy.allowedSignerKeyIds ?? []),
      ...trustedSignerResolution.allowedSignerKeyIds,
    ])),
    trustedSignerNamesByKeyId: trustedSignerResolution.trustedSignerNamesByKeyId,
    revokedTrustedSignerNames: trustedSignerResolution.revokedTrustedSignerNames,
  };
}

function mergePresetTrustPolicyFromSettings(
  trustPolicy: ReturnType<typeof parsePresetTrustPolicy>,
  provenanceSettings: NonNullable<MemorySpace["settings"]>["provenance"] | undefined,
) {
  return {
    ...trustPolicy,
    allowedOrigins: mergeStringLists(provenanceSettings?.allowedOrigins, trustPolicy.allowedOrigins),
    allowedSigners: mergeStringLists(provenanceSettings?.allowedSigners, trustPolicy.allowedSigners),
    allowedSignerKeyIds: mergeStringLists(provenanceSettings?.allowedSignerKeyIds, trustPolicy.allowedSignerKeyIds),
    trustedSignerNames: mergeStringLists(provenanceSettings?.trustedSignerNames, trustPolicy.trustedSignerNames),
  };
}

function resolveTrustedSignerNames(
  trustedSignerNames: string[] | undefined,
  directory: string,
): TrustedSignerNameResolution {
  const resolution: TrustedSignerNameResolution = {
    allowedSignerKeyIds: [],
    trustedSignerNamesByKeyId: {},
    revokedTrustedSignerNames: [],
  };

  for (const name of trustedSignerNames ?? []) {
    const record = readTrustedSignerRecord(directory, name);
    if (record.revokedAt) {
      resolution.revokedTrustedSignerNames.push(name);
      continue;
    }

    resolution.allowedSignerKeyIds.push(record.keyId);
    resolution.trustedSignerNamesByKeyId[record.keyId] ??= [];
    resolution.trustedSignerNamesByKeyId[record.keyId]!.push(name);
  }

  resolution.allowedSignerKeyIds = Array.from(new Set(resolution.allowedSignerKeyIds));
  return resolution;
}

function createPresetBundleAuditEvent(
  spaceId: string,
  type: "bundle_reviewed" | "bundle_imported",
  summary: string,
  payload: Record<string, unknown>,
): MemoryEvent {
  return {
    id: createId("event"),
    spaceId,
    scope: {
      type: "memory_space",
      id: getSpaceAuditScopeId(spaceId),
    },
    actorType: "system",
    actorId: "preset-bundle-audit",
    type,
    summary,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function createPresetBundleAuditSummaryRecord(spaceId: string, event: MemoryEvent): MemoryRecord {
  const payload = event.payload ?? {};
  const bundleName = typeof payload.bundleName === "string" ? payload.bundleName : "unknown";
  const importedPresetName = typeof payload.importedPresetName === "string" ? payload.importedPresetName : undefined;
  const trustProfile = typeof payload.trustProfile === "string" ? payload.trustProfile : "permissive";
  const signer = typeof payload.signer === "string" ? payload.signer : "unknown";
  const origin = typeof payload.origin === "string" ? payload.origin : "unknown";
  const trusted = payload.trusted === true;
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === "string") : [];
  const matchedTrustedSignerNames = Array.isArray(payload.matchedTrustedSignerNames)
    ? payload.matchedTrustedSignerNames.filter((item): item is string => typeof item === "string")
    : [];

  const content = event.type === "bundle_imported"
    ? `Preset bundle ${bundleName} was imported as ${importedPresetName ?? bundleName} with trust profile ${trustProfile}. trusted=${trusted}. signer=${signer}. origin=${origin}. matchedTrustedSigners=${matchedTrustedSignerNames.join(",") || "none"}. warnings=${warnings.join(" | ") || "none"}.`
    : `Preset bundle ${bundleName} was reviewed with trust profile ${trustProfile}. trusted=${trusted}. signer=${signer}. origin=${origin}. matchedTrustedSigners=${matchedTrustedSignerNames.join(",") || "none"}. warnings=${warnings.join(" | ") || "none"}.`;

  return createMemoryRecord({
    spaceId,
    tier: "mid",
    kind: "summary",
    content,
    summary: event.type === "bundle_imported" ? "Bundle import audit" : "Bundle review audit",
    scope: event.scope,
    visibility: "space",
    tags: ["provenance", "bundle", "audit", event.type],
    importance: event.type === "bundle_imported" ? 0.66 : 0.58,
    confidence: 1,
    freshness: 0.74,
    sourceEventId: event.id,
  });
}

async function ensureSpaceAuditScope(repository: MemoryRepository, spaceId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await repository.upsertScope({
    id: getSpaceAuditScopeId(spaceId),
    spaceId,
    type: "memory_space",
    label: "Space Audit",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function getSpaceAuditScopeId(spaceId: string): string {
  return `space_audit_${spaceId}`;
}

function getPresetTrustProfile(profile: "permissive" | "signed" | "anchored"): {
  requireSigner?: boolean;
  requireSignature?: boolean;
  allowedOrigins?: string[];
  allowedSigners?: string[];
  allowedSignerKeyIds?: string[];
  trustedSignerNames?: string[];
} {
  switch (profile) {
    case "permissive":
      return {};
    case "signed":
      return {
        requireSigner: true,
        requireSignature: true,
      };
    case "anchored":
      return {
        requireSigner: true,
        requireSignature: true,
      };
  }
}

function mergeStringLists(left?: string[], right?: string[]): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function computePresetBundleChecksum(bundle: ReturnType<typeof parsePresetBundle>): string {
  const checksumPayload = {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      checksum: "",
      signature: undefined,
    },
  };

  return createHash("sha256")
    .update(stableStringify(checksumPayload))
    .digest("hex");
}

function computePresetBundleSignature(bundle: ReturnType<typeof parsePresetBundle>, privateKeyPem: string): string {
  return sign(null, createPresetBundleSignaturePayload(bundle), createPrivateKey(privateKeyPem)).toString("base64");
}

function verifyPresetBundleSignature(bundle: ReturnType<typeof parsePresetBundle>): boolean {
  if (!bundle.metadata.signature || !bundle.metadata.signerPublicKey) {
    return false;
  }

  return verify(
    null,
    createPresetBundleSignaturePayload(bundle),
    createPublicKey(bundle.metadata.signerPublicKey),
    Buffer.from(bundle.metadata.signature, "base64"),
  );
}

function createPresetBundleSignaturePayload(bundle: ReturnType<typeof parsePresetBundle>): Buffer {
  return Buffer.from(stableStringify({
    ...bundle,
    metadata: {
      ...bundle.metadata,
      signature: undefined,
    },
  }));
}

function ensureDirectoryWithMode(directory: string, mode: number): void {
  mkdirSync(directory, { recursive: true, mode });
  if (process.platform !== "win32") {
    try {
      chmodSync(directory, mode);
    } catch {
      // Best-effort hardening: some filesystems may ignore or reject chmod.
    }
  }
}

function writeJsonFileAtomic(outputPath: string, contents: string, mode?: number): void {
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", mode });
    renameSync(tempPath, outputPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}

function computeSignerKeyId(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]);
    return Object.fromEntries(entries);
  }

  return value;
}

function toPresetFileName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "preset";
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  return JSON.stringify(value);
}

function toPresetVersionFileName(version: string): string {
  const normalized = version
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "1-0-0";
}

function toPresetHistoryTimestamp(value: string | undefined): string {
  const normalized = (value ?? new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace(/[^0-9a-zA-Z-]/g, "");

  return normalized || "snapshot";
}

function formatOptionalBoolean(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "unknown";
  }

  return value ? "yes" : "no";
}

function inspectDatabasePath(
  databasePath: string | null,
  options: {
    existedAtStartup?: boolean;
    parentExistedAtStartup?: boolean;
  },
) {
  if (!databasePath || databasePath === ":memory:") {
    return {
      path: databasePath,
      existedAtStartup: options.existedAtStartup ?? null,
      parentExistedAtStartup: options.parentExistedAtStartup ?? null,
      kind: "memory" as const,
      sizeBytes: null,
      walSidecarPresent: false,
      shmSidecarPresent: false,
      warnings: [] as string[],
    };
  }

  const entry = inspectFilesystemEntry(databasePath);
  const warnings = [...entry.warnings];

  if (entry.kind !== "file") {
    warnings.push(`Database path is not a regular file: ${databasePath}`);
  }

  return {
    path: databasePath,
    existedAtStartup: options.existedAtStartup ?? null,
    parentExistedAtStartup: options.parentExistedAtStartup ?? null,
    kind: entry.kind,
    sizeBytes: entry.sizeBytes,
    walSidecarPresent: existsSync(`${databasePath}-wal`),
    shmSidecarPresent: existsSync(`${databasePath}-shm`),
    warnings,
  };
}

function inspectPresetRegistry(directory: string) {
  const entry = inspectFilesystemEntry(directory);
  const warnings = [...entry.warnings];

  if (entry.kind !== "missing" && entry.kind !== "directory") {
    warnings.push(`Preset directory path is not a directory: ${directory}`);
  }

  return {
    path: directory,
    kind: entry.kind,
    presetFileCount: entry.kind === "directory" ? countJsonFilesInDirectory(directory) : 0,
    historySnapshotCount: countJsonFilesRecursive(join(directory, ".versions")),
    channelFileCount: countJsonFilesInDirectory(join(directory, ".channels")),
    warnings,
  };
}

function inspectJsonStoreDirectory(
  directory: string,
  options: {
    label: string;
    modePolicy: "private" | "shared";
    parseRecord?: (value: string) => unknown;
    countRevoked?: boolean;
  },
) {
  const entry = inspectFilesystemEntry(directory);
  const warnings = [...entry.warnings];

  if (entry.kind === "missing") {
    return {
      path: directory,
      kind: "missing" as const,
      fileCount: 0,
      revokedCount: options.countRevoked ? 0 : undefined,
      warnings,
    };
  }

  if (entry.kind !== "directory") {
    warnings.push(`${options.label} path is not a directory: ${directory}`);
    return {
      path: directory,
      kind: entry.kind,
      fileCount: 0,
      revokedCount: options.countRevoked ? 0 : undefined,
      warnings,
    };
  }

  warnings.push(...describeModeWarnings(options.label, directory, entry.mode, options.modePolicy, true));

  let revokedCount = 0;
  const fileNames = readdirSync(directory)
    .filter((entryName) => entryName.toLowerCase().endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fileNames) {
    const filePath = join(directory, fileName);
    const fileEntry = inspectFilesystemEntry(filePath);
    warnings.push(...fileEntry.warnings);
    warnings.push(...describeModeWarnings(`${options.label} file`, filePath, fileEntry.mode, options.modePolicy, false));

    if (fileEntry.kind !== "file") {
      warnings.push(`${options.label} entry is not a regular file: ${filePath}`);
      continue;
    }

    if (options.parseRecord) {
      try {
        const record = options.parseRecord(readTextFile(filePath));
        if (options.countRevoked && record && typeof record === "object" && "revokedAt" in record && record.revokedAt) {
          revokedCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${options.label} file is invalid: ${fileName} (${message})`);
      }
    }
  }

  return {
    path: directory,
    kind: "directory" as const,
    fileCount: fileNames.length,
    revokedCount: options.countRevoked ? revokedCount : undefined,
    warnings,
  };
}

function inspectFilesystemEntry(path: string): {
  kind: "missing" | "file" | "directory" | "other";
  mode?: number;
  sizeBytes?: number;
  warnings: string[];
} {
  if (!existsSync(path)) {
    return {
      kind: "missing",
      warnings: [],
    };
  }

  try {
    const stats = statSync(path);
    if (stats.isFile()) {
      return {
        kind: "file",
        mode: stats.mode,
        sizeBytes: stats.size,
        warnings: [],
      };
    }

    if (stats.isDirectory()) {
      return {
        kind: "directory",
        mode: stats.mode,
        sizeBytes: stats.size,
        warnings: [],
      };
    }

    return {
      kind: "other",
      mode: stats.mode,
      sizeBytes: stats.size,
      warnings: [`Path is neither a regular file nor a directory: ${path}`],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "other",
      warnings: [`Unable to inspect path ${path}: ${message}`],
    };
  }
}

function describeModeWarnings(
  label: string,
  path: string,
  mode: number | undefined,
  policy: "private" | "shared",
  isDirectory: boolean,
): string[] {
  if (process.platform === "win32" || mode === undefined) {
    return [];
  }

  const maskedMode = mode & 0o777;
  if (policy === "private" && (maskedMode & 0o077) !== 0) {
    return [`${label} is more permissive than expected (${formatUnixMode(maskedMode)}) at ${path}`];
  }

  if (policy === "shared" && (maskedMode & 0o022) !== 0) {
    return [`${label} allows group/other writes (${formatUnixMode(maskedMode)}) at ${path}`];
  }

  if (isDirectory && policy === "private" && maskedMode !== 0o700) {
    return [`${label} should ideally use mode 700; found ${formatUnixMode(maskedMode)} at ${path}`];
  }

  if (!isDirectory && policy === "private" && maskedMode !== 0o600) {
    return [`${label} should ideally use mode 600; found ${formatUnixMode(maskedMode)} at ${path}`];
  }

  return [];
}

function formatUnixMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function countJsonFilesInDirectory(directory: string): number {
  const entry = inspectFilesystemEntry(directory);
  if (entry.kind !== "directory") {
    return 0;
  }

  return readdirSync(directory)
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .length;
}

function countJsonFilesRecursive(directory: string): number {
  const entry = inspectFilesystemEntry(directory);
  if (entry.kind !== "directory") {
    return 0;
  }

  let count = 0;
  for (const child of readdirSync(directory)) {
    const childPath = join(directory, child);
    const childEntry = inspectFilesystemEntry(childPath);
    if (childEntry.kind === "file" && child.toLowerCase().endsWith(".json")) {
      count += 1;
      continue;
    }

    if (childEntry.kind === "directory") {
      count += countJsonFilesRecursive(childPath);
    }
  }

  return count;
}

function summarizeMaintenanceAcrossSpaces(reports: SpaceReport[]) {
  let latestRunAt: string | undefined;
  let spacesWithMaintenance = 0;
  let retentionExpired = 0;
  let decayDecayed = 0;
  let reinforcementUpdated = 0;
  const compactionDeltas = {
    promoted: 0,
    archived: 0,
    refreshed: 0,
    distilled: 0,
    superseded: 0,
  };

  for (const report of reports) {
    if (report.maintenance.latestRunAt) {
      spacesWithMaintenance += 1;
      if (!latestRunAt || report.maintenance.latestRunAt > latestRunAt) {
        latestRunAt = report.maintenance.latestRunAt;
      }
    }

    const compaction = report.maintenance.latestCompactionDelta;
    if (compaction) {
      compactionDeltas.promoted += compaction.promoted;
      compactionDeltas.archived += compaction.archived;
      compactionDeltas.refreshed += compaction.refreshed;
      compactionDeltas.distilled += compaction.distilled;
      compactionDeltas.superseded += compaction.superseded;
    }

    retentionExpired += report.maintenance.latestRetentionDelta?.expired ?? 0;
    decayDecayed += report.maintenance.latestDecayDelta?.decayed ?? 0;
    reinforcementUpdated += report.maintenance.latestReinforcementDelta?.reinforced ?? 0;
  }

  return {
    spacesWithMaintenance,
    latestRunAt,
    compactionDeltas,
    retentionExpired,
    decayDecayed,
    reinforcementUpdated,
  };
}

function buildSpacePolicyView(settings: MemorySpace["settings"] | undefined) {
  const effective = {
    maxShortTermRecords: settings?.maxShortTermRecords ?? defaultConfig.maxWorkingMemoryRecords,
    retentionDays: {
      short: settings?.retentionDays?.short ?? defaultRetentionPolicy.short,
      mid: settings?.retentionDays?.mid ?? defaultRetentionPolicy.mid,
      long: settings?.retentionDays?.long,
    },
    compaction: {
      shortPromoteImportanceMin: settings?.compaction?.shortPromoteImportanceMin ?? defaultCompactionPolicy.shortPromoteImportanceMin,
      shortPromoteConfidenceMin: settings?.compaction?.shortPromoteConfidenceMin ?? defaultCompactionPolicy.shortPromoteConfidenceMin,
      midPromoteImportanceMin: settings?.compaction?.midPromoteImportanceMin ?? defaultCompactionPolicy.midPromoteImportanceMin,
      midPromoteConfidenceMin: settings?.compaction?.midPromoteConfidenceMin ?? defaultCompactionPolicy.midPromoteConfidenceMin,
      midPromoteFreshnessMin: settings?.compaction?.midPromoteFreshnessMin ?? defaultCompactionPolicy.midPromoteFreshnessMin,
      archiveImportanceMax: settings?.compaction?.archiveImportanceMax ?? defaultCompactionPolicy.archiveImportanceMax,
      archiveConfidenceMax: settings?.compaction?.archiveConfidenceMax ?? defaultCompactionPolicy.archiveConfidenceMax,
      archiveFreshnessMax: settings?.compaction?.archiveFreshnessMax ?? defaultCompactionPolicy.archiveFreshnessMax,
      distillMinClusterSize: settings?.compaction?.distillMinClusterSize ?? defaultCompactionPolicy.distillMinClusterSize,
      distillMinTokenOverlap: settings?.compaction?.distillMinTokenOverlap ?? defaultCompactionPolicy.distillMinTokenOverlap,
      distillSupersedeSources: settings?.compaction?.distillSupersedeSources ?? defaultCompactionPolicy.distillSupersedeSources,
      distillSupersedeMinConfidence: settings?.compaction?.distillSupersedeMinConfidence ?? defaultCompactionPolicy.distillSupersedeMinConfidence,
    },
    conflict: {
      enabled: settings?.conflict?.enabled ?? defaultConflictPolicy.enabled,
      minTokenOverlap: settings?.conflict?.minTokenOverlap ?? defaultConflictPolicy.minTokenOverlap,
      confidencePenalty: settings?.conflict?.confidencePenalty ?? defaultConflictPolicy.confidencePenalty,
    },
    decay: {
      enabled: settings?.decay?.enabled ?? defaultDecayPolicy.enabled,
      minAgeDays: settings?.decay?.minAgeDays ?? defaultDecayPolicy.minAgeDays,
      confidenceDecayPerDay: settings?.decay?.confidenceDecayPerDay ?? defaultDecayPolicy.confidenceDecayPerDay,
      freshnessDecayPerDay: settings?.decay?.freshnessDecayPerDay ?? defaultDecayPolicy.freshnessDecayPerDay,
      minConfidence: settings?.decay?.minConfidence ?? defaultDecayPolicy.minConfidence,
      minFreshness: settings?.decay?.minFreshness ?? defaultDecayPolicy.minFreshness,
    },
    reinforcement: {
      enabled: settings?.reinforcement?.enabled ?? defaultReinforcementPolicy.enabled,
      confidenceBoost: settings?.reinforcement?.confidenceBoost ?? defaultReinforcementPolicy.confidenceBoost,
      freshnessBoost: settings?.reinforcement?.freshnessBoost ?? defaultReinforcementPolicy.freshnessBoost,
      maxConfidence: settings?.reinforcement?.maxConfidence ?? defaultReinforcementPolicy.maxConfidence,
      maxFreshness: settings?.reinforcement?.maxFreshness ?? defaultReinforcementPolicy.maxFreshness,
    },
    routing: {
      preferReviewerOnContested: settings?.routing?.preferReviewerOnContested ?? defaultRoutingPolicy.preferReviewerOnContested,
      preferReviewerOnStale: settings?.routing?.preferReviewerOnStale ?? defaultRoutingPolicy.preferReviewerOnStale,
      preferReviewerOnProvenance: settings?.routing?.preferReviewerOnProvenance ?? defaultRoutingPolicy.preferReviewerOnProvenance,
      staleThreshold: settings?.routing?.staleThreshold ?? defaultRoutingPolicy.staleThreshold,
      preferExecutorOnActionable: settings?.routing?.preferExecutorOnActionable ?? defaultRoutingPolicy.preferExecutorOnActionable,
      preferPlannerOnDistilled: settings?.routing?.preferPlannerOnDistilled ?? defaultRoutingPolicy.preferPlannerOnDistilled,
    },
    provenance: {
      trustProfile: settings?.provenance?.trustProfile,
      trustedSignerNames: settings?.provenance?.trustedSignerNames,
      allowedOrigins: settings?.provenance?.allowedOrigins,
      allowedSigners: settings?.provenance?.allowedSigners,
      allowedSignerKeyIds: settings?.provenance?.allowedSignerKeyIds,
    },
  };

  const origin = {
    maxShortTermRecords: settings?.maxShortTermRecords !== undefined ? "space" : "default",
    retentionDays: {
      short: settings?.retentionDays?.short !== undefined ? "space" : "default",
      mid: settings?.retentionDays?.mid !== undefined ? "space" : "default",
      long: settings?.retentionDays?.long !== undefined ? "space" : "unset",
    },
    compaction: {
      shortPromoteImportanceMin: settings?.compaction?.shortPromoteImportanceMin !== undefined ? "space" : "default",
      shortPromoteConfidenceMin: settings?.compaction?.shortPromoteConfidenceMin !== undefined ? "space" : "default",
      midPromoteImportanceMin: settings?.compaction?.midPromoteImportanceMin !== undefined ? "space" : "default",
      midPromoteConfidenceMin: settings?.compaction?.midPromoteConfidenceMin !== undefined ? "space" : "default",
      midPromoteFreshnessMin: settings?.compaction?.midPromoteFreshnessMin !== undefined ? "space" : "default",
      archiveImportanceMax: settings?.compaction?.archiveImportanceMax !== undefined ? "space" : "default",
      archiveConfidenceMax: settings?.compaction?.archiveConfidenceMax !== undefined ? "space" : "default",
      archiveFreshnessMax: settings?.compaction?.archiveFreshnessMax !== undefined ? "space" : "default",
      distillMinClusterSize: settings?.compaction?.distillMinClusterSize !== undefined ? "space" : "default",
      distillMinTokenOverlap: settings?.compaction?.distillMinTokenOverlap !== undefined ? "space" : "default",
      distillSupersedeSources: settings?.compaction?.distillSupersedeSources !== undefined ? "space" : "default",
      distillSupersedeMinConfidence: settings?.compaction?.distillSupersedeMinConfidence !== undefined ? "space" : "default",
    },
    conflict: {
      enabled: settings?.conflict?.enabled !== undefined ? "space" : "default",
      minTokenOverlap: settings?.conflict?.minTokenOverlap !== undefined ? "space" : "default",
      confidencePenalty: settings?.conflict?.confidencePenalty !== undefined ? "space" : "default",
    },
    decay: {
      enabled: settings?.decay?.enabled !== undefined ? "space" : "default",
      minAgeDays: settings?.decay?.minAgeDays !== undefined ? "space" : "default",
      confidenceDecayPerDay: settings?.decay?.confidenceDecayPerDay !== undefined ? "space" : "default",
      freshnessDecayPerDay: settings?.decay?.freshnessDecayPerDay !== undefined ? "space" : "default",
      minConfidence: settings?.decay?.minConfidence !== undefined ? "space" : "default",
      minFreshness: settings?.decay?.minFreshness !== undefined ? "space" : "default",
    },
    reinforcement: {
      enabled: settings?.reinforcement?.enabled !== undefined ? "space" : "default",
      confidenceBoost: settings?.reinforcement?.confidenceBoost !== undefined ? "space" : "default",
      freshnessBoost: settings?.reinforcement?.freshnessBoost !== undefined ? "space" : "default",
      maxConfidence: settings?.reinforcement?.maxConfidence !== undefined ? "space" : "default",
      maxFreshness: settings?.reinforcement?.maxFreshness !== undefined ? "space" : "default",
    },
    routing: {
      preferReviewerOnContested: settings?.routing?.preferReviewerOnContested !== undefined ? "space" : "default",
      preferReviewerOnStale: settings?.routing?.preferReviewerOnStale !== undefined ? "space" : "default",
      preferReviewerOnProvenance: settings?.routing?.preferReviewerOnProvenance !== undefined ? "space" : "default",
      staleThreshold: settings?.routing?.staleThreshold !== undefined ? "space" : "default",
      preferExecutorOnActionable: settings?.routing?.preferExecutorOnActionable !== undefined ? "space" : "default",
      preferPlannerOnDistilled: settings?.routing?.preferPlannerOnDistilled !== undefined ? "space" : "default",
    },
    provenance: {
      trustProfile: settings?.provenance?.trustProfile !== undefined ? "space" : "unset",
      trustedSignerNames: settings?.provenance?.trustedSignerNames !== undefined ? "space" : "unset",
      allowedOrigins: settings?.provenance?.allowedOrigins !== undefined ? "space" : "unset",
      allowedSigners: settings?.provenance?.allowedSigners !== undefined ? "space" : "unset",
      allowedSignerKeyIds: settings?.provenance?.allowedSignerKeyIds !== undefined ? "space" : "unset",
    },
  };

  return {
    raw: settings ?? {},
    effective,
    origin,
  };
}

interface SpaceExport {
  space: MemorySpace;
  scopes: ScopeRecord[];
  events: MemoryEvent[];
  records: MemoryRecord[];
  links?: MemoryRecordLink[];
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}

function formatCounts(values: Record<string, number>): string {
  const entries = Object.entries(values);

  if (entries.length === 0) {
    return "{}";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");
}

function mergeUpdatedRecords(
  existing: MemoryRecord[],
  updates: MemoryRecord[],
): MemoryRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));

  for (const update of updates) {
    byId.set(update.id, update);
  }

  return [...byId.values()];
}
