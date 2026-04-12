import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { createId } from "../core/ids.js";
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
import { promoteRecord } from "../memory/promotion.js";
import {
  applyReinforcementPlan,
  createReinforcementEvents,
  createReinforcementSummaryLinks,
  createReinforcementSummaryRecord,
  planReinforcement,
  summarizeReinforcementPlan,
} from "../memory/reinforcement.js";
import { buildMemoryBundle, buildRecallPack, buildRecallTrace } from "../memory/retrieval.js";
import {
  applyRetentionPlan,
  createRetentionEvents,
  createRetentionSummaryLinks,
  createRetentionSummaryRecord,
  planRetention,
  summarizeRetentionPlan,
} from "../memory/retention.js";
import { createMemoryRecord, updateRecordStatus } from "../memory/service.js";
import { SqliteMemoryRepository } from "../storage/index.js";
import type { ParsedArgs } from "./args.js";

export interface CommandResult {
  lines: string[];
}

export interface CommandContext {
  repository: SqliteMemoryRepository;
}

const PRESET_BUNDLE_FORMAT_VERSION = 1;
const GLIALNODE_VERSION = "0.1.0";
const GLIALNODE_NODE_ENGINE = ">=24";

export function createRepository(databasePath: string): SqliteMemoryRepository {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return new SqliteMemoryRepository({ filename: resolvedPath });
}

