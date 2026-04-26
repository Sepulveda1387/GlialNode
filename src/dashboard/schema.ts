import { ValidationError } from "../core/errors.js";

export const DASHBOARD_SNAPSHOT_SCHEMA_VERSION = "1.0.0" as const;

export type DashboardSnapshotSchemaVersion = typeof DASHBOARD_SNAPSHOT_SCHEMA_VERSION;

export type DashboardSnapshotKind = "overview" | "executive" | "product" | "operations";

export type DashboardMetricConfidence = "measured" | "estimated" | "configured" | "computed" | "unavailable";

export type DashboardMetricUnit =
  | "count"
  | "tokens"
  | "currency"
  | "milliseconds"
  | "percent"
  | "ratio"
  | "bytes"
  | "timestamp";

export type DashboardMetricSource =
  | "memory_report"
  | "memory_events"
  | "recall_trace"
  | "bundle_trace"
  | "trust_registry"
  | "doctor_status"
  | "storage_contract"
  | "metrics_store"
  | "cost_model"
  | "release_readiness"
  | "fixture";

export type DashboardMetricGranularity = "hour" | "day" | "week" | "month" | "all";

export type DashboardEstimateMethod =
  | "host_reported_baseline"
  | "full_context_replay_estimate"
  | "pre_glialnode_baseline"
  | "manual_operator_baseline"
  | "fixture";

export type DashboardCostModelSource = "operator_configured" | "fixture" | "unknown";

export interface DashboardMetricWindow {
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly granularity?: DashboardMetricGranularity;
}

export interface DashboardEstimateBasis {
  readonly method: DashboardEstimateMethod;
  readonly assumptions: readonly string[];
  readonly baselineLabel?: string;
  readonly sampleSize?: number;
}

export interface DashboardCostModelMetadata {
  readonly currency: string;
  readonly source: DashboardCostModelSource;
  readonly provider?: string;
  readonly model?: string;
  readonly inputCostPerMillionTokens?: number;
  readonly outputCostPerMillionTokens?: number;
  readonly configuredAt?: string;
}

export interface DashboardMetricProvenance {
  readonly source: DashboardMetricSource;
  readonly sourceId?: string;
  readonly collectedAt?: string;
  readonly window?: DashboardMetricWindow;
  readonly estimateBasis?: DashboardEstimateBasis;
  readonly costModel?: DashboardCostModelMetadata;
  readonly notes?: readonly string[];
}

export interface DashboardMetric<T = number | string | boolean> {
  readonly label: string;
  readonly value: T | null;
  readonly unit: DashboardMetricUnit;
  readonly confidence: DashboardMetricConfidence;
  readonly provenance: DashboardMetricProvenance;
}

export interface DashboardSnapshotScope {
  readonly spaceId?: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly workflowId?: string;
}

export interface DashboardSnapshotWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "critical";
}

export interface DashboardSnapshotBase {
  readonly schemaVersion: DashboardSnapshotSchemaVersion;
  readonly kind: DashboardSnapshotKind;
  readonly generatedAt: string;
  readonly scope?: DashboardSnapshotScope;
  readonly warnings: readonly DashboardSnapshotWarning[];
  readonly compatibilityNotes: readonly string[];
}

export interface DashboardOverviewSnapshot extends DashboardSnapshotBase {
  readonly kind: "overview";
  readonly memory: {
    readonly activeSpaces: DashboardMetric<number>;
    readonly activeRecords: DashboardMetric<number>;
    readonly staleRecords: DashboardMetric<number>;
  };
  readonly value: {
    readonly savedTokens: DashboardMetric<number>;
    readonly savedCost: DashboardMetric<number>;
    readonly netSavings: DashboardMetric<number>;
  };
  readonly operations: {
    readonly storageBytes: DashboardMetric<number>;
    readonly latestBackupAt: DashboardMetric<string>;
    readonly maintenanceDue: DashboardMetric<boolean>;
  };
}

export interface ExecutiveDashboardSnapshot extends DashboardSnapshotBase {
  readonly kind: "executive";
  readonly value: {
    readonly savedTokens: DashboardMetric<number>;
    readonly savedCost: DashboardMetric<number>;
    readonly netSavings: DashboardMetric<number>;
    readonly activeSpaces: DashboardMetric<number>;
  };
  readonly risk: {
    readonly memoryHealthScore: DashboardMetric<number>;
    readonly trustPostureScore: DashboardMetric<number>;
    readonly openCriticalWarnings: DashboardMetric<number>;
  };
  readonly trends: readonly DashboardMetric<number>[];
  readonly insights?: {
    readonly topRoi: readonly ExecutiveDashboardRankedItem[];
    readonly topRisk: readonly ExecutiveDashboardRankedItem[];
  };
}

export type ExecutiveDashboardInsightCategory = "space" | "agent" | "project" | "workflow" | "operation" | "risk";

export interface ExecutiveDashboardRankedItem {
  readonly key: string;
  readonly label: string;
  readonly category: ExecutiveDashboardInsightCategory;
  readonly metric: DashboardMetric<number>;
  readonly secondaryMetric?: DashboardMetric<number>;
  readonly notes: readonly string[];
}

