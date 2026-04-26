import type { TokenUsageRecord, TokenUsageReport } from "../metrics/repository.js";
import {
  assertDashboardSnapshot,
  createUnavailableDashboardMetric,
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  type DashboardMetric,
  type ExecutiveDashboardSnapshot,
  type ExecutiveDashboardRankedItem,
  type DashboardOverviewSnapshot,
  type OperationsDashboardSnapshot,
  type DashboardSnapshotScope,
  type DashboardSnapshotWarning,
} from "./schema.js";
import { assertDashboardSnapshotPrivacy } from "./privacy.js";

export interface BuildDashboardOverviewSnapshotInput {
  readonly generatedAt?: string;
  readonly scope?: DashboardSnapshotScope;
  readonly activeSpaces: number;
  readonly activeRecords: number;
  readonly staleRecords: number;
  readonly tokenUsageReport?: TokenUsageReport;
  readonly storageBytes?: number;
  readonly latestBackupAt?: string;
  readonly maintenanceDue: boolean;
  readonly warnings?: readonly DashboardSnapshotWarning[];
  readonly compatibilityNotes?: readonly string[];
}

export interface BuildScopedDashboardSnapshotInput extends BuildDashboardOverviewSnapshotInput {
  readonly scope: DashboardSnapshotScope;
}

export interface DashboardMemoryHealthInput {
  readonly activeRecords: number;
  readonly staleRecords: number;
  readonly lowConfidenceRecords: number;
  readonly archivedRecords: number;
  readonly supersededRecords: number;
  readonly expiredRecords: number;
  readonly provenanceSummaryCount: number;
  readonly latestMaintenanceAt?: string;
}

export interface DashboardMemoryHealthReport {
  readonly activeRecords: DashboardMetric<number>;
  readonly staleRecords: DashboardMetric<number>;
  readonly lowConfidenceRecords: DashboardMetric<number>;
  readonly archivedRecords: DashboardMetric<number>;
  readonly supersededRecords: DashboardMetric<number>;
  readonly expiredRecords: DashboardMetric<number>;
  readonly provenanceSummaryCount: DashboardMetric<number>;
  readonly healthScore: DashboardMetric<number>;
  readonly latestMaintenanceAt: DashboardMetric<string>;
}

export interface BuildExecutiveDashboardSnapshotInput extends BuildDashboardOverviewSnapshotInput {
  readonly memoryHealth: DashboardMemoryHealthInput;
  readonly trustPostureScore?: number;
  readonly tokenUsageRecords?: readonly TokenUsageRecord[];
  readonly topRisk?: readonly ExecutiveDashboardRankedItem[];
  readonly maxInsights?: number;
}

export interface BuildOperationsDashboardSnapshotInput {
  readonly generatedAt?: string;
  readonly scope?: DashboardSnapshotScope;
  readonly backend: string;
  readonly schemaVersion: string;
  readonly databaseBytes?: number;
  readonly lastMaintenanceAt?: string;
  readonly pendingCompactions: number;
  readonly pendingRetentionActions: number;
  readonly doctorStatus: "ready" | "attention" | "unknown";
  readonly latestBackupAt?: string;
  readonly criticalWarnings: number;
  readonly warnings?: readonly DashboardSnapshotWarning[];
  readonly compatibilityNotes?: readonly string[];
}

export function buildDashboardOverviewSnapshot(
  input: BuildDashboardOverviewSnapshotInput,
): DashboardOverviewSnapshot {
  const snapshot: DashboardOverviewSnapshot = {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    kind: "overview",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: input.scope,
    warnings: input.warnings ?? [],
    compatibilityNotes: input.compatibilityNotes ?? [
      "Dashboard overview snapshot schema version 1.0.0.",
      "Cost and token savings are unavailable until token usage metrics exist.",
    ],
    memory: {
      activeSpaces: computedCountMetric("Active spaces", input.activeSpaces),
      activeRecords: computedCountMetric("Active records", input.activeRecords),
      staleRecords: computedCountMetric("Stale records", input.staleRecords),
    },
    value: {
      savedTokens: savedTokensMetric(input.tokenUsageReport),
      savedCost: savedCostMetric(input.tokenUsageReport, "Saved cost"),
      netSavings: savedCostMetric(input.tokenUsageReport, "Net savings"),
    },
    operations: {
      storageBytes: input.storageBytes === undefined
        ? createUnavailableDashboardMetric("Storage bytes", {
            unit: "bytes",
            source: "doctor_status",
          })
        : computedMetric("Storage bytes", input.storageBytes, "bytes", "doctor_status"),
      latestBackupAt: input.latestBackupAt === undefined
        ? createUnavailableDashboardMetric("Latest backup", {
            unit: "timestamp",
            source: "doctor_status",
          })
        : computedMetric("Latest backup", input.latestBackupAt, "timestamp", "doctor_status"),
      maintenanceDue: computedMetric("Maintenance due", input.maintenanceDue, "count", "memory_report"),
    },
  };

  assertDashboardSnapshot(snapshot);
  assertDashboardSnapshotPrivacy(snapshot);
  return snapshot;
}

