import type { ExecutionContextRecord } from "../execution-context/index.js";
import {
  assertDashboardExecutionContextRoutingReport,
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  type DashboardExecutionContextRoutingReport,
  type DashboardMetric,
  type DashboardSnapshotScope,
  type ExecutiveDashboardRankedItem,
} from "./schema.js";
import { assertDashboardSnapshotPrivacy } from "./privacy.js";

export interface DashboardExecutionContextRoutingOptions {
  readonly generatedAt?: string;
  readonly scope?: DashboardSnapshotScope;
  readonly maxInsights?: number;
}

interface WeightedRouteValue {
  readonly id: string;
  score: number;
  count: number;
  failedCount: number;
}

export function buildDashboardExecutionContextRoutingReport(
  records: readonly ExecutionContextRecord[],
  options: DashboardExecutionContextRoutingOptions = {},
): DashboardExecutionContextRoutingReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const maxInsights = Math.max(0, options.maxInsights ?? 5);
  const usefulTools = new Map<string, WeightedRouteValue>();
  const noisyTools = new Map<string, WeightedRouteValue>();
  const usefulSkills = new Map<string, WeightedRouteValue>();

  let success = 0;
  let partial = 0;
  let failed = 0;
  let skippedToolMentions = 0;
  let latencySamples = 0;
  let latencyMs = 0;
  let toolCallSamples = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let failedPathInputTokens = 0;
  let lowConfidence = 0;

  for (const record of records) {
    const outcomeWeight = scoreOutcome(record);
    if (record.outcome.state === "success") success += 1;
    if (record.outcome.state === "partial") partial += 1;
    if (record.outcome.state === "failed") failed += 1;
    if (record.confidence === "low") lowConfidence += 1;

    if (record.outcome.latencyMs !== undefined) {
      latencySamples += 1;
      latencyMs += record.outcome.latencyMs;
    }
    if (record.outcome.toolCallCount !== undefined) {
      toolCallSamples += 1;
      toolCalls += record.outcome.toolCallCount;
    }
    inputTokens += record.outcome.inputTokens ?? 0;
    outputTokens += record.outcome.outputTokens ?? 0;
    if (record.outcome.state === "failed") {
      failedPathInputTokens += record.outcome.inputTokens ?? 0;
    }

    for (const tool of record.selectedTools) {
      addWeighted(usefulTools, tool, outcomeWeight, record.outcome.state);
    }
    for (const skill of record.selectedSkills) {
      addWeighted(usefulSkills, skill, outcomeWeight, record.outcome.state);
    }
    for (const tool of record.skippedTools) {
      skippedToolMentions += 1;
      addWeighted(noisyTools, tool, skippedToolScore(record), record.outcome.state);
    }
  }

  const report: DashboardExecutionContextRoutingReport = {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    scope: options.scope,
    totals: {
      recordedOutcomes: measuredMetric("Recorded routing outcomes", records.length, "count", records.length),
      successfulOutcomes: measuredMetric("Successful outcomes", success, "count", records.length),
      partialOutcomes: measuredMetric("Partial outcomes", partial, "count", records.length),
      failedOutcomes: measuredMetric("Failed outcomes", failed, "count", records.length),
      successRate: measuredMetric("Routing success rate", ratio(success, records.length), "ratio", records.length),
      skippedToolMentions: measuredMetric("Skipped tool mentions", skippedToolMentions, "count", records.length),
      averageLatencyMs: measuredMetric("Average routing latency", average(latencyMs, latencySamples), "milliseconds", latencySamples),
      averageToolCalls: measuredMetric("Average tool calls", average(toolCalls, toolCallSamples), "count", toolCallSamples),
      observedInputTokens: measuredMetric("Observed input tokens", inputTokens, "tokens", records.length),
      observedOutputTokens: measuredMetric("Observed output tokens", outputTokens, "tokens", records.length),
      failedPathInputTokens: measuredMetric("Failed-path input tokens", failedPathInputTokens, "tokens", failed),
      lowConfidenceRatio: measuredMetric("Low-confidence outcome ratio", ratio(lowConfidence, records.length), "ratio", records.length),
    },
    topUsefulTools: rankRouteValues(usefulTools, "tool", "Useful tool outcomes", maxInsights),
    topNoisyTools: rankRouteValues(noisyTools, "tool", "Avoided/noisy tool outcomes", maxInsights),
    topUsefulSkills: rankRouteValues(usefulSkills, "skill", "Useful skill outcomes", maxInsights),
    warnings: records.length === 0
      ? [
          {
            code: "routing.no_outcomes",
            message: "No execution-context outcomes have been recorded for this dashboard scope yet.",
            severity: "info",
          },
        ]
      : failed > success
      ? [
          {
            code: "routing.failure_rate_high",
            message: "Failed execution-context outcomes exceed successful outcomes in the selected window.",
            severity: "warning",
          },
        ]
      : [],
  };

  assertDashboardExecutionContextRoutingReport(report);
  assertDashboardSnapshotPrivacy(report as unknown as Parameters<typeof assertDashboardSnapshotPrivacy>[0]);
  return report;
}

