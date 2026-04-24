import type { TokenUsageReport } from "../metrics/repository.js";
import {
  assertDashboardSnapshot,
  createUnavailableDashboardMetric,
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  type DashboardMetric,
  type DashboardOverviewSnapshot,
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