export function buildSpaceDashboardSnapshot(input: BuildScopedDashboardSnapshotInput): DashboardOverviewSnapshot {
  return buildDashboardOverviewSnapshot({
    ...input,
    compatibilityNotes: input.compatibilityNotes ?? [
      "Space dashboard snapshot uses the overview schema with a space scope.",
    ],
  });
}

export function buildAgentDashboardSnapshot(input: BuildScopedDashboardSnapshotInput): DashboardOverviewSnapshot {
  return buildDashboardOverviewSnapshot({
    ...input,
    compatibilityNotes: input.compatibilityNotes ?? [
      "Agent dashboard snapshot uses the overview schema with an agent scope.",
    ],
  });
}

export function buildExecutiveDashboardSnapshot(
  input: BuildExecutiveDashboardSnapshotInput,
): ExecutiveDashboardSnapshot {
  const savedTokens = savedTokensMetric(input.tokenUsageReport);
  const savedCost = savedCostMetric(input.tokenUsageReport, "Saved cost");
  const netSavings = savedCostMetric(input.tokenUsageReport, "Net savings");
  const memoryHealth = buildDashboardMemoryHealthReport(input.memoryHealth);
  const criticalWarnings = input.warnings?.filter((warning) => warning.severity === "critical").length ?? 0;
  const snapshot: ExecutiveDashboardSnapshot = {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    kind: "executive",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: input.scope,
    warnings: input.warnings ?? [],
    compatibilityNotes: input.compatibilityNotes ?? [
      "Executive snapshot focuses on value, memory health, and visible operating risk.",
    ],
    value: {
      savedTokens,
      savedCost,
      netSavings,
      activeSpaces: computedCountMetric("Active spaces", input.activeSpaces),
    },
    risk: {
      memoryHealthScore: memoryHealth.healthScore,
      trustPostureScore: input.trustPostureScore === undefined
        ? createUnavailableDashboardMetric("Trust posture score", {
            unit: "percent",
            source: "trust_registry",
            notes: ["Trust posture reporting is not configured for this dashboard snapshot."],
          })
        : computedMetric("Trust posture score", input.trustPostureScore, "percent", "trust_registry"),
      openCriticalWarnings: computedMetric("Open critical warnings", criticalWarnings, "count", "doctor_status"),
    },
    trends: [
      savedTokens,
      savedCost,
      memoryHealth.healthScore,
    ],
    insights: {
      topRoi: buildTopRoiInsights(input.tokenUsageRecords ?? [], input.maxInsights ?? 5),
      topRisk: (input.topRisk ?? []).slice(0, Math.max(0, input.maxInsights ?? 5)),
    },
  };

  assertDashboardSnapshot(snapshot);
  assertDashboardSnapshotPrivacy(snapshot);
  return snapshot;
}

