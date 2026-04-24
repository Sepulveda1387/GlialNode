import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

import type {
  CompactionPolicy,
  ConflictPolicy,
  DecayPolicy,
  RoutingPolicy,
  ReinforcementPolicy,
  RetentionPolicy,
} from "../core/config.js";
import {
  defaultCompactionPolicy,
  defaultConfig,
  defaultConflictPolicy,
  defaultDecayPolicy,
  defaultReinforcementPolicy,
  defaultRetentionPolicy,
  defaultRoutingPolicy,
} from "../core/config.js";
import { createId } from "../core/ids.js";
import {
  diffSpacePresetDefinitions,
  getSpacePreset,
  getSpacePresetDefinition,
  listSpacePresetDefinitions,
  parseSpacePresetDefinition,
  stringifySpacePresetDefinition,
  type SpacePresetDiff,
  type SpacePresetDefinition,
  type SpacePresetName,
} from "../core/presets.js";
import type {
  ActorType,
  CreateMemoryRecordInput,
  EventType,
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySearchQuery,
  MemorySpace,
  MemorySpaceSettings,
  RecordStatus,
  ScopeRecord,
} from "../core/types.js";
import {
  buildAgentDashboardSnapshot as buildAgentDashboardSnapshotContract,
  buildDashboardOverviewSnapshot as buildDashboardOverviewSnapshotContract,
  buildSpaceDashboardSnapshot as buildSpaceDashboardSnapshotContract,
  type DashboardOverviewSnapshot,
} from "../dashboard/index.js";
import {
  applyCompactionPlan,
  createCompactionDistillationLinks,
  createCompactionDistilledRecords,
  createCompactionEvents,
  createCompactionSummaryLinks,
  createCompactionSummaryRecord,
  planCompaction,
} from "../memory/compaction.js";
import { createConflictEvents, createConflictLinks, detectConflicts } from "../memory/conflicts.js";
import {
  applyDecayPlan,
  createDecayEvents,
  createDecaySummaryLinks,
  createDecaySummaryRecord,
  planDecay,
} from "../memory/decay.js";
import {
  planLearningLoop,
  type LearningLoopOptions,
  type LearningLoopPlan,
} from "../memory/learning.js";
import {
  SqliteMetricsRepository,
  createDisabledMetricsRepository,
  resolveDefaultMetricsDatabasePath,
  type MetricsRepository,
  type RecordTokenUsageInput,
  type TokenUsageFilters,
  type TokenUsageRecord,
  type TokenUsageReport,
  type TokenUsageReportOptions,
} from "../metrics/index.js";
import {
  buildReleaseReadinessReport,
  type ReleaseReadinessInputs,
  type ReleaseReadinessReport,
} from "../release/readiness.js";
import { promoteRecord } from "../memory/promotion.js";
import {
  applyReinforcementPlan,
  createReinforcementEvents,
  createReinforcementSummaryLinks,
  createReinforcementSummaryRecord,
  planReinforcement,
} from "../memory/reinforcement.js";
import {
  buildMemoryBundle,
  buildRecallPack,
  buildRecallTrace,
  formatReplyContextBlock,
  formatReplyContextText,
  rerankRecordsWithSemanticPrototype,
  type MemoryBundle,
  type MemoryBundleConsumer,
  type MemoryBundleProvenanceMode,
  type MemoryBundleProfile,
  type RecallPack,
  type SemanticPrototypeRerankOptions,
  type ReplyContextFormatOptions,
  type RecallTrace,
} from "../memory/retrieval.js";
import {
  applyRetentionPlan,
  createRetentionEvents,
  createRetentionSummaryLinks,
  createRetentionSummaryRecord,
  planRetention,
} from "../memory/retention.js";
import { createMemoryRecord, updateRecordStatus } from "../memory/service.js";
import type { MemoryRepository, SpaceReport } from "../storage/repository.js";
import type { SqliteConnectionPolicy, SqliteWriteMode } from "../storage/sqlite/connection.js";
import { createSerializedLocalRepository } from "../storage/serialized-local-repository.js";
import {
  createServerBackedStorageContract,
  describeStorageAdapter,
  planStorageBackendMigration,
  type StorageAdapterContract,
  type StorageBackendMigrationPlan,
} from "../storage/adapter.js";
import { SqliteMemoryRepository } from "../storage/sqlite/sqlite-repository.js";
import { sqliteAdapter } from "../storage/sqlite/sqlite-adapter.js";

export interface GlialNodeClientOptions {
  filename?: string;
  repository?: MemoryRepository;
  presetDirectory?: string;
  sqlite?: Partial<SqliteConnectionPolicy>;
  writeMode?: SqliteWriteMode;
  metrics?: GlialNodeMetricsOptions;
}

export interface GlialNodeMetricsOptions {
  filename?: string;
  repository?: MetricsRepository;
  disabled?: boolean;
  sqlite?: Partial<SqliteConnectionPolicy>;
}

export interface DashboardSnapshotBuildOptions {
  staleFreshnessThreshold?: number;
  latestBackupAt?: string;
  tokenUsage?: TokenUsageReportOptions;
}

export interface CreateSpaceInput {
  name: string;
  description?: string;
  preset?: SpacePresetName;
  presetLocalName?: string;
  presetChannel?: string;
  presetDirectory?: string;
  presetDefinition?: SpacePresetDefinition;
  settings?: MemorySpaceSettings;
}

export interface ConfigureSpaceInput {
  spaceId: string;
  preset?: SpacePresetName;
  presetLocalName?: string;
  presetChannel?: string;
  presetDirectory?: string;
  presetDefinition?: SpacePresetDefinition;
  settings?: MemorySpaceSettings;
  compaction?: Partial<CompactionPolicy>;
  conflict?: Partial<ConflictPolicy>;
  decay?: Partial<DecayPolicy>;
  routing?: Partial<RoutingPolicy>;
  reinforcement?: Partial<ReinforcementPolicy>;
  retentionDays?: Partial<RetentionPolicy>;
}

export interface AddScopeInput {
  spaceId: string;
  type: ScopeRecord["type"];
  externalId?: string;
  label?: string;
  parentScopeId?: string;
}

export interface AddEventInput {
  spaceId: string;
  scope: MemoryEvent["scope"];
  actorType: ActorType;
  actorId: string;
  type: EventType;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface AddLinkInput {
  spaceId: string;
  fromRecordId: string;
  toRecordId: string;
  type: MemoryRecordLink["type"];
}

export interface SpaceSnapshotMetadata {
  snapshotFormatVersion: number;
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
}

export interface SpaceSnapshot {
  metadata: SpaceSnapshotMetadata;
  exportedAt: string;
  space: MemorySpace;
  scopes: ScopeRecord[];
  events: MemoryEvent[];
  records: MemoryRecord[];
  links: MemoryRecordLink[];
}

export interface SpaceGraphExportOptions {
  includeScopes?: boolean;
  includeEvents?: boolean;
}

export type SpaceGraphExportFormat = "native" | "cytoscape" | "dot";

export interface SpaceGraphExportToFileOptions extends SpaceGraphExportOptions {
  format?: SpaceGraphExportFormat;
}

export type SpaceGraphNodeType = "space" | "scope" | "record" | "event";

export interface SpaceGraphNode {
  id: string;
  type: SpaceGraphNodeType;
  label: string;
  scopeType?: ScopeRecord["type"];
  parentScopeId?: string;
  tier?: MemoryRecord["tier"];
  kind?: MemoryRecord["kind"];
  status?: MemoryRecord["status"];
  visibility?: MemoryRecord["visibility"];
  eventType?: MemoryEvent["type"];
  actorType?: MemoryEvent["actorType"];
  actorId?: string;
  scopeId?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  freshness?: number;
  summary?: string;
  createdAt: string;
  updatedAt?: string;
}

export type SpaceGraphEdgeType =
  | "contains_scope"
  | "contains_record"
  | "contains_event"
  | "scope_parent"
  | "record_link"
  | "source_event";

export interface SpaceGraphEdge {
  id: string;
  type: SpaceGraphEdgeType;
  fromId: string;
  toId: string;
  label: string;
  relation?: MemoryRecordLink["type"];
  createdAt: string;
}

export interface SpaceGraphExport {
  metadata: {
    schemaVersion: 1;
    exportedAt: string;
    spaceId: string;
    spaceName: string;
    nodeCount: number;
    edgeCount: number;
    options: {
      includeScopes: boolean;
      includeEvents: boolean;
    };
  };
  counts: {
    scopes: number;
    events: number;
    records: number;
    links: number;
  };
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
}

export interface SpaceGraphCytoscapeExport {
  metadata: SpaceGraphExport["metadata"];
  counts: SpaceGraphExport["counts"];
  elements: {
    nodes: Array<{ data: SpaceGraphNode }>;
    edges: Array<{ data: SpaceGraphEdge & { source: string; target: string } }>;
  };
}

export interface SpaceInspectorSnapshotOptions extends SpaceGraphExportOptions {
  recentEventLimit?: number;
  includeTrustRegistry?: boolean;
  presetDirectory?: string;
  recall?: SpaceInspectorRecallOptions;
}

export interface SpaceInspectorRecallOptions {
  query: Omit<MemorySearchQuery, "spaceId">;
  primaryLimit?: number;
  supportLimit?: number;
  bundleConsumer?: MemoryBundleConsumer;
  bundleProvenanceMode?: MemoryBundleProvenanceMode;
}

export interface SpaceInspectorPolicyView {
  effective: {
    maxShortTermRecords: number;
    retentionDays: {
      short?: number;
      mid?: number;
      long?: number;
    };
    compaction: CompactionPolicy;
    conflict: ConflictPolicy;
    decay: DecayPolicy;
    reinforcement: ReinforcementPolicy;
    routing: RoutingPolicy;
    provenance: {
      trustProfile?: SpaceSnapshotTrustProfile;
      trustedSignerNames?: string[];
      allowedOrigins?: string[];
      allowedSigners?: string[];
      allowedSignerKeyIds?: string[];
    };
  };
  origin: {
    maxShortTermRecords: "space" | "default";
    retentionDays: {
      short: "space" | "default";
      mid: "space" | "default";
      long: "space" | "unset";
    };
    compaction: Record<keyof CompactionPolicy, "space" | "default">;
    conflict: Record<keyof ConflictPolicy, "space" | "default">;
    decay: Record<keyof DecayPolicy, "space" | "default">;
    reinforcement: Record<keyof ReinforcementPolicy, "space" | "default">;
    routing: Record<keyof RoutingPolicy, "space" | "default">;
    provenance: {
      trustProfile: "space" | "unset";
      trustedSignerNames: "space" | "unset";
      allowedOrigins: "space" | "unset";
      allowedSigners: "space" | "unset";
      allowedSignerKeyIds: "space" | "unset";
    };
  };
}

export interface SpaceInspectorSnapshot {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
  };
  space: MemorySpace;
  report: SpaceReport;
  risk: SpaceInspectorRiskSummary;
  policy: SpaceInspectorPolicyView;
  graph: SpaceGraphExport;
  recall?: {
    query: MemorySearchQuery;
    traceCount: number;
    traces: RecallTrace[];
    bundles: MemoryBundle[];
  };
  trustRegistry?: {
    trustedSigners: TrustedSignerSummary[];
    trustPolicyPacks: Array<{
      name: string;
      description?: string;
      inheritsFrom?: string;
      baseProfile?: PresetBundleTrustProfileName;
      updatedAt: string;
      policy: PresetBundleTrustPolicy;
    }>;
  };
}

export interface SpaceInspectorExportResult {
  outputPath: string;
  snapshot: SpaceInspectorSnapshot;
}

export interface SpaceInspectorSnapshotExportResult {
  outputPath: string;
  snapshot: SpaceInspectorSnapshot;
}

export interface SpaceInspectorIndexSnapshotOptions {
  recentEventLimit?: number;
  includeTrustRegistry?: boolean;
  includeGraphCounts?: boolean;
  presetDirectory?: string;
}

export interface SpaceInspectorIndexSnapshot {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
    spaceCount: number;
  };
  totals: {
    records: number;
    events: number;
    links: number;
    graphNodes: number;
    graphEdges: number;
    spacesNeedingTrustReview: number;
    spacesWithContestedMemory: number;
    spacesWithStaleMemory: number;
  };
  spaces: Array<{
    space: {
      id: string;
      name: string;
      description?: string;
      updatedAt: string;
    };
    report: {
      recordCount: number;
      eventCount: number;
      linkCount: number;
      provenanceSummaryCount: number;
      latestMaintenanceAt?: string;
    };
    policy: {
      maxShortTermRecords: number;
      provenanceTrustProfile?: SpaceSnapshotTrustProfile;
    };
    risk: SpaceInspectorRiskSummary;
    graph?: {
      nodes: number;
      edges: number;
    };
  }>;
  trustRegistry?: SpaceInspectorSnapshot["trustRegistry"];
}

export interface SpaceInspectorIndexExportResult {
  outputPath: string;
  snapshot: SpaceInspectorIndexSnapshot;
}

export interface SpaceInspectorIndexSnapshotExportResult {
  outputPath: string;
  snapshot: SpaceInspectorIndexSnapshot;
}

export interface SpaceInspectorPackExportOptions {
  recentEventLimit?: number;
  includeScopes?: boolean;
  includeEvents?: boolean;
  includeTrustRegistry?: boolean;
  includeGraphCounts?: boolean;
  presetDirectory?: string;
  recall?: SpaceInspectorRecallOptions;
  captureScreenshots?: boolean;
  screenshotViewport?: {
    width: number;
    height: number;
  };
}

export interface SpaceInspectorPackManifest {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
    outputDirectory: string;
    spaceCount: number;
  };
  files: {
    indexHtml: string;
    indexSnapshot: string;
    indexScreenshot?: string;
  };
  spaces: Array<{
    spaceId: string;
    spaceName: string;
    html: string;
    snapshot: string;
    screenshot?: string;
    riskLevel: SpaceInspectorRiskSummary["riskLevel"];
  }>;
  totals: SpaceInspectorIndexSnapshot["totals"];
}

export interface SpaceInspectorPackExportResult {
  outputDirectory: string;
  manifestPath: string;
  manifest: SpaceInspectorPackManifest;
}

export interface SpaceInspectorRiskSummary {
  contestedMemoryEvents: number;
  decayedMemoryEvents: number;
  provenanceSummaryRecords: number;
  needsTrustReview: boolean;
  maintenanceStale: boolean;
  riskLevel: "low" | "moderate" | "high";
}

export interface ExportSpaceSnapshotOptions {
  origin?: string;
  signer?: string;
  signingPrivateKeyPem?: string;
}

export interface SpaceSnapshotTrustPolicy {
  requireSigner?: boolean;
  requireSignature?: boolean;
  allowedOrigins?: string[];
  allowedSigners?: string[];
  allowedSignerKeyIds?: string[];
  trustedSignerNames?: string[];
}

export type SpaceSnapshotTrustProfile = "permissive" | "signed" | "anchored";

export interface SpaceSnapshotValidationResult {
  metadata: SpaceSnapshotMetadata;
  warnings: string[];
  trustWarnings: string[];
  trusted: boolean;
  report: {
    trustProfile: SpaceSnapshotTrustProfile;
    effectivePolicy: SpaceSnapshotTrustPolicy;
    signerKeyId?: string;
    matchedTrustedSignerNames: string[];
    revokedTrustedSignerNames: string[];
    signed: boolean;
    legacySnapshot: boolean;
  };
}

export interface ImportSpaceSnapshotOptions {
  trustPolicy?: SpaceSnapshotTrustPolicy;
  trustProfile?: SpaceSnapshotTrustProfile;
  directory?: string;
  collisionPolicy?: ImportCollisionPolicy;
}

export type ImportCollisionPolicy = "error" | "overwrite" | "rename";

export interface SnapshotImportPreview {
  collisionPolicy: ImportCollisionPolicy;
  trustProfile: SpaceSnapshotTrustProfile;
  requestedSpace: {
    id: string;
    name: string;
  };
  targetSpace: {
    id: string;
    name: string;
  };
  existingSpace: {
    id: string;
    name: string;
  } | null;
  identityRemapped: boolean;
  applyAllowed: boolean;
  blockingIssues: string[];
  importedCounts: {
    scopes: number;
    events: number;
    records: number;
    links: number;
  };
  snapshotMetadata: {
    snapshotFormatVersion: number;
    signed: boolean;
  };
  validation: SpaceSnapshotValidationResult | null;
}