function scoreOutcome(record: ExecutionContextRecord): number {
  const base = record.outcome.state === "success"
    ? 4
    : record.outcome.state === "partial"
    ? 2
    : record.outcome.state === "failed"
    ? 0
    : 1;
  const confidence = record.confidence === "high" ? 2 : record.confidence === "medium" ? 1 : 0;
  return base + confidence;
}

function skippedToolScore(record: ExecutionContextRecord): number {
  const base = record.outcome.state === "success"
    ? 4
    : record.outcome.state === "partial"
    ? 2
    : record.outcome.state === "failed"
    ? 1
    : 1;
  return base + (record.confidence === "high" ? 1 : 0);
}

function addWeighted(
  target: Map<string, WeightedRouteValue>,
  id: string,
  score: number,
  outcomeState: ExecutionContextRecord["outcome"]["state"],
): void {
  if (score <= 0) {
    return;
  }
  const current = target.get(id) ?? {
    id,
    score: 0,
    count: 0,
    failedCount: 0,
  };
  current.score += score;
  current.count += 1;
  if (outcomeState === "failed") {
    current.failedCount += 1;
  }
  target.set(id, current);
}

function rankRouteValues(
  values: Map<string, WeightedRouteValue>,
  category: "tool" | "skill",
  metricLabel: string,
  maxInsights: number,
): ExecutiveDashboardRankedItem[] {
  return [...values.values()]
    .sort((left, right) => right.score - left.score || right.count - left.count || left.id.localeCompare(right.id))
    .slice(0, maxInsights)
    .map((entry) => ({
      key: `${category}:${entry.id}`,
      label: entry.id,
      category,
      metric: measuredMetric(metricLabel, entry.score, "count", entry.count),
      secondaryMetric: measuredMetric("Observed outcomes", entry.count, "count", entry.count),
      notes: [
        `Observed in ${entry.count} execution-context outcome(s).`,
        entry.failedCount > 0 ? `${entry.failedCount} failed outcome(s) included.` : "No failed outcomes included for this item.",
      ],
    }));
}

function measuredMetric(
  label: string,
  value: number,
  unit: DashboardMetric<number>["unit"],
  sampleSize: number,
): DashboardMetric<number> {
  return {
    label,
    value,
    unit,
    confidence: "measured",
    provenance: {
      source: "metrics_store",
      collectedAt: new Date().toISOString(),
      estimateBasis: undefined,
      notes: [
        `Computed from ${sampleSize} execution-context outcome record(s).`,
        "Execution-context telemetry stores fingerprints and routing metadata only, not raw task text.",
      ],
    },
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function average(total: number, samples: number): number {
  if (samples <= 0) {
    return 0;
  }
  return Math.round((total / samples) * 100) / 100;
}