function buildTopRoiInsights(
  records: readonly TokenUsageRecord[],
  maxInsights: number,
): ExecutiveDashboardRankedItem[] {
  const groups = new Map<string, {
    category: ExecutiveDashboardRankedItem["category"];
    id: string;
    savedTokens: number;
    recordCount: number;
    latencyMs: number;
  }>();

  for (const record of records) {
    const dimensions = [
      ["space", record.spaceId],
      ["agent", record.agentId],
      ["project", record.projectId],
      ["workflow", record.workflowId],
      ["operation", record.operation],
    ] as const;

    for (const [category, id] of dimensions) {
      if (!id) continue;
      const key = `${category}:${id}`;
      const current = groups.get(key) ?? {
        category,
        id,
        savedTokens: 0,
        recordCount: 0,
        latencyMs: 0,
      };
      current.savedTokens += record.estimatedSavedTokens ?? 0;
      current.recordCount += 1;
      current.latencyMs += record.latencyMs ?? 0;
      groups.set(key, current);
    }
  }

  return [...groups.values()]
    .filter((group) => group.savedTokens > 0)
    .sort((left, right) => right.savedTokens - left.savedTokens || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, maxInsights))
    .map((group) => ({
      key: `${group.category}:${group.id}`,
      label: `${group.category}:${group.id}`,
      category: group.category,
      metric: estimatedMetric("Estimated saved tokens", group.savedTokens, "tokens", group.recordCount),
      secondaryMetric: computedMetric("Telemetry records", group.recordCount, "count", "metrics_store"),
      notes: [
        "Top ROI insight is grouped from token telemetry dimensions only.",
        "Raw prompt, completion, and memory text are not stored in dashboard metrics.",
      ],
    }));
}

export function buildDashboardMemoryHealthReport(input: DashboardMemoryHealthInput): DashboardMemoryHealthReport {
  const healthScore = calculateMemoryHealthScore(input);
  return {
    activeRecords: computedCountMetric("Active records", input.activeRecords),
    staleRecords: computedCountMetric("Stale records", input.staleRecords),
    lowConfidenceRecords: computedCountMetric("Low confidence records", input.lowConfidenceRecords),
    archivedRecords: computedCountMetric("Archived records", input.archivedRecords),
    supersededRecords: computedCountMetric("Superseded records", input.supersededRecords),
    expiredRecords: computedCountMetric("Expired records", input.expiredRecords),
    provenanceSummaryCount: computedCountMetric("Provenance summaries", input.provenanceSummaryCount),
    healthScore: computedMetric("Memory health score", healthScore, "percent", "memory_report"),
    latestMaintenanceAt: input.latestMaintenanceAt === undefined
      ? createUnavailableDashboardMetric("Latest maintenance", {
          unit: "timestamp",
          source: "memory_events",
        })
      : computedMetric("Latest maintenance", input.latestMaintenanceAt, "timestamp", "memory_events"),
  };
}

export function buildOperationsDashboardSnapshot(
  input: BuildOperationsDashboardSnapshotInput,
): OperationsDashboardSnapshot {
  const snapshot: OperationsDashboardSnapshot = {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    kind: "operations",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: input.scope,
    warnings: input.warnings ?? [],
    compatibilityNotes: input.compatibilityNotes ?? [
      "Operations snapshot is read-only and derived from storage/runtime health signals.",
    ],
    storage: {
      backend: computedMetric("Storage backend", input.backend, "count", "storage_contract"),
      schemaVersion: computedMetric("Storage schema version", input.schemaVersion, "count", "storage_contract"),
      databaseBytes: input.databaseBytes === undefined
        ? createUnavailableDashboardMetric("Database bytes", {
            unit: "bytes",
            source: "doctor_status",
          })
        : computedMetric("Database bytes", input.databaseBytes, "bytes", "doctor_status"),
    },
    maintenance: {
      lastMaintenanceAt: input.lastMaintenanceAt === undefined
        ? createUnavailableDashboardMetric("Last maintenance", {
            unit: "timestamp",
            source: "memory_events",
          })
        : computedMetric("Last maintenance", input.lastMaintenanceAt, "timestamp", "memory_events"),
      pendingCompactions: computedCountMetric("Pending compactions", input.pendingCompactions),
      pendingRetentionActions: computedCountMetric("Pending retention actions", input.pendingRetentionActions),
    },
    reliability: {
      doctorStatus: computedMetric("Doctor status", input.doctorStatus, "count", "doctor_status"),
      latestBackupAt: input.latestBackupAt === undefined
        ? createUnavailableDashboardMetric("Latest backup", {
            unit: "timestamp",
            source: "doctor_status",
          })
        : computedMetric("Latest backup", input.latestBackupAt, "timestamp", "doctor_status"),
      criticalWarnings: computedMetric("Critical warnings", input.criticalWarnings, "count", "doctor_status"),
    },
  };

  assertDashboardSnapshot(snapshot);
  assertDashboardSnapshotPrivacy(snapshot);
  return snapshot;
}