export interface ImportPresetBundleOptions {
  directory?: string;
  name?: string;
  trustPolicy?: PresetBundleTrustPolicy;
  trustProfile?: PresetBundleTrustProfileName;
  collisionPolicy?: ImportCollisionPolicy;
}

export interface MaintenanceResult {
  compactionPlan: ReturnType<typeof planCompaction>;
  decayPlan: ReturnType<typeof planDecay>;
  retentionPlan: ReturnType<typeof planRetention>;
  applied: boolean;
}

export interface ReinforceRecordOptions {
  reason?: string;
  strength?: number;
  now?: Date;
}

export interface SearchReinforcementOptions extends ReinforceRecordOptions {
  enabled?: boolean;
  limit?: number;
}

export interface SearchSemanticOptions extends SemanticPrototypeRerankOptions {
  enabled?: boolean;
}

export interface RecallOptions {
  reinforce?: SearchReinforcementOptions;
  semantic?: SearchSemanticOptions;
  primaryLimit?: number;
  supportLimit?: number;
  includeSameScopeDistilled?: boolean;
  bundleProfile?: MemoryBundleProfile;
  bundleConsumer?: MemoryBundleConsumer;
  bundleMaxSupporting?: number;
  bundleMaxContentChars?: number;
  bundlePreferCompact?: boolean;
  bundleProvenanceMode?: MemoryBundleProvenanceMode;
}

export interface PrepareReplyContextOptions extends RecallOptions, ReplyContextFormatOptions {
  maxEntries?: number;
  formatter?: (entry: PreparedReplyContextEntry, index: number) => string;
}

export interface PreparedReplyContextEntry {
  pack: RecallPack;
  trace: RecallTrace;
  bundle: MemoryBundle;
  text: string;
}

export interface PreparedReplyContext {
  queryText?: string;
  entries: PreparedReplyContextEntry[];
  text: string;
}

export interface StorageMigrationPlanOptions {
  target?: "postgres" | "server-backed" | string;
  targetSchemaVersion?: number;
  targetFullTextSearch?: boolean;
}

export type ReleaseReadinessOptions = ReleaseReadinessInputs;

export interface PresetChannelState {
  name: string;
  channels: Record<string, string>;
  defaultChannel?: string;
}

export interface SigningKeyRecord {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  updatedAt: string;
}

export interface SigningKeySummary {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedSignerRecord {
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
}

export interface TrustedSignerSummary {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  replacedBy?: string;
}

export interface TrustPolicyPackRecord {
  name: string;
  description?: string;
  inheritsFrom?: string;
  baseProfile?: PresetBundleTrustProfileName;
  policy: PresetBundleTrustPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterTrustPolicyPackOptions {
  description?: string;
  inheritsFrom?: string;
  baseProfile?: PresetBundleTrustProfileName;
  policy?: PresetBundleTrustPolicy;
  directory?: string;
  overwrite?: boolean;
}

export interface PresetBundle {
  metadata: PresetBundleMetadata;
  exportedAt: string;
  preset: SpacePresetDefinition;
  history: SpacePresetDefinition[];
  channels: PresetChannelState;
}

export interface PresetBundleMetadata {
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
}

export interface PresetBundleValidation {
  metadata: PresetBundleMetadata;
  warnings: string[];
  trustWarnings: string[];
  trusted: boolean;
  report: {
    trustProfile: PresetBundleTrustProfileName;
    effectivePolicy: PresetBundleTrustPolicy;
    signerKeyId?: string;
    matchedTrustedSignerNames: string[];
    revokedTrustedSignerNames: string[];
    signed: boolean;
  };
}

export interface PresetBundleTrustPolicy {
  requireSigner?: boolean;
  requireSignature?: boolean;
  allowedOrigins?: string[];
  allowedSigners?: string[];
  allowedSignerKeyIds?: string[];
  trustedSignerNames?: string[];
}

export type PresetBundleTrustProfileName = "permissive" | "signed" | "anchored";

const PRESET_BUNDLE_FORMAT_VERSION = 1;
const SPACE_SNAPSHOT_FORMAT_VERSION = 1;
const GLIALNODE_VERSION = "0.1.0";
const GLIALNODE_NODE_ENGINE = ">=24";

export class GlialNodeClient {
  private readonly repository: MemoryRepository;
  private readonly closeRepository: (() => void) | null;
  private readonly presetDirectory: string;
  private readonly metricsOptions: GlialNodeMetricsOptions;
  private readonly memoryDatabasePath?: string;
  private metricsRepository: MetricsRepository | null;
  private closeMetricsRepository: (() => void) | null;

  constructor(options: GlialNodeClientOptions = {}) {
    const writeMode = options.writeMode ?? options.sqlite?.writeMode ?? "single_writer";
    this.metricsOptions = options.metrics ?? {};
    this.metricsRepository = this.metricsOptions.disabled
      ? createDisabledMetricsRepository()
      : this.metricsOptions.repository ?? null;
    this.closeMetricsRepository = null;

    if (options.repository) {
      this.repository = writeMode === "serialized_local"
        ? createSerializedLocalRepository(options.repository)
        : options.repository;
      this.closeRepository = null;
      this.memoryDatabasePath = options.filename ? resolve(options.filename) : undefined;
      this.presetDirectory = resolve(options.presetDirectory ?? ".glialnode/presets");
      return;
    }

    const filename = resolve(options.filename ?? ".glialnode/glialnode.sqlite");
    mkdirSync(dirname(filename), { recursive: true });
    const repository = new SqliteMemoryRepository({
      filename,
      connection: {
        ...options.sqlite,
        writeMode,
      },
    });
    this.repository = writeMode === "serialized_local"
      ? createSerializedLocalRepository(repository)
      : repository;
    this.closeRepository = () => repository.close();
    this.memoryDatabasePath = filename;
    this.presetDirectory = resolve(options.presetDirectory ?? join(dirname(filename), "presets"));
  }

  async createSpace(input: CreateSpaceInput): Promise<MemorySpace> {
    const timestamp = new Date().toISOString();
    const channelPreset = input.presetLocalName && (input.presetChannel || this.listPresetChannels(
      input.presetLocalName,
      input.presetDirectory,
    ).defaultChannel)
      ? this.resolvePresetChannel(input.presetLocalName, {
          channel: input.presetChannel,
          directory: input.presetDirectory,
        })
      : undefined;
    const settings = mergeSpaceSettings(
      input.preset ? getSpacePreset(input.preset) : undefined,
      channelPreset?.settings,
      input.presetDefinition?.settings,
      input.settings,
    );
    const space: MemorySpace = {
      id: createId("space"),
      name: input.name,
      description: input.description,
      settings,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.createSpace(space);
    return space;
  }

  async listSpaces(): Promise<MemorySpace[]> {
    return this.repository.listSpaces();
  }

  getStorageContract(): StorageAdapterContract {
    return describeStorageAdapter(sqliteAdapter);
  }

  planStorageMigration(options: StorageMigrationPlanOptions = {}): StorageBackendMigrationPlan {
    const target = createServerBackedStorageContract({
      name: options.target ?? "server-backed",
      dialect: options.target === "postgres" || options.target === undefined
        ? "postgres"
        : options.target,
      schemaVersion: options.targetSchemaVersion ?? 1,
      fullTextSearch: options.targetFullTextSearch ?? true,
    });

    return planStorageBackendMigration(sqliteAdapter, target);
  }

  buildReleaseReadinessReport(options: ReleaseReadinessOptions = {}): ReleaseReadinessReport {
    return buildReleaseReadinessReport(options);
  }

  async recordTokenUsage(input: RecordTokenUsageInput): Promise<TokenUsageRecord> {
    return this.getMetricsRepository().recordTokenUsage(input);
  }

  async listTokenUsage(filters: TokenUsageFilters = {}): Promise<TokenUsageRecord[]> {
    return this.getMetricsRepository().listTokenUsage(filters);
  }

  async getTokenUsageReport(options: TokenUsageReportOptions = {}): Promise<TokenUsageReport> {
    return this.getMetricsRepository().getTokenUsageReport(options);
  }

  async buildDashboardOverviewSnapshot(options: DashboardSnapshotBuildOptions = {}): Promise<DashboardOverviewSnapshot> {
    const spaces = await this.repository.listSpaces();
    const memory = await this.summarizeDashboardMemory(spaces.map((space) => space.id), options);
    const tokenUsageReport = await this.getDashboardTokenUsageReport(options.tokenUsage);

    return buildDashboardOverviewSnapshotContract({
      activeSpaces: spaces.length,
      activeRecords: memory.activeRecords,
      staleRecords: memory.staleRecords,
      tokenUsageReport,
      storageBytes: this.getMemoryDatabaseBytes(),
      latestBackupAt: options.latestBackupAt,
      maintenanceDue: memory.maintenanceDue,
    });
  }

  async buildSpaceDashboardSnapshot(
    spaceId: string,
    options: DashboardSnapshotBuildOptions = {},
  ): Promise<DashboardOverviewSnapshot> {
    const memory = await this.summarizeDashboardMemory([spaceId], options);
    const tokenUsageReport = await this.getDashboardTokenUsageReport({
      ...options.tokenUsage,
      spaceId,
    });

    return buildSpaceDashboardSnapshotContract({
      scope: { spaceId },
      activeSpaces: 1,
      activeRecords: memory.activeRecords,
      staleRecords: memory.staleRecords,
      tokenUsageReport,
      storageBytes: this.getMemoryDatabaseBytes(),
      latestBackupAt: options.latestBackupAt,
      maintenanceDue: memory.maintenanceDue,
    });
  }

  async buildAgentDashboardSnapshot(
    agentId: string,
    options: DashboardSnapshotBuildOptions = {},
  ): Promise<DashboardOverviewSnapshot> {
    const spaces = await this.repository.listSpaces();
    const memory = await this.summarizeDashboardMemoryForAgent(agentId, spaces.map((space) => space.id), options);
    const tokenUsageReport = await this.getDashboardTokenUsageReport({
      ...options.tokenUsage,
      agentId,
    });

    return buildAgentDashboardSnapshotContract({
      scope: { agentId },
      activeSpaces: memory.activeSpaces,
      activeRecords: memory.activeRecords,
      staleRecords: memory.staleRecords,
      tokenUsageReport,
      storageBytes: this.getMemoryDatabaseBytes(),
      latestBackupAt: options.latestBackupAt,
      maintenanceDue: memory.maintenanceDue,
    });
  }

  listPresets(): SpacePresetDefinition[] {
    return listSpacePresetDefinitions();
  }

  getPreset(name: SpacePresetName): SpacePresetDefinition {
    return getSpacePresetDefinition(name);
  }

  diffPresets(left: SpacePresetDefinition, right: SpacePresetDefinition): SpacePresetDiff {
    return diffSpacePresetDefinitions(left, right);
  }

  exportPreset(name: SpacePresetName, outputPath: string): SpacePresetDefinition {
    const preset = {
      ...getSpacePresetDefinition(name),
      updatedAt: new Date().toISOString(),
    };
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, stringifySpacePresetDefinition(preset), "utf8");
    return preset;
  }

  loadPreset(inputPath: string): SpacePresetDefinition {
    return parseSpacePresetDefinition(readFileSync(resolve(inputPath), "utf8"));
  }

  registerPreset(
    inputPath: string,
    options: { name?: string; directory?: string; author?: string; version?: string } = {},
  ): SpacePresetDefinition {
    const preset = this.loadPreset(inputPath);
    const now = new Date().toISOString();
    const registered: SpacePresetDefinition = {
      ...preset,
      name: options.name ?? preset.name,
      version: options.version ?? preset.version ?? "1.0.0",
      author: options.author ?? preset.author,
      source: inputPath,
      createdAt: preset.createdAt ?? now,
      updatedAt: now,
    };
    const directory = resolve(options.directory ?? this.presetDirectory);
    mkdirSync(directory, { recursive: true });
    writePresetFiles(directory, registered);
    return registered;
  }

  generateSigningKey(
    name: string,
    options: { directory?: string; signer?: string; overwrite?: boolean } = {},
  ): SigningKeySummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const existingPath = getSigningKeyPath(directory, name);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Signing key already exists: ${name}`);
    }

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const timestamp = new Date().toISOString();
    const record: SigningKeyRecord = {
      name,
      algorithm: "ed25519",
      signer: options.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      privateKeyPem,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeSigningKeyRecord(directory, record);
    return toSigningKeySummary(record);
  }

  listSigningKeys(directory?: string): SigningKeySummary[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listSigningKeyRecords(resolvedDirectory).map((record) => toSigningKeySummary(record));
  }

  getSigningKey(name: string, directory?: string): SigningKeyRecord {
    return readSigningKeyRecord(resolve(directory ?? this.presetDirectory), name);
  }

  exportSigningPublicKey(name: string, outputPath: string, directory?: string): SigningKeySummary {
    const record = this.getSigningKey(name, directory);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, record.publicKeyPem, "utf8");
    return toSigningKeySummary(record);
  }

  trustSigningKey(
    name: string,
    options: { trustName?: string; directory?: string; signer?: string; overwrite?: boolean } = {},
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const key = this.getSigningKey(name, directory);
    const trustName = options.trustName ?? name;
    const existingPath = getTrustedSignerPath(directory, trustName);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Trusted signer already exists: ${trustName}`);
    }