export interface ProductDashboardSnapshot extends DashboardSnapshotBase {
  readonly kind: "product";
  readonly adoption: {
    readonly activeAgents: DashboardMetric<number>;
    readonly activeWorkflows: DashboardMetric<number>;
    readonly recallRequests: DashboardMetric<number>;
  };
  readonly quality: {
    readonly recallHitRate: DashboardMetric<number>;
    readonly compactBundleRatio: DashboardMetric<number>;
    readonly lowConfidenceRecords: DashboardMetric<number>;
  };
  readonly opportunities: readonly DashboardMetric<number>[];
}

export interface OperationsDashboardSnapshot extends DashboardSnapshotBase {
  readonly kind: "operations";
  readonly storage: {
    readonly backend: DashboardMetric<string>;
    readonly schemaVersion: DashboardMetric<string>;
    readonly databaseBytes: DashboardMetric<number>;
  };
  readonly maintenance: {
    readonly lastMaintenanceAt: DashboardMetric<string>;
    readonly pendingCompactions: DashboardMetric<number>;
    readonly pendingRetentionActions: DashboardMetric<number>;
  };
  readonly reliability: {
    readonly doctorStatus: DashboardMetric<string>;
    readonly latestBackupAt: DashboardMetric<string>;
    readonly criticalWarnings: DashboardMetric<number>;
  };
}

export type DashboardSnapshot =
  | DashboardOverviewSnapshot
  | ExecutiveDashboardSnapshot
  | ProductDashboardSnapshot
  | OperationsDashboardSnapshot;

export interface CreateUnavailableDashboardMetricOptions {
  readonly unit: DashboardMetricUnit;
  readonly source?: DashboardMetricSource;
  readonly notes?: readonly string[];
}

export function isDashboardSnapshotVersion(value: unknown): value is DashboardSnapshotSchemaVersion {
  return value === DASHBOARD_SNAPSHOT_SCHEMA_VERSION;
}

export function createUnavailableDashboardMetric<T = number | string | boolean>(
  label: string,
  options: CreateUnavailableDashboardMetricOptions,
): DashboardMetric<T> {
  return {
    label,
    value: null,
    unit: options.unit,
    confidence: "unavailable",
    provenance: {
      source: options.source ?? "fixture",
      notes: options.notes,
    },
  };
}

export function assertDashboardSnapshotVersion(snapshot: { readonly schemaVersion?: unknown }): asserts snapshot is {
  readonly schemaVersion: DashboardSnapshotSchemaVersion;
} {
  if (!isDashboardSnapshotVersion(snapshot.schemaVersion)) {
    throw new ValidationError(
      `Unsupported dashboard snapshot schema version: ${String(snapshot.schemaVersion ?? "missing")}.`,
    );
  }
}

export function assertDashboardMetric(metric: DashboardMetric<unknown>): void {
  if (metric.label.trim().length === 0) {
    throw new ValidationError("Dashboard metric label is required.");
  }

  if (metric.value === null && metric.confidence !== "unavailable") {
    throw new ValidationError("Dashboard metric with a null value must use confidence 'unavailable'.");
  }

  if (metric.value !== null && metric.confidence === "unavailable") {
    throw new ValidationError("Dashboard metric with confidence 'unavailable' must use a null value.");
  }

  if (metric.confidence === "estimated") {
    const estimateBasis = metric.provenance.estimateBasis;
    if (!estimateBasis) {
      throw new ValidationError("Estimated dashboard metric must include provenance.estimateBasis.");
    }
    if (estimateBasis.assumptions.length === 0) {
      throw new ValidationError("Estimated dashboard metric must include at least one assumption.");
    }
  }

  if (metric.provenance.costModel && metric.provenance.costModel.currency.trim().length === 0) {
    throw new ValidationError("Dashboard metric cost model currency is required when cost metadata is present.");
  }
}

export function assertDashboardSnapshot(snapshot: DashboardSnapshot): void {
  assertDashboardSnapshotVersion(snapshot);

  if (snapshot.generatedAt.trim().length === 0) {
    throw new ValidationError("Dashboard snapshot generatedAt is required.");
  }

  if (snapshot.kind === "overview") {
    assertMetricGroup(snapshot.memory);
    assertMetricGroup(snapshot.value);
    assertMetricGroup(snapshot.operations);
    return;
  }

  if (snapshot.kind === "executive") {
    assertMetricGroup(snapshot.value);
    assertMetricGroup(snapshot.risk);
    snapshot.trends.forEach(assertDashboardMetric);
    snapshot.insights?.topRoi.forEach(assertDashboardRankedItem);
    snapshot.insights?.topRisk.forEach(assertDashboardRankedItem);
    return;
  }

  if (snapshot.kind === "product") {
    assertMetricGroup(snapshot.adoption);
    assertMetricGroup(snapshot.quality);
    snapshot.opportunities.forEach(assertDashboardMetric);
    return;
  }

  assertMetricGroup(snapshot.storage);
  assertMetricGroup(snapshot.maintenance);
  assertMetricGroup(snapshot.reliability);
}

function assertMetricGroup(group: Record<string, DashboardMetric<unknown>>): void {
  Object.values(group).forEach(assertDashboardMetric);
}

function assertDashboardRankedItem(item: ExecutiveDashboardRankedItem): void {
  if (item.key.trim().length === 0) {
    throw new ValidationError("Dashboard ranked insight key is required.");
  }
  if (item.label.trim().length === 0) {
    throw new ValidationError("Dashboard ranked insight label is required.");
  }
  assertDashboardMetric(item.metric);
  if (item.secondaryMetric) {
    assertDashboardMetric(item.secondaryMetric);
  }
}