function computedCountMetric(label: string, value: number): DashboardMetric<number> {
  return computedMetric(label, value, "count", "memory_report");
}

function computedMetric<T extends number | string | boolean>(
  label: string,
  value: T,
  unit: DashboardMetric<T>["unit"],
  source: DashboardMetric<T>["provenance"]["source"],
): DashboardMetric<T> {
  return {
    label,
    value,
    unit,
    confidence: "computed",
    provenance: {
      source,
      collectedAt: new Date().toISOString(),
    },
  };
}

function estimatedMetric(
  label: string,
  value: number,
  unit: DashboardMetric<number>["unit"],
  sampleSize: number,
): DashboardMetric<number> {
  return {
    label,
    value,
    unit,
    confidence: "estimated",
    provenance: {
      source: "metrics_store",
      collectedAt: new Date().toISOString(),
      estimateBasis: {
        method: "host_reported_baseline",
        assumptions: [
          "Host app supplied baseline and actual context token counts.",
          "Savings subtract GlialNode overhead before ranking dashboard insights.",
        ],
        sampleSize,
      },
    },
  };
}

function savedTokensMetric(report: TokenUsageReport | undefined): DashboardMetric<number> {
  if (!report || report.totals.recordCount === 0) {
    return createUnavailableDashboardMetric("Saved tokens", {
      unit: "tokens",
      source: "metrics_store",
      notes: ["Token usage metrics have not been recorded for this scope."],
    });
  }

  return {
    label: "Saved tokens",
    value: report.totals.estimatedSavedTokens,
    unit: "tokens",
    confidence: "estimated",
    provenance: {
      source: "metrics_store",
      collectedAt: report.generatedAt,
      window: {
        granularity: report.granularity === "all" ? "all" : report.granularity,
        startedAt: report.filters.from,
        endedAt: report.filters.to,
      },
      estimateBasis: {
        method: "host_reported_baseline",
        assumptions: [
          "Host app supplied baseline and actual context token counts.",
          "Savings subtract GlialNode overhead before reporting estimated saved tokens.",
        ],
        sampleSize: report.totals.recordCount,
      },
    },
  };
}

function savedCostMetric(report: TokenUsageReport | undefined, label: string): DashboardMetric<number> {
  if (!report || report.totals.costSaved === undefined) {
    return createUnavailableDashboardMetric(label, {
      unit: "currency",
      source: "cost_model",
      notes: ["Cost model metadata is required before cost savings can be reported."],
    });
  }

  return {
    label,
    value: report.totals.costSaved,
    unit: "currency",
    confidence: "estimated",
    provenance: {
      source: "cost_model",
      collectedAt: report.generatedAt,
      estimateBasis: {
        method: "host_reported_baseline",
        assumptions: [
          "Cost before is derived from baseline input tokens and configured model pricing.",
          "Cost after is derived from actual input/output tokens and configured model pricing.",
        ],
        sampleSize: report.totals.recordCount,
      },
      costModel: report.costModel
        ? {
            currency: report.costModel.currency,
            source: "operator_configured",
            provider: report.costModel.provider,
            model: report.costModel.model,
            inputCostPerMillionTokens: report.costModel.inputCostPerMillionTokens,
            outputCostPerMillionTokens: report.costModel.outputCostPerMillionTokens,
          }
        : undefined,
    },
  };
}

function calculateMemoryHealthScore(input: DashboardMemoryHealthInput): number {
  if (input.activeRecords === 0) {
    return 100;
  }

  const stalePenalty = (input.staleRecords / input.activeRecords) * 35;
  const confidencePenalty = (input.lowConfidenceRecords / input.activeRecords) * 35;
  const lifecyclePenalty = ((input.supersededRecords + input.expiredRecords) / Math.max(1, input.activeRecords + input.supersededRecords + input.expiredRecords)) * 20;
  const maintenancePenalty = input.latestMaintenanceAt ? 0 : 10;

  return Math.max(0, Math.round(100 - stalePenalty - confidencePenalty - lifecyclePenalty - maintenancePenalty));
}