    const timestamp = new Date().toISOString();
    const record: TrustedSignerRecord = {
      name: trustName,
      algorithm: "ed25519",
      signer: options.signer ?? key.signer,
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      source: `signing-key:${name}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);
    return toTrustedSignerSummary(record);
  }

  registerTrustedSignerFromPublicKey(
    inputPath: string,
    options: { name: string; directory?: string; signer?: string; source?: string; overwrite?: boolean },
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const existingPath = getTrustedSignerPath(directory, options.name);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Trusted signer already exists: ${options.name}`);
    }

    const publicKeyPem = readFileSync(resolve(inputPath), "utf8");
    const timestamp = new Date().toISOString();
    const record: TrustedSignerRecord = {
      name: options.name,
      algorithm: "ed25519",
      signer: options.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      source: options.source ?? inputPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);
    return toTrustedSignerSummary(record);
  }

  listTrustedSigners(directory?: string): TrustedSignerSummary[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listTrustedSignerRecords(resolvedDirectory).map((record) => toTrustedSignerSummary(record));
  }

  listPresetBundleTrustProfiles(): PresetBundleTrustProfileName[] {
    return ["permissive", "signed", "anchored"];
  }

  registerTrustPolicyPack(
    name: string,
    options: RegisterTrustPolicyPackOptions = {},
  ): TrustPolicyPackRecord {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const existingPath = getTrustPolicyPackPath(directory, name);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Trust policy pack already exists: ${name}`);
    }

    const timestamp = new Date().toISOString();
    const next: TrustPolicyPackRecord = {
      name,
      description: options.description,
      inheritsFrom: options.inheritsFrom,
      baseProfile: options.baseProfile,
      policy: options.policy ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (options.inheritsFrom) {
      // Verify inheritance target exists early for safer operator feedback.
      this.getTrustPolicyPack(options.inheritsFrom, directory);
    }
    writeTrustPolicyPackRecord(directory, next);
    return next;
  }

  listTrustPolicyPacks(directory?: string): TrustPolicyPackRecord[] {
    return listTrustPolicyPackRecords(resolve(directory ?? this.presetDirectory));
  }

  getTrustPolicyPack(name: string, directory?: string): TrustPolicyPackRecord {
    return readTrustPolicyPackRecord(resolve(directory ?? this.presetDirectory), name);
  }

  resolveTrustPolicyPack(name: string, directory?: string): TrustPolicyPackRecord {
    return resolveTrustPolicyPackRecord(name, resolve(directory ?? this.presetDirectory));
  }

  getTrustedSigner(name: string, directory?: string): TrustedSignerRecord {
    return readTrustedSignerRecord(resolve(directory ?? this.presetDirectory), name);
  }

  revokeTrustedSigner(
    name: string,
    options: { directory?: string; replacedBy?: string } = {},
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const record = this.getTrustedSigner(name, directory);
    const revoked: TrustedSignerRecord = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
      replacedBy: options.replacedBy ?? record.replacedBy,
      updatedAt: new Date().toISOString(),
    };
    writeTrustedSignerRecord(directory, revoked);
    return toTrustedSignerSummary(revoked);
  }

  rotateTrustedSigner(
    currentName: string,
    inputPath: string,
    options: { nextName: string; directory?: string; signer?: string; source?: string; overwrite?: boolean },
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const next = this.registerTrustedSignerFromPublicKey(inputPath, {
      name: options.nextName,
      directory,
      signer: options.signer,
      source: options.source,
      overwrite: options.overwrite,
    });
    this.revokeTrustedSigner(currentName, {
      directory,
      replacedBy: next.name,
    });
    return next;
  }

  listRegisteredPresets(directory?: string): SpacePresetDefinition[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    if (!existsSync(resolvedDirectory)) {
      return [];
    }

    return readdirSync(resolvedDirectory)
      .filter((entry) => entry.toLowerCase().endsWith(".json"))
      .map((entry) => this.loadPreset(join(resolvedDirectory, entry)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getRegisteredPreset(name: string, directory?: string): SpacePresetDefinition {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const candidatePath = join(resolvedDirectory, `${toPresetFileName(name)}.json`);
    if (existsSync(candidatePath)) {
      return this.loadPreset(candidatePath);
    }

    const preset = this.listRegisteredPresets(resolvedDirectory).find((entry) => entry.name === name);
    if (!preset) {
      throw new Error(`Unknown registered preset: ${name}`);
    }

    return preset;
  }

  listRegisteredPresetHistory(name: string, directory?: string): SpacePresetDefinition[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listRegisteredPresetHistoryFromDirectory(name, resolvedDirectory, (inputPath) => this.loadPreset(inputPath));
  }

  rollbackRegisteredPreset(
    name: string,
    options: { version: string; directory?: string; author?: string },
  ): SpacePresetDefinition {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const target = requirePresetHistoryVersion(
      this.listRegisteredPresetHistory(name, resolvedDirectory),
      name,
      options.version,
    );
    const now = new Date().toISOString();
    const rolledBack: SpacePresetDefinition = {
      ...target,
      name,
      author: options.author ?? target.author,
      source: `rollback:${options.version}`,
      updatedAt: now,
    };

    mkdirSync(resolvedDirectory, { recursive: true });
    writePresetFiles(resolvedDirectory, rolledBack);
    return rolledBack;
  }

  listPresetChannels(name: string, directory?: string): PresetChannelState {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return readPresetChannels(resolvedDirectory, name);
  }

  setDefaultPresetChannel(
    name: string,
    options: { channel: string; directory?: string },
  ): PresetChannelState {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const current = readPresetChannels(resolvedDirectory, name);
    if (!current.channels[options.channel]) {
      throw new Error(`Unknown preset channel for ${name}: ${options.channel}`);
    }

    const next: PresetChannelState = {
      ...current,
      defaultChannel: options.channel,
    };
    writePresetChannels(resolvedDirectory, next);
    return next;
  }

  exportPresetChannels(name: string, outputPath: string, directory?: string): PresetChannelState {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const state = readPresetChannels(resolvedDirectory, name);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(state, null, 2), "utf8");
    return state;
  }

  importPresetChannels(inputPath: string, options: { directory?: string; name?: string } = {}): PresetChannelState {
    const parsed = parsePresetChannelState(readFileSync(resolve(inputPath), "utf8"));
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const state: PresetChannelState = {
      ...parsed,
      name: options.name ?? parsed.name,
    };
    writePresetChannels(resolvedDirectory, state);
    return state;
  }

  exportPresetBundle(
    name: string,
    outputPath: string,
    directory?: string,
    trust?: {
      origin?: string;
      signer?: string;
      signingKeyName?: string;
      signingPrivateKeyPem?: string;
      signingPublicKeyPem?: string;
    },
  ): PresetBundle {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const resolvedSigningKey = trust?.signingKeyName
      ? this.getSigningKey(trust.signingKeyName, resolvedDirectory)
      : undefined;
    const signerPublicKeyPem = trust?.signingPrivateKeyPem
      ? (trust.signingPublicKeyPem ?? createPublicKey(createPrivateKey(trust.signingPrivateKeyPem)).export({
          type: "spki",
          format: "pem",
        }).toString())
      : resolvedSigningKey?.publicKeyPem
      ? resolvedSigningKey.publicKeyPem
      : undefined;
    const bundle: PresetBundle = {
      metadata: {
        bundleFormatVersion: PRESET_BUNDLE_FORMAT_VERSION,
        glialnodeVersion: GLIALNODE_VERSION,
        nodeEngine: GLIALNODE_NODE_ENGINE,
        origin: trust?.origin,
        signer: trust?.signer ?? resolvedSigningKey?.signer,
        checksumAlgorithm: "sha256",
        checksum: "",
        signatureAlgorithm: signerPublicKeyPem ? "ed25519" : undefined,
        signerKeyId: signerPublicKeyPem ? computeSignerKeyId(signerPublicKeyPem) : undefined,
        signerPublicKey: signerPublicKeyPem,
        signature: undefined,
      },
      exportedAt: new Date().toISOString(),
      preset: this.getRegisteredPreset(name, resolvedDirectory),
      history: this.listRegisteredPresetHistory(name, resolvedDirectory),
      channels: this.listPresetChannels(name, resolvedDirectory),
    };
    bundle.metadata.checksum = computePresetBundleChecksum(bundle);
    const signingPrivateKeyPem = trust?.signingPrivateKeyPem ?? resolvedSigningKey?.privateKeyPem;
    if (signingPrivateKeyPem) {
      bundle.metadata.signature = computePresetBundleSignature(bundle, signingPrivateKeyPem);
    }
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(bundle, null, 2), "utf8");
    return bundle;
  }

  importPresetBundle(
    inputPath: string,
    options: ImportPresetBundleOptions = {},
  ): PresetBundle {
    const bundle = parsePresetBundle(readFileSync(resolve(inputPath), "utf8"));
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    validatePresetBundle(
      bundle,
      resolvePresetBundleTrustPolicy(options.trustPolicy, resolvedDirectory, options.trustProfile),
      options.trustProfile ?? "permissive",
    );
    const requestedName = options.name ?? bundle.preset.name;
    const nextName = resolvePresetImportName(
      resolvedDirectory,
      requestedName,
      options.collisionPolicy ?? "error",
    );
    const history = bundle.history.map((preset) => ({
      ...preset,
      name: nextName,
    }));
    for (const preset of history) {
      writePresetHistoryFile(resolvedDirectory, preset);
    }

    const activePreset: SpacePresetDefinition = {
      ...bundle.preset,
      name: nextName,
    };
    writePresetFiles(resolvedDirectory, activePreset);

    const channels: PresetChannelState = {
      ...bundle.channels,
      name: nextName,
    };
    writePresetChannels(resolvedDirectory, channels);

    return {
      ...bundle,
      preset: activePreset,
      history,
      channels,
    };
  }

  async importPresetBundleForSpace(
    inputPath: string,
    options: {
      spaceId: string;
      directory?: string;
      name?: string;
      trustPolicy?: PresetBundleTrustPolicy;
      trustProfile?: PresetBundleTrustProfileName;
      collisionPolicy?: ImportCollisionPolicy;
    },
  ): Promise<PresetBundle> {
    const space = await requireSpace(this.repository, options.spaceId);
    const provenanceSettings = space.settings?.provenance;
    const trustProfile = options.trustProfile ?? provenanceSettings?.trustProfile ?? "permissive";
    const sourceBundle = parsePresetBundle(readFileSync(resolve(inputPath), "utf8"));

    const imported = this.importPresetBundle(inputPath, {
      directory: options.directory,
      name: options.name,
      trustPolicy: mergePresetBundleTrustPolicyFromSettings(options.trustPolicy, provenanceSettings),
      trustProfile,
      collisionPolicy: options.collisionPolicy,
    });

    await ensureSpaceAuditScope(this.repository, space.id);
    const event = createPresetBundleAuditEvent(space.id, "bundle_imported", `Imported preset bundle ${imported.preset.name}.`, {
      bundleName: sourceBundle.preset.name,
      importedPresetName: imported.preset.name,
      trusted: true,
      trustProfile,
      signer: imported.metadata.signer,
      signerKeyId: imported.metadata.signerKeyId,
      origin: imported.metadata.origin,
      matchedTrustedSignerNames: [],
      warnings: [],
    });
    await this.repository.appendEvent(event);
    await this.repository.writeRecord(createPresetBundleAuditSummaryRecord(space.id, event));

    return imported;
  }

  validatePresetBundle(
    inputPath: string,
    trustPolicy?: PresetBundleTrustPolicy,
    trustProfile?: PresetBundleTrustProfileName,
  ): PresetBundleValidation {
    const resolvedDirectory = resolve(this.presetDirectory);
    const bundle = parsePresetBundle(readFileSync(resolve(inputPath), "utf8"));
    return validatePresetBundle(
      bundle,
      resolvePresetBundleTrustPolicy(trustPolicy, resolvedDirectory, trustProfile),
      trustProfile ?? "permissive",
    );
  }

  async validatePresetBundleForSpace(
    inputPath: string,
    options: {
      spaceId: string;
      trustPolicy?: PresetBundleTrustPolicy;
      trustProfile?: PresetBundleTrustProfileName;
    },
  ): Promise<PresetBundleValidation> {
    const space = await requireSpace(this.repository, options.spaceId);
    const provenanceSettings = space.settings?.provenance;
    const trustProfile = options.trustProfile ?? provenanceSettings?.trustProfile ?? "permissive";

    const validation = this.validatePresetBundle(
      inputPath,
      mergePresetBundleTrustPolicyFromSettings(options.trustPolicy, provenanceSettings),
      trustProfile,
    );

    await ensureSpaceAuditScope(this.repository, space.id);
    const event = createPresetBundleAuditEvent(space.id, "bundle_reviewed", `Reviewed preset bundle ${basename(resolve(inputPath))}.`, {
      bundleName: basename(resolve(inputPath)),
      bundlePath: resolve(inputPath),
      trusted: validation.trusted,
      trustProfile: validation.report.trustProfile,
      signer: validation.metadata.signer,
      signerKeyId: validation.report.signerKeyId,
      origin: validation.metadata.origin,
      matchedTrustedSignerNames: validation.report.matchedTrustedSignerNames,
      warnings: validation.warnings,
    });
    await this.repository.appendEvent(event);
    await this.repository.writeRecord(createPresetBundleAuditSummaryRecord(space.id, event));

    return validation;
  }

  promotePresetChannel(
    name: string,
    options: { channel: string; version: string; directory?: string },
  ): PresetChannelState {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    requirePresetHistoryVersion(this.listRegisteredPresetHistory(name, resolvedDirectory), name, options.version);
    const current = readPresetChannels(resolvedDirectory, name);
    const next: PresetChannelState = {
      name,
      channels: {
        ...current.channels,
        [options.channel]: options.version,
      },
      defaultChannel: current.defaultChannel,
    };
    writePresetChannels(resolvedDirectory, next);
    return next;
  }

  resolvePresetChannel(
    name: string,
    options: { channel?: string; directory?: string },
  ): SpacePresetDefinition {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const state = readPresetChannels(resolvedDirectory, name);
    const channel = options.channel ?? state.defaultChannel;
    if (!channel) {
      throw new Error(`No preset channel selected for ${name}.`);
    }
    const version = state.channels[channel];
    if (!version) {
      throw new Error(`Unknown preset channel for ${name}: ${channel}`);
    }

    return requirePresetHistoryVersion(
      this.listRegisteredPresetHistory(name, resolvedDirectory),
      name,
      version,
    );
  }

  async getSpace(spaceId: string): Promise<MemorySpace> {
    return requireSpace(this.repository, spaceId);
  }

  async configureSpace(input: ConfigureSpaceInput): Promise<MemorySpace> {
    const space = await requireSpace(this.repository, input.spaceId);
    const channelPreset = input.presetLocalName && (input.presetChannel || this.listPresetChannels(
      input.presetLocalName,
      input.presetDirectory,
    ).defaultChannel)
      ? this.resolvePresetChannel(input.presetLocalName, {
          channel: input.presetChannel,
          directory: input.presetDirectory,
        })
      : undefined;
    const settings = mergeSpaceSettings(
      space.settings,
      input.preset ? getSpacePreset(input.preset) : undefined,
      channelPreset?.settings,
      input.presetDefinition?.settings,
      input.settings,
      mergeSpaceSettings(
        undefined,
        input.compaction ? { compaction: input.compaction } : undefined,
        input.retentionDays ? { retentionDays: input.retentionDays } : undefined,
        input.conflict ? { conflict: input.conflict } : undefined,
        input.decay ? { decay: input.decay } : undefined,
        input.routing ? { routing: input.routing } : undefined,
        input.reinforcement ? { reinforcement: input.reinforcement } : undefined,
      ),
    );

    const updatedSpace: MemorySpace = {
      ...space,
      settings,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.createSpace(updatedSpace);
    return updatedSpace;
  }

  async addScope(input: AddScopeInput): Promise<ScopeRecord> {
    await requireSpace(this.repository, input.spaceId);
    const timestamp = new Date().toISOString();
    const scope: ScopeRecord = {
      id: createId("scope"),
      spaceId: input.spaceId,
      type: input.type,
      externalId: input.externalId,
      label: input.label,
      parentScopeId: input.parentScopeId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.upsertScope(scope);
    return scope;
  }

  async listScopes(spaceId: string): Promise<ScopeRecord[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listScopes(spaceId);
  }

  async addRecord(input: CreateMemoryRecordInput): Promise<MemoryRecord> {
    const space = await requireSpace(this.repository, input.spaceId);
    const record = createMemoryRecord(input);
    await this.repository.writeRecord(record);

    const existingRecords = await this.repository.listRecords(input.spaceId, Number.MAX_SAFE_INTEGER);
    const conflicts = detectConflicts(record, existingRecords, space.settings?.conflict);

    for (const action of conflicts) {
      await this.repository.writeRecord(action.updatedConflictingRecord);
    }

    for (const link of createConflictLinks(conflicts)) {
      await this.repository.linkRecords(link);
    }

    for (const event of createConflictEvents(conflicts)) {
      await this.repository.appendEvent(event);
    }

    return record;
  }

  async getRecord(recordId: string): Promise<MemoryRecord> {
    return requireRecord(this.repository, recordId);
  }

  async listRecords(spaceId: string, limit = 50): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listRecords(spaceId, limit);
  }

  async searchRecords(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: { reinforce?: SearchReinforcementOptions; semantic?: SearchSemanticOptions } = {},
  ): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, query.spaceId);
    const baseResults = await this.repository.searchRecords(query);
    const semanticRerank = rerankRecordsWithSemanticPrototype(baseResults, query.text, options.semantic);
    const results = semanticRerank.records;

    if (options.reinforce?.enabled) {
      const limit = options.reinforce.limit ?? results.length;
      const recordIds = results.slice(0, Math.max(limit, 0)).map((record) => record.id);

      if (recordIds.length > 0) {
        await this.reinforceRecords(recordIds, {
          reason: options.reinforce.reason ?? "successful-retrieval",
          strength: options.reinforce.strength,
          now: options.reinforce.now,
        });
      }
    }

    return results;
  }

  async recallRecords(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<RecallPack[]> {
    await requireSpace(this.repository, query.spaceId);
    const results = await this.searchRecords(query, {
      reinforce: options.reinforce,
      semantic: options.semantic,
    });
    const primaryRecords = results.slice(0, Math.max(options.primaryLimit ?? results.length, 0));

    if (primaryRecords.length === 0) {
      return [];
    }

    const allRecords = await this.repository.listRecords(query.spaceId, Number.MAX_SAFE_INTEGER);
    const packs: RecallPack[] = [];

    for (const primary of primaryRecords) {
      const links = await this.repository.listLinksForRecord(primary.id);
      packs.push(
        buildRecallPack(primary, allRecords, links, {
          queryText: query.text,
          supportLimit: options.supportLimit,
          includeSameScopeDistilled: options.includeSameScopeDistilled,
        }),
      );
    }

    return packs;
  }

  async traceRecall(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<RecallTrace[]> {
    const packs = await this.recallRecords(query, options);
    return packs.map((pack) => buildRecallTrace(pack, query.text));
  }

  async bundleRecall(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<MemoryBundle[]> {
    const space = await requireSpace(this.repository, query.spaceId);
    const packs = await this.recallRecords(query, options);
    return packs.map((pack) => buildMemoryBundle(pack, {
      queryText: query.text,
      profile: options.bundleProfile,
      consumer: options.bundleConsumer,
      routingPolicy: space.settings?.routing,
      maxSupporting: options.bundleMaxSupporting,
      maxContentChars: options.bundleMaxContentChars,
      preferCompact: options.bundlePreferCompact,
      provenanceMode: options.bundleProvenanceMode,
    }));
  }

  async prepareReplyContext(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: PrepareReplyContextOptions = {},
  ): Promise<PreparedReplyContext> {
    const space = await requireSpace(this.repository, query.spaceId);
    const primaryLimit = options.maxEntries ?? options.primaryLimit ?? 1;
    const packs = await this.recallRecords(query, {
      ...options,
      primaryLimit,
    });

    const entries = packs.map((pack, index) => {
      const trace = buildRecallTrace(pack, query.text);
      const bundle = buildMemoryBundle(pack, {
        queryText: query.text,
        profile: options.bundleProfile,
        consumer: options.bundleConsumer,
        routingPolicy: space.settings?.routing,
        maxSupporting: options.bundleMaxSupporting,
        maxContentChars: options.bundleMaxContentChars,
        preferCompact: options.bundlePreferCompact,
        provenanceMode: options.bundleProvenanceMode,
      });

      const entry: PreparedReplyContextEntry = {
        pack,
        trace,
        bundle,
        text: "",
      };

      entry.text = options.formatter
        ? options.formatter(entry, index)
        : formatReplyContextBlock(bundle, options);

      return entry;
    });

    return {
      queryText: query.text,
      entries,
      text: entries.length > 0
        ? options.formatter
          ? entries.map((entry) => entry.text).join("\n\n")
          : formatReplyContextText(
              entries.map((entry) => entry.bundle),
              options,
            )
        : "",
    };
  }

  async promoteRecord(recordId: string): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const promoted = promoteRecord(record);
    await this.repository.writeRecord(promoted);
    return promoted;
  }

  async archiveRecord(recordId: string): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const archived = updateRecordStatus(record, "archived");
    await this.repository.writeRecord(archived);
    return archived;
  }

  async updateRecordStatus(recordId: string, status: RecordStatus): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const updated = updateRecordStatus(record, status);
    await this.repository.writeRecord(updated);
    return updated;
  }

  async addEvent(input: AddEventInput): Promise<MemoryEvent> {
    await requireSpace(this.repository, input.spaceId);
    const event: MemoryEvent = {
      id: createId("evt"),
      spaceId: input.spaceId,
      scope: input.scope,
      actorType: input.actorType,
      actorId: input.actorId,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };

    await this.repository.appendEvent(event);
    return event;
  }

  async listEvents(spaceId: string, limit = 50): Promise<MemoryEvent[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listEvents(spaceId, limit);
  }

  async addLink(input: AddLinkInput): Promise<MemoryRecordLink> {
    await requireSpace(this.repository, input.spaceId);
    const link: MemoryRecordLink = {
      id: createId("link"),
      spaceId: input.spaceId,
      fromRecordId: input.fromRecordId,
      toRecordId: input.toRecordId,
      type: input.type,
      createdAt: new Date().toISOString(),
    };

    await this.repository.linkRecords(link);
    return link;
  }

  async listLinks(spaceId: string, limit = 50): Promise<MemoryRecordLink[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listLinks(spaceId, limit);
  }

  async listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]> {
    await requireRecord(this.repository, recordId);
    return this.repository.listLinksForRecord(recordId);
  }

  async compactSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<ReturnType<typeof planCompaction>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planCompaction(records, space.settings?.compaction);

    if (options.apply) {
      for (const record of applyCompactionPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const record of createCompactionDistilledRecords(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createCompactionEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      for (const link of createCompactionDistillationLinks(plan)) {
        await this.repository.linkRecords(link);
      }

      const summaryRecord = createCompactionSummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createCompactionSummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async retainSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<ReturnType<typeof planRetention>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planRetention(records, space.settings?.retentionDays);

    if (options.apply) {
      for (const record of applyRetentionPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      const summaryRecord = createRetentionSummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async decaySpace(spaceId: string, options: { apply?: boolean; now?: Date } = {}): Promise<ReturnType<typeof planDecay>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planDecay(records, space.settings?.decay, options.now);

    if (options.apply) {
      for (const record of applyDecayPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createDecayEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      const summaryRecord = createDecaySummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createDecaySummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async reinforceRecord(recordId: string, options: ReinforceRecordOptions = {}): Promise<ReturnType<typeof planReinforcement>> {
    return this.reinforceRecords([recordId], options);
  }

  async reinforceRecords(
    recordIds: string[],
    options: ReinforceRecordOptions = {},
  ): Promise<ReturnType<typeof planReinforcement>> {
    const uniqueRecordIds = [...new Set(recordIds)];

    if (uniqueRecordIds.length === 0) {
      return { reinforced: [] };
    }

    const firstRecord = await requireRecord(this.repository, uniqueRecordIds[0]!);
    for (const recordId of uniqueRecordIds.slice(1)) {
      const record = await requireRecord(this.repository, recordId);
      if (record.spaceId !== firstRecord.spaceId) {
        throw new Error("Reinforcement targets must belong to the same space.");
      }
    }

    const space = await requireSpace(this.repository, firstRecord.spaceId);
    const records = await this.repository.listRecords(firstRecord.spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planReinforcement(records, space.settings?.reinforcement, {
      recordIds: uniqueRecordIds,
      reason: options.reason,
      strength: options.strength,
      now: options.now,
    });

    await persistReinforcementPlan(this.repository, plan);
    return plan;
  }

  async planLearningLoop(
    spaceId: string,
    options: LearningLoopOptions = {},
  ): Promise<LearningLoopPlan> {
    await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const events = await this.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER);
    const links = await this.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER);

    return planLearningLoop(records, events, links, options);
  }

  async maintainSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<MaintenanceResult> {
    const space = await requireSpace(this.repository, spaceId);
    const initialRecords = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const compactionPlan = planCompaction(initialRecords, space.settings?.compaction);
    const compactionUpdates = applyCompactionPlan(compactionPlan);
    const postCompactionRecords = mergeUpdatedRecords(initialRecords, compactionUpdates);

    if (options.apply) {
      for (const record of compactionUpdates) {
        await this.repository.writeRecord(record);
      }

      for (const record of createCompactionDistilledRecords(compactionPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createCompactionEvents(compactionPlan)) {
        await this.repository.appendEvent(event);
      }

      for (const link of createCompactionDistillationLinks(compactionPlan)) {
        await this.repository.linkRecords(link);
      }

      const compactionSummary = createCompactionSummaryRecord(compactionPlan);
      if (compactionSummary) {
        await this.repository.writeRecord(compactionSummary);
        for (const link of createCompactionSummaryLinks(compactionSummary, compactionPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    const decayInputRecords = options.apply
      ? await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : postCompactionRecords;
    const decayPlan = planDecay(decayInputRecords, space.settings?.decay);

    if (options.apply) {
      for (const record of applyDecayPlan(decayPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createDecayEvents(decayPlan)) {
        await this.repository.appendEvent(event);
      }

      const decaySummary = createDecaySummaryRecord(decayPlan);
      if (decaySummary) {
        await this.repository.writeRecord(decaySummary);
        for (const link of createDecaySummaryLinks(decaySummary, decayPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    const retentionInputRecords = options.apply
      ? await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : mergeUpdatedRecords(decayInputRecords, applyDecayPlan(decayPlan));

    const retentionPlan = planRetention(
      retentionInputRecords,
      space.settings?.retentionDays,
    );

    if (options.apply) {
      for (const record of applyRetentionPlan(retentionPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(retentionPlan)) {
        await this.repository.appendEvent(event);
      }

      const retentionSummary = createRetentionSummaryRecord(retentionPlan);
      if (retentionSummary) {
        await this.repository.writeRecord(retentionSummary);
        for (const link of createRetentionSummaryLinks(retentionSummary, retentionPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return { compactionPlan, decayPlan, retentionPlan, applied: options.apply === true };
  }

  async getSpaceReport(spaceId: string, recentEventLimit = 10): Promise<SpaceReport> {
    await requireSpace(this.repository, spaceId);
    return this.repository.getSpaceReport(spaceId, recentEventLimit);
  }

  async buildSpaceInspectorSnapshot(
    spaceId: string,
    options: SpaceInspectorSnapshotOptions = {},
  ): Promise<SpaceInspectorSnapshot> {
    const includeScopes = options.includeScopes ?? true;
    const includeEvents = options.includeEvents ?? true;
    const recentEventLimit = options.recentEventLimit ?? 20;
    const includeTrustRegistry = options.includeTrustRegistry ?? true;
    const space = await requireSpace(this.repository, spaceId);
    const [report, graph] = await Promise.all([
      this.repository.getSpaceReport(spaceId, recentEventLimit),
      this.exportSpaceGraph(spaceId, { includeScopes, includeEvents }),
    ]);
    const risk = buildSpaceInspectorRiskSummary(report);
    const recall = options.recall
      ? await buildInspectorRecall(this, spaceId, options.recall)
      : undefined;
    const trustRegistry = includeTrustRegistry
      ? {
          trustedSigners: this.listTrustedSigners(options.presetDirectory),
          trustPolicyPacks: this.listTrustPolicyPacks(options.presetDirectory).map((pack) => ({
            name: pack.name,
            description: pack.description,
            inheritsFrom: pack.inheritsFrom,
            baseProfile: pack.baseProfile,
            updatedAt: pack.updatedAt,
            policy: pack.policy,
          })),
        }
      : undefined;

    return {
      metadata: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
      },
      space,
      report,
      risk,
      policy: buildSpaceInspectorPolicyView(space.settings),
      graph,
      recall,
      trustRegistry,
    };
  }

  async exportSpaceInspectorHtml(
    spaceId: string,
    outputPath: string,
    options: SpaceInspectorSnapshotOptions = {},
  ): Promise<SpaceInspectorExportResult> {
    const snapshot = await this.buildSpaceInspectorSnapshot(spaceId, options);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, renderSpaceInspectorHtml(snapshot), "utf8");
    return {
      outputPath: resolvedOutputPath,
      snapshot,
    };
  }

  async exportSpaceInspectorSnapshotToFile(
    spaceId: string,
    outputPath: string,
    options: SpaceInspectorSnapshotOptions = {},
  ): Promise<SpaceInspectorSnapshotExportResult> {
    const snapshot = await this.buildSpaceInspectorSnapshot(spaceId, options);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(snapshot, null, 2), "utf8");
    return {
      outputPath: resolvedOutputPath,
      snapshot,
    };
  }

  async buildSpaceInspectorIndexSnapshot(
    options: SpaceInspectorIndexSnapshotOptions = {},
  ): Promise<SpaceInspectorIndexSnapshot> {
    const recentEventLimit = options.recentEventLimit ?? 10;
    const includeTrustRegistry = options.includeTrustRegistry ?? true;
    const includeGraphCounts = options.includeGraphCounts ?? true;
    const spaces = await this.listSpaces();
    const entries: SpaceInspectorIndexSnapshot["spaces"] = [];
    let totalRecords = 0;
    let totalEvents = 0;
    let totalLinks = 0;
    let totalGraphNodes = 0;
    let totalGraphEdges = 0;
    let spacesNeedingTrustReview = 0;
    let spacesWithContestedMemory = 0;
    let spacesWithStaleMemory = 0;

    for (const space of spaces) {
      const report = await this.getSpaceReport(space.id, recentEventLimit);
      totalRecords += report.recordCount;
      totalEvents += report.eventCount;
      totalLinks += report.linkCount;
      const risk = buildSpaceInspectorRiskSummary(report);
      if (risk.needsTrustReview) {
        spacesNeedingTrustReview += 1;
      }
      if (risk.contestedMemoryEvents > 0) {
        spacesWithContestedMemory += 1;
      }
      if (risk.decayedMemoryEvents > 0) {
        spacesWithStaleMemory += 1;
      }

      let graphCounts: { nodes: number; edges: number } | undefined;
      if (includeGraphCounts) {
        const graph = await this.exportSpaceGraph(space.id, { includeScopes: true, includeEvents: true });
        graphCounts = {
          nodes: graph.metadata.nodeCount,
          edges: graph.metadata.edgeCount,
        };
        totalGraphNodes += graphCounts.nodes;
        totalGraphEdges += graphCounts.edges;
      }

      entries.push({
        space: {
          id: space.id,
          name: space.name,
          description: space.description,
          updatedAt: space.updatedAt,
        },
        report: {
          recordCount: report.recordCount,
          eventCount: report.eventCount,
          linkCount: report.linkCount,
          provenanceSummaryCount: report.provenanceSummaryCount,
          latestMaintenanceAt: report.maintenance.latestRunAt,
        },
        policy: {
          maxShortTermRecords: buildSpaceInspectorPolicyView(space.settings).effective.maxShortTermRecords,
          provenanceTrustProfile: space.settings?.provenance?.trustProfile,
        },
        risk,
        graph: graphCounts,
      });
    }

    const trustRegistry = includeTrustRegistry
      ? {
          trustedSigners: this.listTrustedSigners(options.presetDirectory),
          trustPolicyPacks: this.listTrustPolicyPacks(options.presetDirectory).map((pack) => ({
            name: pack.name,
            description: pack.description,
            inheritsFrom: pack.inheritsFrom,
            baseProfile: pack.baseProfile,
            updatedAt: pack.updatedAt,
            policy: pack.policy,
          })),
        }
      : undefined;

    return {
      metadata: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        spaceCount: entries.length,
      },
      totals: {
        records: totalRecords,
        events: totalEvents,
        links: totalLinks,
        graphNodes: totalGraphNodes,
        graphEdges: totalGraphEdges,
        spacesNeedingTrustReview,
        spacesWithContestedMemory,
        spacesWithStaleMemory,
      },
      spaces: entries.sort((left, right) => left.space.name.localeCompare(right.space.name)),
      trustRegistry,
    };
  }

  async exportSpaceInspectorIndexHtml(
    outputPath: string,
    options: SpaceInspectorIndexSnapshotOptions = {},
  ): Promise<SpaceInspectorIndexExportResult> {
    const snapshot = await this.buildSpaceInspectorIndexSnapshot(options);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, renderSpaceInspectorIndexHtml(snapshot), "utf8");
    return {
      outputPath: resolvedOutputPath,
      snapshot,
    };
  }

  async exportSpaceInspectorIndexSnapshotToFile(
    outputPath: string,
    options: SpaceInspectorIndexSnapshotOptions = {},
  ): Promise<SpaceInspectorIndexSnapshotExportResult> {
    const snapshot = await this.buildSpaceInspectorIndexSnapshot(options);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(snapshot, null, 2), "utf8");
    return {
      outputPath: resolvedOutputPath,
      snapshot,
    };
  }

  async exportSpaceInspectorPack(
    outputDirectory: string,
    options: SpaceInspectorPackExportOptions = {},
  ): Promise<SpaceInspectorPackExportResult> {
    const resolvedOutputDirectory = resolve(outputDirectory);
    const spacesDirectory = join(resolvedOutputDirectory, "spaces");
    mkdirSync(spacesDirectory, { recursive: true });

    const includeTrustRegistry = options.includeTrustRegistry ?? true;
    const includeGraphCounts = options.includeGraphCounts ?? true;
    const indexSnapshot = await this.buildSpaceInspectorIndexSnapshot({
      recentEventLimit: options.recentEventLimit,
      includeTrustRegistry,
      includeGraphCounts,
      presetDirectory: options.presetDirectory,
    });

    const indexHtmlPath = join(resolvedOutputDirectory, "index.html");
    const indexSnapshotPath = join(resolvedOutputDirectory, "index.snapshot.json");
    const indexScreenshotPath = join(resolvedOutputDirectory, "index.png");
    writeFileSync(indexHtmlPath, renderSpaceInspectorIndexHtml(indexSnapshot), "utf8");
    writeFileSync(indexSnapshotPath, JSON.stringify(indexSnapshot, null, 2), "utf8");
    const capturedIndexScreenshot = options.captureScreenshots
      ? await captureHtmlScreenshot(indexHtmlPath, indexScreenshotPath, options.screenshotViewport)
      : undefined;

    const spaces: SpaceInspectorPackManifest["spaces"] = [];
    for (const entry of indexSnapshot.spaces) {
      const spaceSnapshot = await this.buildSpaceInspectorSnapshot(entry.space.id, {
        recentEventLimit: options.recentEventLimit,
        includeScopes: options.includeScopes,
        includeEvents: options.includeEvents,
        includeTrustRegistry,
        presetDirectory: options.presetDirectory,
        recall: options.recall,
      });
      const spaceSlug = toSafePathSegment(entry.space.name);
      const spaceStem = `${spaceSlug}-${entry.space.id}`;
      const htmlPath = join(spacesDirectory, `${spaceStem}.html`);
      const snapshotPath = join(spacesDirectory, `${spaceStem}.snapshot.json`);
      const screenshotPath = join(spacesDirectory, `${spaceStem}.png`);
      writeFileSync(htmlPath, renderSpaceInspectorHtml(spaceSnapshot), "utf8");
      writeFileSync(snapshotPath, JSON.stringify(spaceSnapshot, null, 2), "utf8");
      const capturedSpaceScreenshot = options.captureScreenshots
        ? await captureHtmlScreenshot(htmlPath, screenshotPath, options.screenshotViewport)
        : undefined;
      spaces.push({
        spaceId: entry.space.id,
        spaceName: entry.space.name,
        html: htmlPath,
        snapshot: snapshotPath,
        screenshot: capturedSpaceScreenshot,
        riskLevel: spaceSnapshot.risk.riskLevel,
      });
    }

    const manifest: SpaceInspectorPackManifest = {
      metadata: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        outputDirectory: resolvedOutputDirectory,
        spaceCount: spaces.length,
      },
      files: {
        indexHtml: indexHtmlPath,
        indexSnapshot: indexSnapshotPath,
        indexScreenshot: capturedIndexScreenshot,
      },
      spaces,
      totals: indexSnapshot.totals,
    };
    const manifestPath = join(resolvedOutputDirectory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      outputDirectory: resolvedOutputDirectory,
      manifestPath,
      manifest,
    };
  }

  async exportSpaceGraph(
    spaceId: string,
    options: SpaceGraphExportOptions = {},
  ): Promise<SpaceGraphExport> {
    const includeScopes = options.includeScopes ?? true;
    const includeEvents = options.includeEvents ?? true;
    const space = await requireSpace(this.repository, spaceId);
    const [scopes, events, records, links] = await Promise.all([
      this.repository.listScopes(spaceId),
      this.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER),
    ]);

    return buildSpaceGraphExport(space, scopes, events, records, links, {
      includeScopes,
      includeEvents,
    });
  }

  async exportSpaceGraphCytoscape(
    spaceId: string,
    options: SpaceGraphExportOptions = {},
  ): Promise<SpaceGraphCytoscapeExport> {
    const graph = await this.exportSpaceGraph(spaceId, options);
    return convertSpaceGraphToCytoscape(graph);
  }

  async exportSpaceGraphDot(
    spaceId: string,
    options: SpaceGraphExportOptions = {},
  ): Promise<string> {
    const graph = await this.exportSpaceGraph(spaceId, options);
    return convertSpaceGraphToDot(graph);
  }

  async exportSpaceGraphToFile(
    spaceId: string,
    outputPath: string,
    options: SpaceGraphExportToFileOptions = {},
  ): Promise<string> {
    const includeScopes = options.includeScopes ?? true;
    const includeEvents = options.includeEvents ?? true;
    const format = options.format ?? "native";
    const graph = await this.exportSpaceGraph(spaceId, { includeScopes, includeEvents });
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    if (format === "dot") {
      writeFileSync(resolvedOutputPath, convertSpaceGraphToDot(graph), "utf8");
    } else if (format === "cytoscape") {
      writeFileSync(resolvedOutputPath, JSON.stringify(convertSpaceGraphToCytoscape(graph), null, 2), "utf8");
    } else {
      writeFileSync(resolvedOutputPath, JSON.stringify(graph, null, 2), "utf8");
    }
    return resolvedOutputPath;
  }

  async exportSpace(spaceId: string, options: ExportSpaceSnapshotOptions = {}): Promise<SpaceSnapshot> {
    const space = await requireSpace(this.repository, spaceId);
    const [scopes, events, records, links] = await Promise.all([
      this.repository.listScopes(spaceId),
      this.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER),
    ]);

    const signerPublicKeyPem = options.signingPrivateKeyPem
      ? createPublicKey(createPrivateKey(options.signingPrivateKeyPem)).export({ type: "spki", format: "pem" }).toString()
      : undefined;
    const snapshot: SpaceSnapshot = {
      metadata: {
        snapshotFormatVersion: SPACE_SNAPSHOT_FORMAT_VERSION,
        glialnodeVersion: GLIALNODE_VERSION,
        nodeEngine: GLIALNODE_NODE_ENGINE,
        origin: options.origin,
        signer: options.signer,
        checksumAlgorithm: "sha256",
        checksum: "",
        signatureAlgorithm: signerPublicKeyPem ? "ed25519" : undefined,
        signerKeyId: signerPublicKeyPem ? computeSignerKeyId(signerPublicKeyPem) : undefined,
        signerPublicKey: signerPublicKeyPem,
        signature: undefined,
      },
      exportedAt: new Date().toISOString(),
      space,
      scopes,
      events,
      records,
      links,
    };

    snapshot.metadata.checksum = computeSpaceSnapshotChecksum(snapshot);
    if (options.signingPrivateKeyPem) {
      snapshot.metadata.signature = computeSpaceSnapshotSignature(snapshot, options.signingPrivateKeyPem);
    }

    return snapshot;
  }

  async exportSpaceToFile(
    spaceId: string,
    outputPath: string,
    options: ExportSpaceSnapshotOptions = {},
  ): Promise<string> {
    const snapshot = await this.exportSpace(spaceId, options);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(snapshot, null, 2), "utf8");
    return resolvedOutputPath;
  }

  async validateSnapshot(
    snapshot: SpaceSnapshot,
    trustPolicy: SpaceSnapshotTrustPolicy = {},
    trustProfile: SpaceSnapshotTrustProfile = "permissive",
    directory?: string,
  ): Promise<SpaceSnapshotValidationResult> {
    const effectiveTrustPolicy = resolveSpaceSnapshotTrustPolicy(trustPolicy, directory, trustProfile);
    return validateSpaceSnapshot(snapshot, effectiveTrustPolicy, trustProfile);
  }

  async importSnapshot(
    snapshot: SpaceSnapshot,
    options: ImportSpaceSnapshotOptions = {},
  ): Promise<SpaceSnapshot> {
    const normalizedSnapshot = normalizeSpaceSnapshot(snapshot);
    await this.validateSnapshot(
      normalizedSnapshot,
      options.trustPolicy,
      options.trustProfile,
      options.directory,
    );

    const preparedSnapshot = await prepareSnapshotForImport(
      this.repository,
      normalizedSnapshot,
      options.collisionPolicy ?? "error",
    );

    await this.repository.createSpace(preparedSnapshot.space);

    for (const scope of preparedSnapshot.scopes) {
      await this.repository.upsertScope(scope);
    }

    for (const event of preparedSnapshot.events) {
      await this.repository.appendEvent(event);
    }

    for (const record of preparedSnapshot.records) {
      await this.repository.writeRecord(record);
    }

    for (const link of preparedSnapshot.links) {
      await this.repository.linkRecords(link);
    }

    return preparedSnapshot;
  }

  async importSnapshotFromFile(
    inputPath: string,
    options: ImportSpaceSnapshotOptions = {},
  ): Promise<SpaceSnapshot> {
    const snapshot = parseSpaceSnapshot(readFileSync(resolve(inputPath), "utf8"));
    return this.importSnapshot(snapshot, options);
  }

  async previewSnapshotImport(
    snapshot: SpaceSnapshot,
    options: ImportSpaceSnapshotOptions = {},
  ): Promise<SnapshotImportPreview> {
    const normalizedSnapshot = normalizeSpaceSnapshot(snapshot);
    const collisionPolicy = options.collisionPolicy ?? "error";
    const trustProfile = options.trustProfile ?? "permissive";
    const blockingIssues: string[] = [];
    let validation: SpaceSnapshotValidationResult | null = null;

    try {
      validation = await this.validateSnapshot(
        normalizedSnapshot,
        options.trustPolicy,
        trustProfile,
        options.directory,
      );
    } catch (error) {
      blockingIssues.push(error instanceof Error ? error.message : String(error));
    }

    const existingSpace = await this.repository.getSpace(normalizedSnapshot.space.id);
    let preparedSnapshot = normalizedSnapshot;
    try {
      preparedSnapshot = await prepareSnapshotForImport(
        this.repository,
        normalizedSnapshot,
        collisionPolicy,
      );
    } catch (error) {
      blockingIssues.push(error instanceof Error ? error.message : String(error));
    }

    const requestedSpace = {
      id: normalizedSnapshot.space.id,
      name: normalizedSnapshot.space.name,
    };
    const targetSpace = {
      id: preparedSnapshot.space.id,
      name: preparedSnapshot.space.name,
    };

    return {
      collisionPolicy,
      trustProfile,
      requestedSpace,
      targetSpace,
      existingSpace: existingSpace
        ? {
            id: existingSpace.id,
            name: existingSpace.name,
          }
        : null,
      identityRemapped: requestedSpace.id !== targetSpace.id || requestedSpace.name !== targetSpace.name,
      applyAllowed: blockingIssues.length === 0,
      blockingIssues,
      importedCounts: {
        scopes: normalizedSnapshot.scopes.length,
        events: normalizedSnapshot.events.length,
        records: normalizedSnapshot.records.length,
        links: normalizedSnapshot.links.length,
      },
      snapshotMetadata: {
        snapshotFormatVersion: normalizedSnapshot.metadata.snapshotFormatVersion,
        signed: Boolean(normalizedSnapshot.metadata.signature),
      },
      validation,
    };
  }

  async previewSnapshotImportFromFile(
    inputPath: string,
    options: ImportSpaceSnapshotOptions = {},
  ): Promise<SnapshotImportPreview> {
    const snapshot = parseSpaceSnapshot(readFileSync(resolve(inputPath), "utf8"));
    return this.previewSnapshotImport(snapshot, options);
  }

  close(): void {
    this.closeMetricsRepository?.();
    this.closeRepository?.();
  }

  private getMetricsRepository(): MetricsRepository {
    if (this.metricsRepository) {
      return this.metricsRepository;
    }

    const filename = resolve(this.metricsOptions.filename ?? resolveDefaultMetricsDatabasePath(this.memoryDatabasePath));
    const repository = new SqliteMetricsRepository({
      filename,
      connection: this.metricsOptions.sqlite,
    });
    this.metricsRepository = repository;
    this.closeMetricsRepository = () => repository.close();
    return repository;
  }

  private async getDashboardTokenUsageReport(options: TokenUsageReportOptions = {}): Promise<TokenUsageReport | undefined> {
    if (this.metricsOptions.disabled) {
      return undefined;
    }
    return this.getTokenUsageReport(options);
  }

  private async summarizeDashboardMemory(
    spaceIds: string[],
    options: DashboardSnapshotBuildOptions,
  ): Promise<{ activeRecords: number; staleRecords: number; maintenanceDue: boolean }> {
    const staleFreshnessThreshold = options.staleFreshnessThreshold ?? 0.35;
    let activeRecords = 0;
    let staleRecords = 0;
    let maintenanceDue = false;

    for (const spaceId of spaceIds) {
      const [records, report] = await Promise.all([
        this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER),
        this.repository.getSpaceReport(spaceId, 1),
      ]);

      activeRecords += records.filter((record) => record.status === "active").length;
      staleRecords += records.filter((record) => record.status === "active" && record.freshness <= staleFreshnessThreshold).length;
      maintenanceDue = maintenanceDue || !report.maintenance.latestRunAt;
    }

    return { activeRecords, staleRecords, maintenanceDue };
  }

  private async summarizeDashboardMemoryForAgent(
    agentId: string,
    spaceIds: string[],
    options: DashboardSnapshotBuildOptions,
  ): Promise<{ activeSpaces: number; activeRecords: number; staleRecords: number; maintenanceDue: boolean }> {
    const staleFreshnessThreshold = options.staleFreshnessThreshold ?? 0.35;
    let activeRecords = 0;
    let staleRecords = 0;
    let activeSpaces = 0;
    let maintenanceDue = false;

    for (const spaceId of spaceIds) {
      const [records, report] = await Promise.all([
        this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER),
        this.repository.getSpaceReport(spaceId, 1),
      ]);
      const agentRecords = records.filter((record) => record.scope.id === agentId);

      if (agentRecords.length > 0) {
        activeSpaces += 1;
      }
      activeRecords += agentRecords.filter((record) => record.status === "active").length;
      staleRecords += agentRecords.filter((record) => record.status === "active" && record.freshness <= staleFreshnessThreshold).length;
      maintenanceDue = maintenanceDue || !report.maintenance.latestRunAt;
    }

    return { activeSpaces, activeRecords, staleRecords, maintenanceDue };
  }

  private getMemoryDatabaseBytes(): number | undefined {
    if (!this.memoryDatabasePath || !existsSync(this.memoryDatabasePath)) {
      return undefined;
    }

    return statSync(this.memoryDatabasePath).size;
  }
}

function toPresetFileName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || basename(`${Date.now()}`);
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

  return normalized || basename(`${Date.now()}`);
}

function writePresetFiles(directory: string, preset: SpacePresetDefinition): void {
  const outputPath = join(directory, `${toPresetFileName(preset.name)}.json`);
  ensureDirectoryWithMode(directory, 0o755);
  writeJsonFileAtomic(outputPath, stringifySpacePresetDefinition(preset), 0o644);

  writePresetHistoryFile(directory, preset);
}

function writePresetHistoryFile(directory: string, preset: SpacePresetDefinition): void {
  const historyDirectory = join(directory, ".versions", toPresetFileName(preset.name));
  ensureDirectoryWithMode(historyDirectory, 0o755);
  const historyPath = join(
    historyDirectory,
    `${toPresetHistoryTimestamp(preset.updatedAt)}--${toPresetVersionFileName(preset.version ?? "1.0.0")}.json`,
  );
  writeJsonFileAtomic(historyPath, stringifySpacePresetDefinition(preset), 0o644);
}

function listRegisteredPresetHistoryFromDirectory(
  name: string,
  directory: string,
  loadPreset: (inputPath: string) => SpacePresetDefinition,
): SpacePresetDefinition[] {
  const historyDirectory = join(directory, ".versions", toPresetFileName(name));
  if (!existsSync(historyDirectory)) {
    return [];
  }

  return readdirSync(historyDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => loadPreset(join(historyDirectory, entry)))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function requirePresetHistoryVersion(
  history: SpacePresetDefinition[],
  name: string,
  version: string,
): SpacePresetDefinition {
  const match = history.find((preset) => preset.version === version);
  if (!match) {
    throw new Error(`Unknown preset version for ${name}: ${version}`);
  }

  return match;
}

function readPresetChannels(directory: string, name: string): PresetChannelState {
  const channelsPath = join(directory, ".channels", `${toPresetFileName(name)}.json`);
  if (!existsSync(channelsPath)) {
    return {
      name,
      channels: {},
    };
  }

  const parsed = parsePresetChannelState(readFileSync(channelsPath, "utf8"));
  return {
    ...parsed,
    name,
  };
}

function writePresetChannels(directory: string, state: PresetChannelState): void {
  const channelsDirectory = join(directory, ".channels");
  ensureDirectoryWithMode(channelsDirectory, 0o755);
  const channelsPath = join(channelsDirectory, `${toPresetFileName(state.name)}.json`);
  writeJsonFileAtomic(channelsPath, JSON.stringify(state, null, 2), 0o644);
}

function resolvePresetImportName(
  directory: string,
  requestedName: string,
  collisionPolicy: ImportCollisionPolicy,
): string {
  const candidatePath = join(directory, `${toPresetFileName(requestedName)}.json`);
  if (!existsSync(candidatePath)) {
    return requestedName;
  }

  if (collisionPolicy === "overwrite") {
    return requestedName;
  }

  if (collisionPolicy === "rename") {
    return findAvailablePresetImportName(directory, requestedName);
  }

  throw new Error(`Preset already exists: ${requestedName}. Use collisionPolicy=overwrite or collisionPolicy=rename.`);
}

function findAvailablePresetImportName(directory: string, baseName: string): string {
  const normalizedBase = `${baseName} imported`;
  let suffix = 1;

  while (true) {
    const candidate = suffix === 1 ? normalizedBase : `${normalizedBase} ${suffix}`;
    const candidatePath = join(directory, `${toPresetFileName(candidate)}.json`);
    if (!existsSync(candidatePath)) {
      return candidate;
    }
    suffix += 1;
  }
}

function getSigningKeysDirectory(directory: string): string {
  return join(directory, ".keys");
}

function getSigningKeyPath(directory: string, name: string): string {
  return join(getSigningKeysDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeSigningKeyRecord(directory: string, record: SigningKeyRecord): void {
  const keysDirectory = getSigningKeysDirectory(directory);
  ensureDirectoryWithMode(keysDirectory, 0o700);
  writeJsonFileAtomic(getSigningKeyPath(directory, record.name), JSON.stringify(record, null, 2), 0o600);
}

function readSigningKeyRecord(directory: string, name: string): SigningKeyRecord {
  const recordPath = getSigningKeyPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown signing key: ${name}`);
  }

  return parseSigningKeyRecord(readFileSync(recordPath, "utf8"));
}