export async function runCommand(parsed: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const [resource = "status", action = "show"] = parsed.positional;

  if (resource === "status") {
    return runStatusCommand(context);
  }

  if (resource === "space") {
    return runSpaceCommand(action, parsed, context);
  }

  if (resource === "preset") {
    return runPresetCommand(action, parsed);
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
    "  glialnode status",
    "  glialnode preset list",
    "  glialnode preset show --name <preset> | --input <path>",
    "  glialnode preset diff --left <builtin:name|local:name|file:path> --right <builtin:name|local:name|file:path> [--directory <path>]",
    "  glialnode preset export --name <preset> --output <path>",
    "  glialnode preset register --input <path> [--name <name>] [--author <name>] [--version <semver>] [--directory <path>]",
    "  glialnode preset local-list [--directory <path>]",
    "  glialnode preset local-show --name <name> [--directory <path>]",
    "  glialnode preset history --name <name> [--directory <path>]",
    "  glialnode preset rollback --name <name> --to-version <semver> [--author <name>] [--directory <path>]",
    "  glialnode preset promote --name <name> --channel <name> --version <semver> [--directory <path>]",
    "  glialnode preset channel-show --name <name> [--channel <name>] [--directory <path>]",
    "  glialnode preset channel-list --name <name> [--directory <path>]",
    "  glialnode preset channel-default --name <name> --channel <name> [--directory <path>]",
    "  glialnode preset channel-export --name <name> --output <path> [--directory <path>]",
    "  glialnode preset channel-import --input <path> [--name <name>] [--directory <path>]",
    "  glialnode preset bundle-export --name <name> --output <path> [--directory <path>]",
    "    [--origin <text>] [--signer <text>] [--signing-private-key <path>] [--signing-public-key <path>]",
    "  glialnode preset bundle-import --input <path> [--name <name>] [--directory <path>] [--require-signer] [--require-signature] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>]",
    "  glialnode preset bundle-show --input <path> [--require-signer] [--require-signature] [--allow-origin <a,b>] [--allow-signer <a,b>] [--allow-key-id <a,b>]",
    "  glialnode space create --name <name> [--description <text>] [--preset balanced-default|execution-first|conservative-review|planning-heavy] [--preset-local <name>] [--preset-channel <name>] [--preset-directory <path>] [--preset-file <path>] [--db <path>]",
    "  glialnode space list [--db <path>]",
    "  glialnode space show --id <id> [--db <path>]",
    "  glialnode space report --id <id> [--recent-events 10] [--db <path>]",
    "  glialnode space maintain --id <id> [--apply] [--db <path>]",
    "  glialnode space configure --id <id> [--preset balanced-default|execution-first|conservative-review|planning-heavy] [--preset-local <name>] [--preset-channel <name>] [--preset-directory <path>] [--preset-file <path>] [--settings <json>] [--short-promote-importance-min 0.95] [--short-promote-confidence-min 0.95] [--mid-promote-importance-min 0.9] [--mid-promote-confidence-min 0.85] [--mid-promote-freshness-min 0.6] [--archive-importance-max 0.3] [--archive-confidence-max 0.4] [--archive-freshness-max 0.3] [--distill-min-cluster-size 2] [--distill-min-token-overlap 2] [--distill-supersede-sources true] [--distill-supersede-min-confidence 0.8] [--conflict-enabled true] [--conflict-min-token-overlap 2] [--conflict-confidence-penalty 0.15] [--decay-enabled true] [--decay-min-age-days 14] [--decay-confidence-per-day 0.01] [--decay-freshness-per-day 0.02] [--decay-min-confidence 0.2] [--decay-min-freshness 0.15] [--routing-prefer-reviewer-on-contested true] [--routing-prefer-reviewer-on-stale true] [--routing-stale-threshold 0.35] [--routing-prefer-executor-on-actionable true] [--routing-prefer-planner-on-distilled true] [--reinforcement-enabled true] [--reinforcement-confidence-boost 0.08] [--reinforcement-freshness-boost 0.12] [--reinforcement-max-confidence 1] [--reinforcement-max-freshness 1] [--retention-short-days 7] [--retention-mid-days 30] [--retention-long-days 90] [--db <path>]",
    "  glialnode scope add --space-id <id> --type <type> [--label <text>] [--external-id <id>] [--parent-scope-id <id>] [--db <path>]",
    "  glialnode scope list --space-id <id> [--db <path>]",
    "  glialnode memory add --space-id <id> --scope-id <id> --scope-type <type> --tier <tier> --kind <kind> --content <text> [--summary <text>] [--compact-content <text>] [--tags a,b] [--visibility <visibility>] [--importance 0.7] [--confidence 0.8] [--freshness 0.6] [--db <path>]",
    "  glialnode memory search --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 10] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>]",
    "  glialnode memory recall --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>]",
    "  glialnode memory trace --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>]",
    "  glialnode memory bundle --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 3] [--support-limit 3] [--bundle-profile balanced|planner|executor|reviewer] [--bundle-consumer auto|balanced|planner|executor|reviewer] [--bundle-max-supporting 3] [--bundle-max-content-chars 240] [--bundle-prefer-compact true] [--reinforce] [--reinforce-limit 3] [--reinforce-strength 1] [--reinforce-reason <text>] [--db <path>]",
    "  glialnode memory list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode memory compact --space-id <id> [--apply] [--db <path>]",
    "  glialnode memory decay --space-id <id> [--apply] [--db <path>]",
    "  glialnode memory reinforce --record-id <id> [--strength 1] [--reason <text>] [--db <path>]",
    "  glialnode memory retain --space-id <id> [--apply] [--db <path>]",
    "  glialnode event add --space-id <id> --scope-id <id> --scope-type <type> --actor-type <type> --actor-id <id> --event-type <type> --summary <text> [--payload <json>] [--db <path>]",
    "  glialnode event list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode link add --space-id <id> --from-record-id <id> --to-record-id <id> --type <relation> [--db <path>]",
    "  glialnode link list --space-id <id> [--record-id <id>] [--limit 10] [--db <path>]",
    "  glialnode export --space-id <id> [--output <path>] [--db <path>]",
    "  glialnode import --input <path> [--db <path>]",
    "  glialnode memory promote --record-id <id> [--db <path>]",
    "  glialnode memory archive --record-id <id> [--db <path>]",
    "  glialnode memory show --record-id <id> [--db <path>]",
  ].join("\n");
}

async function runStatusCommand(context: CommandContext): Promise<CommandResult> {
  const spaces = await context.repository.listSpaces();
  const runtime = context.repository.getRuntimeSettings();

  return {
    lines: [
      `spaces=${spaces.length}`,
      "status=ready",
      `journalMode=${runtime.journalMode.toLowerCase()}`,
      `synchronous=${runtime.synchronous.toLowerCase()}`,
      `busyTimeoutMs=${runtime.busyTimeoutMs}`,
      `foreignKeys=${runtime.foreignKeys ? "on" : "off"}`,
      `defensive=${runtime.defensive === null ? "unsupported" : runtime.defensive ? "on" : "off"}`,
    ],
  };
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

    return {
      lines: [
        `id=${space.id}`,
        `name=${space.name}`,
        `description=${space.description ?? ""}`,
        `settings=${JSON.stringify(space.settings ?? {})}`,
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
    await requireSpace(context.repository, spaceId);
    const report = await context.repository.getSpaceReport(
      spaceId,
      parsed.flags["recent-events"] ? Number(parsed.flags["recent-events"]) : 10,
    );

    return {
      lines: [
        `spaceId=${report.spaceId}`,
        `records=${report.recordCount}`,
        `events=${report.eventCount}`,
        `links=${report.linkCount}`,
        `tiers=${formatCounts(report.recordsByTier)}`,
        `statuses=${formatCounts(report.recordsByStatus)}`,
        `kinds=${formatCounts(report.recordsByKind)}`,
        `recentLifecycleEvents=${report.recentLifecycleEvents.length}`,
        ...report.recentLifecycleEvents.map(
          (event) => `${event.id} ${event.type} ${truncate(event.summary, 100)}`,
        ),
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
    const signingPrivateKeyPem = parsed.flags["signing-private-key"]
      ? readTextFile(resolve(parsed.flags["signing-private-key"]))
      : undefined;
    const signingPublicKeyPem = signingPrivateKeyPem
      ? (parsed.flags["signing-public-key"]
          ? readTextFile(resolve(parsed.flags["signing-public-key"]))
          : createPublicKey(createPrivateKey(signingPrivateKeyPem)).export({ type: "spki", format: "pem" }).toString())
      : undefined;
    const bundle: ReturnType<typeof parsePresetBundle> = {
      metadata: {
        bundleFormatVersion: PRESET_BUNDLE_FORMAT_VERSION,
        glialnodeVersion: GLIALNODE_VERSION,
        nodeEngine: GLIALNODE_NODE_ENGINE,
        origin: parsed.flags.origin,
        signer: parsed.flags.signer,
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
    const validation = validatePresetBundle(imported, parsePresetTrustPolicy(parsed.flags));
    const name = parsed.flags.name ?? imported.preset.name;
    const directory = resolvePresetDirectory(parsed.flags.directory);

    for (const preset of imported.history) {
      writePresetHistoryFile(directory, {
        ...preset,
        name,
      });
    }

    writePresetFiles(directory, {
      ...imported.preset,
      name,
    });
    writePresetChannels(directory, {
      ...imported.channels,
      name,
    });

    return {
      lines: [
        "Preset bundle imported.",
        `name=${name}`,
        `versions=${imported.history.length}`,
        `defaultChannel=${imported.channels.defaultChannel ?? ""}`,
        `trusted=${validation.trusted}`,
        ...validation.warnings.map((warning) => `warning=${warning}`),
      ],
    };
  }

  if (action === "bundle-show") {
    const inputPath = resolve(requireFlag(parsed.flags, "input"));
    const bundle = parsePresetBundle(readTextFile(inputPath));
    const validation = validatePresetBundle(bundle, parsePresetTrustPolicy(parsed.flags));

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
    const records = await context.repository.searchRecords({
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    });

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
    const records = await context.repository.searchRecords({
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 3,
    });

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
    const lines = [`packs=${records.length}`];
    for (const primary of records) {
      const links = await context.repository.listLinksForRecord(primary.id);
      const pack = buildRecallPack(primary, allRecords, links, {
        queryText: parsed.flags.text,
        supportLimit: parsed.flags["support-limit"] ? Number(parsed.flags["support-limit"]) : 3,
      });

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
    const records = await context.repository.searchRecords(query);

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
    const records = await context.repository.searchRecords(query);

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
        routingPolicy: space.settings?.routing,
        maxSupporting: parseOptionalNumber(parsed.flags["bundle-max-supporting"]),
        maxContentChars: parseOptionalNumber(parsed.flags["bundle-max-content-chars"]),
        preferCompact: parsed.flags["bundle-prefer-compact"] !== undefined
          ? parseOptionalBoolean(parsed.flags["bundle-prefer-compact"])
          : undefined,
      }));
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
  const spaces = await context.repository.listSpaces();
  const space = spaces.find((entry) => entry.id === spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  const scopes = await context.repository.listScopes(spaceId);
  const events = await context.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER);
  const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
  const links = await context.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER);

  const output = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      space,
      scopes,
      events,
      records,
      links,
    },
    null,
    2,
  );

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
  const imported = JSON.parse(readTextFile(inputPath)) as SpaceExport;

  await context.repository.createSpace(imported.space);

  for (const scope of imported.scopes) {
    await context.repository.upsertScope(scope);
  }

  for (const event of imported.events) {
    await context.repository.appendEvent(event);
  }

  for (const record of imported.records) {
    await context.repository.writeRecord(record);
  }

  for (const link of imported.links ?? []) {
    await context.repository.linkRecords(link);
  }

  return {
    lines: [
      "Import completed.",
      `spaceId=${imported.space.id}`,
      `scopes=${imported.scopes.length}`,
      `events=${imported.events.length}`,
      `records=${imported.records.length}`,
      `links=${imported.links?.length ?? 0}`,
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
    requireSigner: flags["require-signer"] === "true",
    requireSignature: flags["require-signature"] === "true",
    allowedOrigins: parseCsvFlag(flags["allow-origin"]),
    allowedSigners: parseCsvFlag(flags["allow-signer"]),
    allowedSignerKeyIds: parseCsvFlag(flags["allow-key-id"]),
  };
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
  mkdirSync(channelsDirectory, { recursive: true });
  const channelsPath = join(channelsDirectory, `${toPresetFileName(state.name)}.json`);
  writeFileSync(channelsPath, JSON.stringify(state, null, 2), "utf8");
}

function writePresetFiles(directory: string, preset: ReturnType<typeof parseSpacePresetDefinition>) {
  const outputPath = join(directory, `${toPresetFileName(preset.name)}.json`);
  writeFileSync(outputPath, stringifySpacePresetDefinition(preset), "utf8");

  writePresetHistoryFile(directory, preset);
}

function writePresetHistoryFile(directory: string, preset: ReturnType<typeof parseSpacePresetDefinition>) {
  const historyDirectory = join(directory, ".versions", toPresetFileName(preset.name));
  mkdirSync(historyDirectory, { recursive: true });
  const historyPath = join(
    historyDirectory,
    `${toPresetHistoryTimestamp(preset.updatedAt)}--${toPresetVersionFileName(preset.version ?? "1.0.0")}.json`,
  );
  writeFileSync(historyPath, stringifySpacePresetDefinition(preset), "utf8");
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

function validatePresetBundle(
  bundle: ReturnType<typeof parsePresetBundle>,
  trustPolicy: {
    requireSigner?: boolean;
    requireSignature?: boolean;
    allowedOrigins?: string[];
    allowedSigners?: string[];
    allowedSignerKeyIds?: string[];
  } = {},
) {
  if (bundle.metadata.bundleFormatVersion !== PRESET_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported preset bundle format: ${bundle.metadata.bundleFormatVersion}. Expected ${PRESET_BUNDLE_FORMAT_VERSION}.`,
    );
  }

  const warnings: string[] = [];
  const trustWarnings: string[] = [];
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
  };
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