function listSigningKeyRecords(directory: string): SigningKeyRecord[] {
  const keysDirectory = getSigningKeysDirectory(directory);
  if (!existsSync(keysDirectory)) {
    return [];
  }

  return readdirSync(keysDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseSigningKeyRecord(readFileSync(join(keysDirectory, entry), "utf8")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseSigningKeyRecord(value: string): SigningKeyRecord {
  const parsed = JSON.parse(value) as Partial<SigningKeyRecord>;
  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid signing key record: missing name.");
  }
  if (parsed.algorithm !== "ed25519") {
    throw new Error(`Invalid signing key algorithm: ${String(parsed.algorithm ?? "undefined")}`);
  }
  if (typeof parsed.publicKeyPem !== "string" || typeof parsed.privateKeyPem !== "string") {
    throw new Error("Invalid signing key record: missing PEM material.");
  }

  const keyId = typeof parsed.keyId === "string" && parsed.keyId
    ? parsed.keyId
    : computeSignerKeyId(parsed.publicKeyPem);
  const timestamp = new Date().toISOString();

  return {
    name: parsed.name,
    algorithm: "ed25519",
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    keyId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
  };
}

function toSigningKeySummary(record: SigningKeyRecord): SigningKeySummary {
  return {
    name: record.name,
    algorithm: record.algorithm,
    signer: record.signer,
    keyId: record.keyId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function getTrustedSignersDirectory(directory: string): string {
  return join(directory, ".trusted");
}

function getTrustPolicyPacksDirectory(directory: string): string {
  return join(directory, ".trust-packs");
}

function getTrustPolicyPackPath(directory: string, name: string): string {
  return join(getTrustPolicyPacksDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeTrustPolicyPackRecord(directory: string, record: TrustPolicyPackRecord): void {
  const packsDirectory = getTrustPolicyPacksDirectory(directory);
  ensureDirectoryWithMode(packsDirectory, 0o755);
  writeJsonFileAtomic(getTrustPolicyPackPath(directory, record.name), JSON.stringify(record, null, 2), 0o644);
}

function readTrustPolicyPackRecord(directory: string, name: string): TrustPolicyPackRecord {
  const recordPath = getTrustPolicyPackPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown trust policy pack: ${name}`);
  }

  return parseTrustPolicyPackRecord(readFileSync(recordPath, "utf8"));
}

function listTrustPolicyPackRecords(directory: string): TrustPolicyPackRecord[] {
  const packsDirectory = getTrustPolicyPacksDirectory(directory);
  if (!existsSync(packsDirectory)) {
    return [];
  }

  return readdirSync(packsDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseTrustPolicyPackRecord(readFileSync(join(packsDirectory, entry), "utf8")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTrustPolicyPackRecord(value: string): TrustPolicyPackRecord {
  const parsed = JSON.parse(value) as Partial<TrustPolicyPackRecord>;
  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid trust policy pack: missing name.");
  }

  const baseProfile = parsed.baseProfile;
  if (baseProfile !== undefined && baseProfile !== "permissive" && baseProfile !== "signed" && baseProfile !== "anchored") {
    throw new Error(`Invalid trust policy pack base profile: ${String(baseProfile)}`);
  }

  const timestamp = new Date().toISOString();
  return {
    name: parsed.name,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    inheritsFrom: typeof parsed.inheritsFrom === "string" ? parsed.inheritsFrom : undefined,
    baseProfile,
    policy: sanitizeTrustPolicy(parsed.policy),
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
  };
}

function sanitizeTrustPolicy(value: unknown): PresetBundleTrustPolicy {
  if (!value || typeof value !== "object") {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const asStringArray = (entry: unknown): string[] | undefined => {
    if (!Array.isArray(entry)) {
      return undefined;
    }
    const values = entry
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  };

  return {
    requireSigner: typeof raw.requireSigner === "boolean" ? raw.requireSigner : undefined,
    requireSignature: typeof raw.requireSignature === "boolean" ? raw.requireSignature : undefined,
    allowedOrigins: asStringArray(raw.allowedOrigins),
    allowedSigners: asStringArray(raw.allowedSigners),
    allowedSignerKeyIds: asStringArray(raw.allowedSignerKeyIds),
    trustedSignerNames: asStringArray(raw.trustedSignerNames),
  };
}

function mergePresetBundleTrustPolicy(
  base: PresetBundleTrustPolicy | undefined,
  override: PresetBundleTrustPolicy | undefined,
): PresetBundleTrustPolicy {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    allowedOrigins: mergeStringArrays(base?.allowedOrigins, override?.allowedOrigins),
    allowedSigners: mergeStringArrays(base?.allowedSigners, override?.allowedSigners),
    allowedSignerKeyIds: mergeStringArrays(base?.allowedSignerKeyIds, override?.allowedSignerKeyIds),
    trustedSignerNames: mergeStringArrays(base?.trustedSignerNames, override?.trustedSignerNames),
  };
}

function resolveTrustPolicyPackRecord(name: string, directory: string): TrustPolicyPackRecord {
  const visited = new Set<string>();

  const resolveRecursive = (currentName: string): TrustPolicyPackRecord => {
    if (visited.has(currentName)) {
      throw new Error(`Circular trust policy pack inheritance detected at: ${currentName}`);
    }
    visited.add(currentName);

    const current = readTrustPolicyPackRecord(directory, currentName);
    const parent = current.inheritsFrom ? resolveRecursive(current.inheritsFrom) : undefined;
    const resolvedBaseProfile = current.baseProfile ?? parent?.baseProfile;
    const resolvedPolicy = mergePresetBundleTrustPolicy(parent?.policy, current.policy);

    return {
      ...current,
      baseProfile: resolvedBaseProfile,
      policy: resolvedPolicy,
    };
  };

  return resolveRecursive(name);
}

function getTrustedSignerPath(directory: string, name: string): string {
  return join(getTrustedSignersDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeTrustedSignerRecord(directory: string, record: TrustedSignerRecord): void {
  const trustDirectory = getTrustedSignersDirectory(directory);
  ensureDirectoryWithMode(trustDirectory, 0o755);
  writeJsonFileAtomic(getTrustedSignerPath(directory, record.name), JSON.stringify(record, null, 2), 0o644);
}

function readTrustedSignerRecord(directory: string, name: string): TrustedSignerRecord {
  const recordPath = getTrustedSignerPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown trusted signer: ${name}`);
  }

  return parseTrustedSignerRecord(readFileSync(recordPath, "utf8"));
}

function listTrustedSignerRecords(directory: string): TrustedSignerRecord[] {
  const trustDirectory = getTrustedSignersDirectory(directory);
  if (!existsSync(trustDirectory)) {
    return [];
  }

  return readdirSync(trustDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseTrustedSignerRecord(readFileSync(join(trustDirectory, entry), "utf8")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTrustedSignerRecord(value: string): TrustedSignerRecord {
  const parsed = JSON.parse(value) as Partial<TrustedSignerRecord>;
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

function toTrustedSignerSummary(record: TrustedSignerRecord): TrustedSignerSummary {
  return {
    name: record.name,
    algorithm: record.algorithm,
    signer: record.signer,
    keyId: record.keyId,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
    replacedBy: record.replacedBy,
  };
}

function parsePresetChannelState(value: string): PresetChannelState {
  const parsed = JSON.parse(value) as Partial<PresetChannelState>;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "preset",
    channels: parsed.channels && typeof parsed.channels === "object" ? { ...parsed.channels } : {},
    defaultChannel: typeof parsed.defaultChannel === "string" ? parsed.defaultChannel : undefined,
  };
}

function parsePresetBundle(value: string): PresetBundle {
  const parsed = JSON.parse(value) as Partial<PresetBundle>;
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

function parsePresetBundleMetadata(value: string): PresetBundleMetadata {
  const parsed = JSON.parse(value) as Partial<PresetBundleMetadata>;
  return {
    bundleFormatVersion: typeof parsed.bundleFormatVersion === "number" ? parsed.bundleFormatVersion : PRESET_BUNDLE_FORMAT_VERSION,
    glialnodeVersion: typeof parsed.glialnodeVersion === "string" ? parsed.glialnodeVersion : GLIALNODE_VERSION,
    nodeEngine: typeof parsed.nodeEngine === "string" ? parsed.nodeEngine : GLIALNODE_NODE_ENGINE,
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

interface ResolvedPresetBundleTrustPolicy extends PresetBundleTrustPolicy {
  trustedSignerNamesByKeyId?: Record<string, string[]>;
  revokedTrustedSignerNames?: string[];
}

interface ResolvedSpaceSnapshotTrustPolicy extends SpaceSnapshotTrustPolicy {
  trustedSignerNamesByKeyId?: Record<string, string[]>;
  revokedTrustedSignerNames?: string[];
}

function validatePresetBundle(
  bundle: PresetBundle,
  trustPolicy: PresetBundleTrustPolicy = {},
  trustProfile: PresetBundleTrustProfileName = "permissive",
): PresetBundleValidation {
  const resolvedTrustPolicy = trustPolicy as ResolvedPresetBundleTrustPolicy;
  if (bundle.metadata.bundleFormatVersion !== PRESET_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported preset bundle format: ${bundle.metadata.bundleFormatVersion}. Expected ${PRESET_BUNDLE_FORMAT_VERSION}.`,
    );
  }

  const warnings: string[] = [];
  const trustWarnings: string[] = [];
  const matchedTrustedSignerNames: string[] = [];
  const revokedTrustedSignerNames = [...(resolvedTrustPolicy.revokedTrustedSignerNames ?? [])];
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

    const verified = verifyPresetBundleSignature(bundle);
    if (!verified) {
      throw new Error("Preset bundle signature verification failed.");
    }

    if (trustPolicy.allowedSignerKeyIds?.length && !trustPolicy.allowedSignerKeyIds.includes(signerKeyId)) {
      trustWarnings.push(`Preset bundle signer key id is not allowed: ${signerKeyId}`);
    }

    const matchedTrustedSignerNamesForKey = resolvedTrustPolicy.trustedSignerNamesByKeyId?.[signerKeyId] ?? [];
    if (matchedTrustedSignerNamesForKey.length > 0) {
      matchedTrustedSignerNames.push(...matchedTrustedSignerNamesForKey);
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
      revokedTrustedSignerNames,
      signed: Boolean(bundle.metadata.signature),
    },
  };
}

function resolvePresetBundleTrustPolicy(
  trustPolicy: PresetBundleTrustPolicy | undefined,
  directory: string,
  trustProfile: PresetBundleTrustProfileName = "permissive",
): ResolvedPresetBundleTrustPolicy {
  const profilePolicy = getPresetBundleTrustProfile(trustProfile);
  const basePolicy: PresetBundleTrustPolicy = {
    ...profilePolicy,
    ...trustPolicy,
    allowedOrigins: mergeStringArrays(profilePolicy.allowedOrigins, trustPolicy?.allowedOrigins),
    allowedSigners: mergeStringArrays(profilePolicy.allowedSigners, trustPolicy?.allowedSigners),
    allowedSignerKeyIds: mergeStringArrays(profilePolicy.allowedSignerKeyIds, trustPolicy?.allowedSignerKeyIds),
    trustedSignerNames: mergeStringArrays(profilePolicy.trustedSignerNames, trustPolicy?.trustedSignerNames),
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
  const allowedSignerKeyIds = [
    ...(basePolicy.allowedSignerKeyIds ?? []),
    ...trustedSignerResolution.allowedSignerKeyIds,
  ];

  return {
    ...basePolicy,
    allowedSignerKeyIds: Array.from(new Set(allowedSignerKeyIds)),
    trustedSignerNamesByKeyId: trustedSignerResolution.trustedSignerNamesByKeyId,
    revokedTrustedSignerNames: trustedSignerResolution.revokedTrustedSignerNames,
  };
}

function mergePresetBundleTrustPolicyFromSettings(
  trustPolicy: PresetBundleTrustPolicy | undefined,
  provenanceSettings: NonNullable<MemorySpace["settings"]>["provenance"] | undefined,
): PresetBundleTrustPolicy | undefined {
  if (!trustPolicy && !provenanceSettings) {
    return undefined;
  }

  return {
    ...trustPolicy,
    allowedOrigins: mergeStringArrays(provenanceSettings?.allowedOrigins, trustPolicy?.allowedOrigins),
    allowedSigners: mergeStringArrays(provenanceSettings?.allowedSigners, trustPolicy?.allowedSigners),
    allowedSignerKeyIds: mergeStringArrays(provenanceSettings?.allowedSignerKeyIds, trustPolicy?.allowedSignerKeyIds),
    trustedSignerNames: mergeStringArrays(provenanceSettings?.trustedSignerNames, trustPolicy?.trustedSignerNames),
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

function getPresetBundleTrustProfile(profile: PresetBundleTrustProfileName): PresetBundleTrustPolicy {
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
    default:
      return {};
  }
}

function mergeStringArrays(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function computePresetBundleChecksum(bundle: PresetBundle): string {
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

function computePresetBundleSignature(bundle: PresetBundle, privateKeyPem: string): string {
  const payload = createPresetBundleSignaturePayload(bundle);
  return sign(null, payload, createPrivateKey(privateKeyPem)).toString("base64");
}

function verifyPresetBundleSignature(bundle: PresetBundle): boolean {
  if (!bundle.metadata.signature || !bundle.metadata.signerPublicKey) {
    return false;
  }

  const payload = createPresetBundleSignaturePayload(bundle);
  return verify(
    null,
    payload,
    createPublicKey(bundle.metadata.signerPublicKey),
    Buffer.from(bundle.metadata.signature, "base64"),
  );
}

function createPresetBundleSignaturePayload(bundle: PresetBundle): Buffer {
  return Buffer.from(stableStringify({
    ...bundle,
    metadata: {
      ...bundle.metadata,
      signature: undefined,
    },
  }));
}

function parseSpaceSnapshot(value: string): SpaceSnapshot {
  return normalizeSpaceSnapshot(JSON.parse(value) as Partial<SpaceSnapshot>);
}

export function convertSpaceGraphToCytoscape(graph: SpaceGraphExport): SpaceGraphCytoscapeExport {
  return {
    metadata: graph.metadata,
    counts: graph.counts,
    elements: {
      nodes: graph.nodes.map((node) => ({
        data: node,
      })),
      edges: graph.edges.map((edge) => ({
        data: {
          ...edge,
          source: edge.fromId,
          target: edge.toId,
        },
      })),
    },
  };
}

export function convertSpaceGraphToDot(graph: SpaceGraphExport): string {
  const lines: string[] = [];
  lines.push(`digraph ${toDotId(graph.metadata.spaceId)} {`);
  lines.push(`  graph [label=${toDotLabel(`Space Graph: ${graph.metadata.spaceName}`)}, labelloc="t"];`);
  lines.push("  rankdir=LR;");

  for (const node of graph.nodes) {
    const shape = getDotShapeForNodeType(node.type);
    const label = node.label || `${node.type}:${node.id}`;
    lines.push(`  ${toDotId(node.id)} [shape=${shape}, label=${toDotLabel(label)}];`);
  }

  for (const edge of graph.edges) {
    lines.push(
      `  ${toDotId(edge.fromId)} -> ${toDotId(edge.toId)} [label=${toDotLabel(edge.label)}];`,
    );
  }

  lines.push("}");
  return lines.join("\n");
}

function buildSpaceGraphExport(
  space: MemorySpace,
  scopes: ScopeRecord[],
  events: MemoryEvent[],
  records: MemoryRecord[],
  links: MemoryRecordLink[],
  options: {
    includeScopes: boolean;
    includeEvents: boolean;
  },
): SpaceGraphExport {
  const exportedAt = new Date().toISOString();
  const nodes: SpaceGraphNode[] = [
    {
      id: space.id,
      type: "space",
      label: space.name,
      summary: space.description,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    },
    ...records.map((record) => ({
      id: record.id,
      type: "record" as const,
      label: record.summary ?? record.content,
      tier: record.tier,
      kind: record.kind,
      status: record.status,
      visibility: record.visibility,
      scopeId: record.scope.id,
      tags: record.tags,
      importance: record.importance,
      confidence: record.confidence,
      freshness: record.freshness,
      summary: record.summary,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })),
  ];

  if (options.includeScopes) {
    nodes.push(...scopes.map((scope) => ({
      id: scope.id,
      type: "scope" as const,
      label: scope.label ?? `${scope.type}:${scope.id}`,
      scopeType: scope.type,
      parentScopeId: scope.parentScopeId,
      createdAt: scope.createdAt,
      updatedAt: scope.updatedAt,
    })));
  }

  if (options.includeEvents) {
    nodes.push(...events.map((event) => ({
      id: event.id,
      type: "event" as const,
      label: event.summary,
      eventType: event.type,
      actorType: event.actorType,
      actorId: event.actorId,
      scopeId: event.scope.id,
      summary: event.summary,
      createdAt: event.createdAt,
    })));
  }

  const edges: SpaceGraphEdge[] = [
    ...links.map((link) => ({
      id: link.id,
      type: "record_link" as const,
      fromId: link.fromRecordId,
      toId: link.toRecordId,
      label: link.type,
      relation: link.type,
      createdAt: link.createdAt,
    })),
    ...records.map((record) => ({
      id: `space:${space.id}:record:${record.id}`,
      type: "contains_record" as const,
      fromId: space.id,
      toId: record.id,
      label: "contains",
      createdAt: record.createdAt,
    })),
    ...records
      .filter((record) => Boolean(record.sourceEventId))
      .map((record) => ({
        id: `record:${record.id}:source:${record.sourceEventId}`,
        type: "source_event" as const,
        fromId: record.sourceEventId as string,
        toId: record.id,
        label: "source_event",
        createdAt: record.createdAt,
      })),
  ];

  if (options.includeScopes) {
    edges.push(...scopes.map((scope) => ({
      id: `space:${space.id}:scope:${scope.id}`,
      type: "contains_scope" as const,
      fromId: space.id,
      toId: scope.id,
      label: "contains",
      createdAt: scope.createdAt,
    })));
    edges.push(...records.map((record) => ({
      id: `scope:${record.scope.id}:record:${record.id}`,
      type: "contains_record" as const,
      fromId: record.scope.id,
      toId: record.id,
      label: "contains",
      createdAt: record.createdAt,
    })));
    edges.push(...scopes
      .filter((scope) => Boolean(scope.parentScopeId))
      .map((scope) => ({
        id: `scope:${scope.parentScopeId}:child:${scope.id}`,
        type: "scope_parent" as const,
        fromId: scope.parentScopeId as string,
        toId: scope.id,
        label: "parent_of",
        createdAt: scope.createdAt,
      })));
  }

  if (options.includeEvents) {
    edges.push(...events.map((event) => ({
      id: `space:${space.id}:event:${event.id}`,
      type: "contains_event" as const,
      fromId: space.id,
      toId: event.id,
      label: "contains",
      createdAt: event.createdAt,
    })));
    if (options.includeScopes) {
      edges.push(...events.map((event) => ({
        id: `scope:${event.scope.id}:event:${event.id}`,
        type: "contains_event" as const,
        fromId: event.scope.id,
        toId: event.id,
        label: "contains",
        createdAt: event.createdAt,
      })));
    }
  }

  const sortedNodes = nodes
    .slice()
    .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
  const sortedEdges = edges
    .slice()
    .sort((left, right) => `${left.type}:${left.fromId}:${left.toId}:${left.id}`.localeCompare(`${right.type}:${right.fromId}:${right.toId}:${right.id}`));

  return {
    metadata: {
      schemaVersion: 1,
      exportedAt,
      spaceId: space.id,
      spaceName: space.name,
      nodeCount: sortedNodes.length,
      edgeCount: sortedEdges.length,
      options: {
        includeScopes: options.includeScopes,
        includeEvents: options.includeEvents,
      },
    },
    counts: {
      scopes: scopes.length,
      events: events.length,
      records: records.length,
      links: links.length,
    },
    nodes: sortedNodes,
    edges: sortedEdges,
  };
}

function getDotShapeForNodeType(type: SpaceGraphNodeType): string {
  switch (type) {
    case "space":
      return "doubleoctagon";
    case "scope":
      return "ellipse";
    case "record":
      return "box";
    case "event":
      return "diamond";
    default:
      return "box";
  }
}

function toDotId(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function toDotLabel(value: string): string {
  const normalized = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r?\n/g, "\\n");
  return `"${normalized}"`;
}

function buildSpaceInspectorPolicyView(settings: MemorySpace["settings"] | undefined): SpaceInspectorPolicyView {
  return {
    effective: {
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
    },
    origin: {
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
    },
  };
}

function buildSpaceInspectorRiskSummary(report: SpaceReport): SpaceInspectorRiskSummary {
  const contestedMemoryEvents = report.eventCountsByType.memory_conflicted ?? 0;
  const decayedMemoryEvents = report.eventCountsByType.memory_decayed ?? 0;
  const provenanceSummaryRecords = report.provenanceSummaryCount;
  const needsTrustReview = (report.recentProvenanceEvents.length > 0) && (provenanceSummaryRecords === 0);
  const maintenanceStale = !report.maintenance.latestRunAt;
  const riskScore =
    (needsTrustReview ? 3 : 0) +
    (maintenanceStale ? 2 : 0) +
    (contestedMemoryEvents > 0 ? 2 : 0) +
    (decayedMemoryEvents > 0 ? 1 : 0);

  const riskLevel = riskScore >= 4
    ? "high"
    : riskScore >= 2
      ? "moderate"
      : "low";

  return {
    contestedMemoryEvents,
    decayedMemoryEvents,
    provenanceSummaryRecords,
    needsTrustReview,
    maintenanceStale,
    riskLevel,
  };
}

function renderSpaceInspectorHtml(snapshot: SpaceInspectorSnapshot): string {
  const serializedSnapshot = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GlialNode Inspector - ${escapeHtml(snapshot.space.name)}</title>
    <style>
      :root {
        --bg: #f2efe9;
        --surface: #fffdf9;
        --ink: #1f2328;
        --muted: #5e6772;
        --accent: #0d5c63;
        --border: #d8d1c4;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: radial-gradient(circle at 20% 0%, #f8f4eb 0%, var(--bg) 40%, #e7e2d8 100%);
        color: var(--ink);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1.5rem 1rem 3rem;
      }
      h1, h2 { margin: 0 0 0.8rem; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.8rem;
        margin-bottom: 1rem;
      }
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 0.9rem;
      }
      .metric {
        font-size: 1.35rem;
        font-weight: 700;
        color: var(--accent);
      }
      .label {
        color: var(--muted);
        font-size: 0.92rem;
      }
      details {
        margin-top: 0.8rem;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.7rem 0.8rem;
      }
      summary {
        cursor: pointer;
        font-weight: 600;
      }
      pre {
        margin: 0.7rem 0 0;
        max-height: 320px;
        overflow: auto;
        background: #191c20;
        color: #e8edf2;
        padding: 0.8rem;
        border-radius: 8px;
        font-size: 0.8rem;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.6rem;
        font-size: 0.9rem;
      }
      td, th {
        border-bottom: 1px solid var(--border);
        text-align: left;
        padding: 0.45rem 0.2rem;
      }
      .muted { color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <h1>GlialNode Space Inspector</h1>
      <p class="muted">Read-only snapshot generated at ${escapeHtml(snapshot.metadata.generatedAt)}.</p>
      <section class="grid" id="summary"></section>
      <details open>
        <summary>Policy (effective + origin)</summary>
        <pre id="policy"></pre>
      </details>
      <details>
        <summary>Report (event types + maintenance)</summary>
        <pre id="report"></pre>
      </details>
      <details>
        <summary>Graph (counts + topology)</summary>
        <table id="graphCounts"></table>
        <pre id="graph"></pre>
      </details>
      <details>
        <summary>Trust Registry</summary>
        <pre id="trust"></pre>
      </details>
      <details>
        <summary>Recall Preview</summary>
        <pre id="recall"></pre>
      </details>
    </main>
    <script id="snapshot-data" type="application/json">${serializedSnapshot}</script>
    <script>
      const snapshot = JSON.parse(document.getElementById("snapshot-data").textContent || "{}");
      const summary = document.getElementById("summary");
      const cards = [
        ["Space", snapshot.space?.name || ""],
        ["Space ID", snapshot.space?.id || ""],
        ["Records", String(snapshot.report?.recordCount ?? 0)],
        ["Events", String(snapshot.report?.eventCount ?? 0)],
        ["Links", String(snapshot.report?.linkCount ?? 0)],
        ["Risk Level", String(snapshot.risk?.riskLevel ?? "low")],
        ["Contested Memory Events", String(snapshot.risk?.contestedMemoryEvents ?? 0)],
        ["Decayed Memory Events", String(snapshot.risk?.decayedMemoryEvents ?? 0)],
        ["Graph Nodes", String(snapshot.graph?.metadata?.nodeCount ?? 0)],
        ["Graph Edges", String(snapshot.graph?.metadata?.edgeCount ?? 0)],
        ["Recent Lifecycle Events", String(snapshot.report?.recentLifecycleEvents?.length ?? 0)]
      ];
      summary.innerHTML = cards.map(([label, value]) => (
        '<div class="card"><div class="metric">' + escapeHtml(value) + '</div><div class="label">' + escapeHtml(label) + '</div></div>'
      )).join("");

      document.getElementById("policy").textContent = JSON.stringify(snapshot.policy, null, 2);
      document.getElementById("report").textContent = JSON.stringify({
        eventCountsByType: snapshot.report?.eventCountsByType || {},
        maintenance: snapshot.report?.maintenance || {},
        recentLifecycleEvents: snapshot.report?.recentLifecycleEvents || [],
        recentProvenanceEvents: snapshot.report?.recentProvenanceEvents || []
      }, null, 2);
      document.getElementById("graph").textContent = JSON.stringify(snapshot.graph, null, 2);
      document.getElementById("trust").textContent = JSON.stringify(snapshot.trustRegistry || { note: "Not included." }, null, 2);
      document.getElementById("recall").textContent = JSON.stringify(snapshot.recall || { note: "No recall query requested." }, null, 2);
      document.getElementById("graphCounts").innerHTML = [
        ["Scopes", snapshot.graph?.counts?.scopes ?? 0],
        ["Records", snapshot.graph?.counts?.records ?? 0],
        ["Events", snapshot.graph?.counts?.events ?? 0],
        ["Links", snapshot.graph?.counts?.links ?? 0]
      ].map(([label, value]) => (
        "<tr><th>" + escapeHtml(String(label)) + "</th><td>" + escapeHtml(String(value)) + "</td></tr>"
      )).join("");

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }
    </script>
  </body>
</html>`;
}

function renderSpaceInspectorIndexHtml(snapshot: SpaceInspectorIndexSnapshot): string {
  const serializedSnapshot = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GlialNode Inspector Index</title>
    <style>
      :root {
        --bg: #eef4f8;
        --surface: #fbfdff;
        --ink: #15202a;
        --muted: #5a6773;
        --accent: #0b7285;
        --border: #d1dce5;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: linear-gradient(180deg, #f5f9fc 0%, var(--bg) 100%);
      }
      main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 1.4rem 1rem 2.2rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.7rem;
      }
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.75rem;
      }
      .metric {
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--accent);
      }
      .label {
        font-size: 0.88rem;
        color: var(--muted);
      }
      table {
        margin-top: 1rem;
        width: 100%;
        border-collapse: collapse;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }
      th, td {
        text-align: left;
        padding: 0.5rem;
        border-bottom: 1px solid var(--border);
        font-size: 0.9rem;
        vertical-align: top;
      }
      th {
        background: #f0f7fb;
      }
      pre {
        margin-top: 1rem;
        padding: 0.8rem;
        border-radius: 8px;
        overflow: auto;
        max-height: 280px;
        font-size: 0.8rem;
        background: #1b222a;
        color: #e9eef3;
      }
      .muted { color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <h1>GlialNode Space Inspector Index</h1>
      <p class="muted">Generated at ${escapeHtml(snapshot.metadata.generatedAt)}. Space count: ${snapshot.metadata.spaceCount}.</p>
      <section class="grid" id="totals"></section>
      <table>
        <thead>
          <tr>
            <th>Space</th>
            <th>Records</th>
            <th>Events</th>
            <th>Links</th>
            <th>Provenance Summaries</th>
            <th>Risk</th>
            <th>Policy</th>
            <th>Graph</th>
          </tr>
        </thead>
        <tbody id="spaceRows"></tbody>
      </table>
      <pre id="trust"></pre>
    </main>
    <script id="snapshot-data" type="application/json">${serializedSnapshot}</script>
    <script>
      const snapshot = JSON.parse(document.getElementById("snapshot-data").textContent || "{}");
      const totals = document.getElementById("totals");
      const spaceRows = document.getElementById("spaceRows");
      const trust = document.getElementById("trust");
      const cards = [
        ["Total Spaces", snapshot.metadata?.spaceCount ?? 0],
        ["Total Records", snapshot.totals?.records ?? 0],
        ["Total Events", snapshot.totals?.events ?? 0],
        ["Total Links", snapshot.totals?.links ?? 0],
        ["Total Graph Nodes", snapshot.totals?.graphNodes ?? 0],
        ["Total Graph Edges", snapshot.totals?.graphEdges ?? 0],
        ["Spaces Need Trust Review", snapshot.totals?.spacesNeedingTrustReview ?? 0],
        ["Spaces With Contested", snapshot.totals?.spacesWithContestedMemory ?? 0],
        ["Spaces With Stale", snapshot.totals?.spacesWithStaleMemory ?? 0],
      ];
      totals.innerHTML = cards.map(([label, value]) => (
        '<div class="card"><div class="metric">' + escapeHtml(String(value)) + '</div><div class="label">' + escapeHtml(String(label)) + '</div></div>'
      )).join("");
      const rows = (snapshot.spaces || []).map((entry) => (
        "<tr>" +
          "<td><strong>" + escapeHtml(entry.space?.name || "") + "</strong><br><span class='muted'>" + escapeHtml(entry.space?.id || "") + "</span></td>" +
          "<td>" + escapeHtml(String(entry.report?.recordCount ?? 0)) + "</td>" +
          "<td>" + escapeHtml(String(entry.report?.eventCount ?? 0)) + "</td>" +
          "<td>" + escapeHtml(String(entry.report?.linkCount ?? 0)) + "</td>" +
          "<td>" + escapeHtml(String(entry.report?.provenanceSummaryCount ?? 0)) + "</td>" +
          "<td>level=" + escapeHtml(String(entry.risk?.riskLevel || "low")) + "<br>contested=" + escapeHtml(String(entry.risk?.contestedMemoryEvents ?? 0)) + "<br>decayed=" + escapeHtml(String(entry.risk?.decayedMemoryEvents ?? 0)) + "</td>" +
          "<td>maxShort=" + escapeHtml(String(entry.policy?.maxShortTermRecords ?? "")) + "<br>trust=" + escapeHtml(String(entry.policy?.provenanceTrustProfile || "unset")) + "</td>" +
          "<td>" + escapeHtml(entry.graph ? (entry.graph.nodes + " nodes / " + entry.graph.edges + " edges") : "not included") + "</td>" +
        "</tr>"
      ));
      spaceRows.innerHTML = rows.join("");
      trust.textContent = JSON.stringify(snapshot.trustRegistry || { note: "Trust registry not included." }, null, 2);

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }
    </script>
  </body>
</html>`;
}

async function buildInspectorRecall(
  client: GlialNodeClient,
  spaceId: string,
  options: SpaceInspectorRecallOptions,
): Promise<NonNullable<SpaceInspectorSnapshot["recall"]>> {
  const primaryLimit = options.primaryLimit ?? 3;
  const supportLimit = options.supportLimit ?? 3;
  const query: MemorySearchQuery = {
    ...options.query,
    spaceId,
    limit: options.query.limit ?? primaryLimit,
  };
  const traces = await client.traceRecall(query, {
    primaryLimit,
    supportLimit,
  });
  const bundles = await client.bundleRecall(query, {
    primaryLimit,
    supportLimit,
    bundleConsumer: options.bundleConsumer,
    bundleProvenanceMode: options.bundleProvenanceMode,
  });
  return {
    query,
    traceCount: traces.length,
    traces,
    bundles,
  };
}

async function captureHtmlScreenshot(
  htmlPath: string,
  screenshotPath: string,
  viewport: { width: number; height: number } | undefined,
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
      "Inspector screenshot capture requires the 'playwright' package. Install it or disable --capture-screenshots.",
    );
  }

  const browser = await playwrightModule.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewportSize: {
        width: viewport?.width ?? 1440,
        height: viewport?.height ?? 900,
      },
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

function toSafePathSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "space";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSpaceSnapshot(value: Partial<SpaceSnapshot>): SpaceSnapshot {
  const parsed = value as Partial<SpaceSnapshot> & {
    metadata?: Partial<SpaceSnapshotMetadata>;
  };

  return {
    metadata: {
      snapshotFormatVersion: typeof parsed.metadata?.snapshotFormatVersion === "number"
        ? parsed.metadata.snapshotFormatVersion
        : 0,
      glialnodeVersion: typeof parsed.metadata?.glialnodeVersion === "string"
        ? parsed.metadata.glialnodeVersion
        : "legacy",
      nodeEngine: typeof parsed.metadata?.nodeEngine === "string"
        ? parsed.metadata.nodeEngine
        : "unknown",
      origin: typeof parsed.metadata?.origin === "string" ? parsed.metadata.origin : undefined,
      signer: typeof parsed.metadata?.signer === "string" ? parsed.metadata.signer : undefined,
      checksumAlgorithm: parsed.metadata?.checksumAlgorithm === "sha256" ? "sha256" : "sha256",
      checksum: typeof parsed.metadata?.checksum === "string" ? parsed.metadata.checksum : "",
      signatureAlgorithm: parsed.metadata?.signatureAlgorithm === "ed25519" ? "ed25519" : undefined,
      signerKeyId: typeof parsed.metadata?.signerKeyId === "string" ? parsed.metadata.signerKeyId : undefined,
      signerPublicKey: typeof parsed.metadata?.signerPublicKey === "string" ? parsed.metadata.signerPublicKey : undefined,
      signature: typeof parsed.metadata?.signature === "string" ? parsed.metadata.signature : undefined,
    },
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    space: parsed.space as MemorySpace,
    scopes: Array.isArray(parsed.scopes) ? parsed.scopes as ScopeRecord[] : [],
    events: Array.isArray(parsed.events) ? parsed.events as MemoryEvent[] : [],
    records: Array.isArray(parsed.records) ? parsed.records as MemoryRecord[] : [],
    links: Array.isArray(parsed.links) ? parsed.links as MemoryRecordLink[] : [],
  };
}

async function prepareSnapshotForImport(
  repository: MemoryRepository,
  snapshot: SpaceSnapshot,
  collisionPolicy: ImportCollisionPolicy,
): Promise<SpaceSnapshot> {
  const existingSpace = await repository.getSpace(snapshot.space.id);
  if (!existingSpace) {
    return snapshot;
  }

  if (collisionPolicy === "overwrite") {
    return snapshot;
  }

  if (collisionPolicy === "rename") {
    return remapSnapshotIdentity(snapshot);
  }

  throw new Error(`Space already exists: ${snapshot.space.id}. Use collisionPolicy=overwrite or collisionPolicy=rename.`);
}

function remapSnapshotIdentity(snapshot: SpaceSnapshot): SpaceSnapshot {
  const nextSpaceId = createId("space");
  const nextScopeIds = new Map(snapshot.scopes.map((scope) => [scope.id, createId("scope")]));
  const nextEventIds = new Map(snapshot.events.map((event) => [event.id, createId("event")]));
  const nextRecordIds = new Map(snapshot.records.map((record) => [record.id, createId("record")]));
  const nextLinkIds = new Map(snapshot.links.map((link) => [link.id, createId("link")]));
  const nextSpaceName = `${snapshot.space.name} (imported)`;

  const remappedScopes = snapshot.scopes.map((scope) => ({
    ...scope,
    id: nextScopeIds.get(scope.id) ?? scope.id,
    spaceId: nextSpaceId,
    parentScopeId: scope.parentScopeId ? (nextScopeIds.get(scope.parentScopeId) ?? scope.parentScopeId) : undefined,
  }));

  const remappedEvents = snapshot.events.map((event) => ({
    ...event,
    id: nextEventIds.get(event.id) ?? event.id,
    spaceId: nextSpaceId,
    scope: {
      ...event.scope,
      id: nextScopeIds.get(event.scope.id) ?? event.scope.id,
    },
  }));

  const remappedRecords = snapshot.records.map((record) => ({
    ...record,
    id: nextRecordIds.get(record.id) ?? record.id,
    spaceId: nextSpaceId,
    scope: {
      ...record.scope,
      id: nextScopeIds.get(record.scope.id) ?? record.scope.id,
    },
    sourceEventId: record.sourceEventId ? (nextEventIds.get(record.sourceEventId) ?? record.sourceEventId) : undefined,
  }));

  const remappedLinks = snapshot.links.map((link) => ({
    ...link,
    id: nextLinkIds.get(link.id) ?? link.id,
    spaceId: nextSpaceId,
    fromRecordId: nextRecordIds.get(link.fromRecordId) ?? link.fromRecordId,
    toRecordId: nextRecordIds.get(link.toRecordId) ?? link.toRecordId,
  }));

  return {
    ...snapshot,
    space: {
      ...snapshot.space,
      id: nextSpaceId,
      name: nextSpaceName,
    },
    scopes: remappedScopes,
    events: remappedEvents,
    records: remappedRecords,
    links: remappedLinks,
  };
}

function validateSpaceSnapshot(
  snapshot: SpaceSnapshot,
  trustPolicy: SpaceSnapshotTrustPolicy = {},
  trustProfile: SpaceSnapshotTrustProfile = "permissive",
): SpaceSnapshotValidationResult {
  const resolvedTrustPolicy = trustPolicy as ResolvedSpaceSnapshotTrustPolicy;
  const warnings: string[] = [];
  const trustWarnings: string[] = [];
  const matchedTrustedSignerNames: string[] = [];
  const revokedTrustedSignerNames = [...(resolvedTrustPolicy.revokedTrustedSignerNames ?? [])];
  const isLegacySnapshot = snapshot.metadata.snapshotFormatVersion === 0;

  if (isLegacySnapshot) {
    warnings.push("Snapshot has no format metadata; treating it as a legacy import without checksum verification.");
  } else if (snapshot.metadata.snapshotFormatVersion !== SPACE_SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported space snapshot format: ${snapshot.metadata.snapshotFormatVersion}. Expected ${SPACE_SNAPSHOT_FORMAT_VERSION}.`,
    );
  }

  if (!isLegacySnapshot && snapshot.metadata.glialnodeVersion !== GLIALNODE_VERSION) {
    warnings.push(
      `Snapshot was exported by GlialNode ${snapshot.metadata.glialnodeVersion}; current runtime is ${GLIALNODE_VERSION}.`,
    );
  }

  if (!isLegacySnapshot && snapshot.metadata.nodeEngine !== GLIALNODE_NODE_ENGINE) {
    warnings.push(
      `Snapshot targets Node ${snapshot.metadata.nodeEngine}; current package requires ${GLIALNODE_NODE_ENGINE}.`,
    );
  }

  if (!isLegacySnapshot) {
    const expectedChecksum = computeSpaceSnapshotChecksum(snapshot);
    if (snapshot.metadata.checksum !== expectedChecksum) {
      throw new Error("Space snapshot checksum verification failed.");
    }
  }

  if (trustPolicy.requireSigner && !snapshot.metadata.signer) {
    trustWarnings.push("Space snapshot signer is missing.");
  }

  if (trustPolicy.requireSignature && !snapshot.metadata.signature) {
    trustWarnings.push("Space snapshot is unsigned by key.");
  }

  if (trustPolicy.allowedOrigins?.length) {
    if (!snapshot.metadata.origin) {
      trustWarnings.push("Space snapshot origin is missing.");
    } else if (!trustPolicy.allowedOrigins.includes(snapshot.metadata.origin)) {
      trustWarnings.push(`Space snapshot origin is not allowed: ${snapshot.metadata.origin}`);
    }
  }

  if (trustPolicy.allowedSigners?.length) {
    if (!snapshot.metadata.signer) {
      trustWarnings.push("Space snapshot signer is missing.");
    } else if (!trustPolicy.allowedSigners.includes(snapshot.metadata.signer)) {
      trustWarnings.push(`Space snapshot signer is not allowed: ${snapshot.metadata.signer}`);
    }
  }

  if (snapshot.metadata.signature) {
    if (snapshot.metadata.signatureAlgorithm !== "ed25519") {
      throw new Error(`Unsupported space snapshot signature algorithm: ${snapshot.metadata.signatureAlgorithm ?? "unknown"}.`);
    }

    if (!snapshot.metadata.signerPublicKey) {
      throw new Error("Space snapshot signature is missing signer public key.");
    }

    const signerKeyId = computeSignerKeyId(snapshot.metadata.signerPublicKey);
    if (snapshot.metadata.signerKeyId && snapshot.metadata.signerKeyId !== signerKeyId) {
      throw new Error("Space snapshot signer key id verification failed.");
    }

    if (!verifySpaceSnapshotSignature(snapshot)) {
      throw new Error("Space snapshot signature verification failed.");
    }

    if (trustPolicy.allowedSignerKeyIds?.length && !trustPolicy.allowedSignerKeyIds.includes(signerKeyId)) {
      trustWarnings.push(`Space snapshot signer key id is not allowed: ${signerKeyId}`);
    }

    const matchedTrustedSignerNamesForKey = resolvedTrustPolicy.trustedSignerNamesByKeyId?.[signerKeyId] ?? [];
    if (matchedTrustedSignerNamesForKey.length > 0) {
      matchedTrustedSignerNames.push(...matchedTrustedSignerNamesForKey);
    }
  } else if (trustPolicy.allowedSignerKeyIds?.length) {
    trustWarnings.push("Space snapshot signer key id is missing.");
  }

  if (trustWarnings.length > 0) {
    throw new Error(`Space snapshot trust validation failed: ${trustWarnings.join("; ")}`);
  }

  return {
    metadata: snapshot.metadata,
    warnings,
    trustWarnings,
    trusted: true,
    report: {
      trustProfile,
      effectivePolicy: trustPolicy,
      signerKeyId: snapshot.metadata.signerKeyId
        ?? (snapshot.metadata.signerPublicKey ? computeSignerKeyId(snapshot.metadata.signerPublicKey) : undefined),
      matchedTrustedSignerNames,
      revokedTrustedSignerNames,
      signed: Boolean(snapshot.metadata.signature),
      legacySnapshot: isLegacySnapshot,
    },
  };
}

function resolveSpaceSnapshotTrustPolicy(
  trustPolicy: SpaceSnapshotTrustPolicy,
  directory: string | undefined,
  trustProfile: SpaceSnapshotTrustProfile = "permissive",
): ResolvedSpaceSnapshotTrustPolicy {
  const profilePolicy = getSpaceSnapshotTrustProfile(trustProfile);
  const basePolicy = {
    ...profilePolicy,
    ...trustPolicy,
    allowedOrigins: mergeStringArrays(profilePolicy.allowedOrigins, trustPolicy.allowedOrigins),
    allowedSigners: mergeStringArrays(profilePolicy.allowedSigners, trustPolicy.allowedSigners),
    allowedSignerKeyIds: mergeStringArrays(profilePolicy.allowedSignerKeyIds, trustPolicy.allowedSignerKeyIds),
    trustedSignerNames: mergeStringArrays(profilePolicy.trustedSignerNames, trustPolicy.trustedSignerNames),
  };

  if (!basePolicy.trustedSignerNames?.length) {
    if (trustProfile === "anchored" && !basePolicy.allowedSignerKeyIds?.length) {
      throw new Error("Snapshot trust profile 'anchored' requires trusted signers or allowed signer key ids.");
    }
    return basePolicy;
  }

  if (!directory) {
    throw new Error("Snapshot trust resolution requires a preset directory when trusted signer names are used.");
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

function getSpaceSnapshotTrustProfile(profile: SpaceSnapshotTrustProfile): SpaceSnapshotTrustPolicy {
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

function computeSpaceSnapshotChecksum(snapshot: SpaceSnapshot): string {
  const checksumPayload = {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      checksum: "",
      signature: undefined,
    },
  };

  return createHash("sha256")
    .update(stableStringify(checksumPayload))
    .digest("hex");
}

function computeSpaceSnapshotSignature(snapshot: SpaceSnapshot, privateKeyPem: string): string {
  return sign(null, createSpaceSnapshotSignaturePayload(snapshot), createPrivateKey(privateKeyPem)).toString("base64");
}

function verifySpaceSnapshotSignature(snapshot: SpaceSnapshot): boolean {
  if (!snapshot.metadata.signature || !snapshot.metadata.signerPublicKey) {
    return false;
  }

  return verify(
    null,
    createSpaceSnapshotSignaturePayload(snapshot),
    createPublicKey(snapshot.metadata.signerPublicKey),
    Buffer.from(snapshot.metadata.signature, "base64"),
  );
}

function createSpaceSnapshotSignaturePayload(snapshot: SpaceSnapshot): Buffer {
  return Buffer.from(stableStringify({
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
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

function mergeSpaceSettings(
  ...settings: Array<MemorySpaceSettings | undefined>
): MemorySpaceSettings {
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
      trustedSignerNames: mergeStringArrays(
        existing?.provenance?.trustedSignerNames,
        ([] as string[]).concat(...rest.map((entry) => entry?.provenance?.trustedSignerNames ?? [])),
      ),
    },
  };
}

async function requireSpace(repository: MemoryRepository, spaceId: string): Promise<MemorySpace> {
  const space = await repository.getSpace(spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  return space;
}

async function requireRecord(repository: MemoryRepository, recordId: string): Promise<MemoryRecord> {
  const record = await repository.getRecord(recordId);

  if (!record) {
    throw new Error(`Unknown record: ${recordId}`);
  }

  return record;
}

function mergeUpdatedRecords(existing: MemoryRecord[], updates: MemoryRecord[]): MemoryRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));

  for (const update of updates) {
    byId.set(update.id, update);
  }

  return [...byId.values()];
}

async function persistReinforcementPlan(
  repository: MemoryRepository,
  plan: ReturnType<typeof planReinforcement>,
): Promise<void> {
  for (const updatedRecord of applyReinforcementPlan(plan)) {
    await repository.writeRecord(updatedRecord);
  }

  for (const event of createReinforcementEvents(plan)) {
    await repository.appendEvent(event);
  }

  const summaryRecord = createReinforcementSummaryRecord(plan);
  if (summaryRecord) {
    await repository.writeRecord(summaryRecord);
    for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
      await repository.linkRecords(link);
    }
  }
}
