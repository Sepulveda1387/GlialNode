import type { MemoryRecord } from "../core/types.js";
import type { TokenUsageRecord, TokenUsageReportOptions } from "../metrics/repository.js";
import { DASHBOARD_SNAPSHOT_SCHEMA_VERSION } from "./schema.js";

export interface DashboardRecallQualityOptions {
  readonly tokenUsage?: TokenUsageReportOptions;
  readonly maxTopRecalled?: number;
  readonly maxNeverRecalled?: number;
}

export interface DashboardRecallQualityReport {
  readonly schemaVersion: typeof DASHBOARD_SNAPSHOT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly filters: {
    readonly spaceId?: string;
    readonly agentId?: string;
    readonly projectId?: string;
    readonly workflowId?: string;
    readonly from?: string;
    readonly to?: string;
  };
  readonly totals: {
    readonly recallRequests: number;
    readonly bundleRequests: number;
    readonly traceRequests: number;
    readonly measuredLatencyRequests: number;
    readonly averageLatencyMs?: number;
    readonly p50LatencyMs?: number;
    readonly p95LatencyMs?: number;
    readonly baselineTokens: number;
    readonly actualContextTokens: number;
    readonly glialnodeOverheadTokens: number;
    readonly estimatedSavedTokens: number;
    readonly compactVsFullUsageRatio?: number;
  };
  readonly topRecalled: readonly DashboardRecalledRecordMetric[];
  readonly neverRecalledCandidates: readonly DashboardNeverRecalledCandidate[];
  readonly notes: readonly string[];
}

export interface DashboardRecalledRecordMetric {
  readonly recordId: string;
  readonly count: number;
  readonly roles: readonly ("primary" | "supporting")[];
}

export interface DashboardNeverRecalledCandidate {
  readonly recordId: string;
  readonly tier: MemoryRecord["tier"];
  readonly kind: MemoryRecord["kind"];
  readonly status: MemoryRecord["status"];
  readonly importance: number;
  readonly confidence: number;
  readonly freshness: number;
}

export function buildDashboardRecallQualityReport(
  records: readonly MemoryRecord[],
  tokenUsageRecords: readonly TokenUsageRecord[],
  options: DashboardRecallQualityOptions = {},
): DashboardRecallQualityReport {
  const filteredUsage = filterRecallUsage(tokenUsageRecords, options.tokenUsage);
  const recallRecords = filteredUsage.filter((record) => isRecallOperation(record.operation));
  const bundleRecords = filteredUsage.filter((record) => isBundleOperation(record.operation));
  const traceRecords = filteredUsage.filter((record) => isTraceOperation(record.operation));
  const latencies = filteredUsage
    .map((record) => record.latencyMs)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  const recalledCounts = countRecalledRecords(filteredUsage);
  const maxTopRecalled = Math.max(0, options.maxTopRecalled ?? 10);
  const maxNeverRecalled = Math.max(0, options.maxNeverRecalled ?? 10);

  const baselineTokens = sum(filteredUsage.map((record) => record.baselineTokens));
  const actualContextTokens = sum(filteredUsage.map((record) => record.actualContextTokens));
  const glialnodeOverheadTokens = sum(filteredUsage.map((record) => record.glialnodeOverheadTokens));
  const estimatedSavedTokens = sum(filteredUsage.map((record) => record.estimatedSavedTokens));

  return {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    filters: {
      spaceId: options.tokenUsage?.spaceId,
      agentId: options.tokenUsage?.agentId,
      projectId: options.tokenUsage?.projectId,
      workflowId: options.tokenUsage?.workflowId,
      from: options.tokenUsage?.from,
      to: options.tokenUsage?.to,
    },
    totals: {
      recallRequests: recallRecords.length,
      bundleRequests: bundleRecords.length,
      traceRequests: traceRecords.length,
      measuredLatencyRequests: latencies.length,
      averageLatencyMs: latencies.length > 0 ? roundMetric(sum(latencies) / latencies.length) : undefined,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      baselineTokens,
      actualContextTokens,
      glialnodeOverheadTokens,
      estimatedSavedTokens,
      compactVsFullUsageRatio: baselineTokens > 0 ? roundMetric((actualContextTokens + glialnodeOverheadTokens) / baselineTokens) : undefined,
    },
    topRecalled: [...recalledCounts.values()]
      .sort((left, right) => right.count - left.count || left.recordId.localeCompare(right.recordId))
      .slice(0, maxTopRecalled),
    neverRecalledCandidates: records
      .filter((record) => record.status === "active" && !recalledCounts.has(record.id))
      .sort((left, right) =>
        (right.importance + right.confidence + right.freshness) -
        (left.importance + left.confidence + left.freshness),
      )
      .slice(0, maxNeverRecalled)
      .map((record) => ({
        recordId: record.id,
        tier: record.tier,
        kind: record.kind,
        status: record.status,
        importance: record.importance,
        confidence: record.confidence,
        freshness: record.freshness,
      })),
    notes: [
      "Recall quality report uses metrics-only telemetry and record IDs; it does not expose raw memory content.",
      "Top recalled records require host apps to provide primaryRecordId/supportingRecordIds in token usage dimensions.",
      "Latency percentiles are computed only from records that include latencyMs.",
    ],
  };
}

function filterRecallUsage(
  records: readonly TokenUsageRecord[],
  filters: TokenUsageReportOptions | undefined,
): TokenUsageRecord[] {
  const fromTime = filters?.from ? Date.parse(filters.from) : undefined;
  const toTime = filters?.to ? Date.parse(filters.to) : undefined;

  return records.filter((record) => {
    if (!isRetrievalOperation(record.operation)) return false;
    if (filters?.spaceId && record.spaceId !== filters.spaceId) return false;
    if (filters?.scopeId && record.scopeId !== filters.scopeId) return false;
    if (filters?.agentId && record.agentId !== filters.agentId) return false;
    if (filters?.projectId && record.projectId !== filters.projectId) return false;
    if (filters?.workflowId && record.workflowId !== filters.workflowId) return false;
    if (filters?.provider && record.provider !== filters.provider) return false;
    if (filters?.model && record.model !== filters.model) return false;
    if (filters?.operation && record.operation !== filters.operation) return false;

    const createdAt = Date.parse(record.createdAt);
    if (fromTime !== undefined && createdAt < fromTime) return false;
    if (toTime !== undefined && createdAt > toTime) return false;
    return true;
  });
}

function countRecalledRecords(records: readonly TokenUsageRecord[]): Map<string, DashboardRecalledRecordMetric> {
  const counts = new Map<string, { recordId: string; count: number; roles: Set<"primary" | "supporting"> }>();

  for (const record of records) {
    const primaryRecordId = stringDimension(record, "primaryRecordId");
    if (primaryRecordId) {
      incrementRecalledRecord(counts, primaryRecordId, "primary");
    }

    for (const supportingRecordId of stringArrayDimension(record, "supportingRecordIds")) {
      incrementRecalledRecord(counts, supportingRecordId, "supporting");
    }
  }

  return new Map(
    [...counts.entries()].map(([recordId, entry]) => [
      recordId,
      {
        recordId,
        count: entry.count,
        roles: [...entry.roles].sort(),
      },
    ]),
  );
}

function incrementRecalledRecord(
  counts: Map<string, { recordId: string; count: number; roles: Set<"primary" | "supporting"> }>,
  recordId: string,
  role: "primary" | "supporting",
): void {
  const existing = counts.get(recordId) ?? {
    recordId,
    count: 0,
    roles: new Set<"primary" | "supporting">(),
  };
  existing.count += 1;
  existing.roles.add(role);
  counts.set(recordId, existing);
}

function stringDimension(record: TokenUsageRecord, key: string): string | undefined {
  const value = record.dimensions?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayDimension(record: TokenUsageRecord, key: string): string[] {
  const value = record.dimensions?.[key];
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isRetrievalOperation(operation: string): boolean {
  return isRecallOperation(operation) || isBundleOperation(operation) || isTraceOperation(operation);
}

function isRecallOperation(operation: string): boolean {
  return operation === "memory.recall" || operation.endsWith(".recall");
}

function isBundleOperation(operation: string): boolean {
  return operation === "memory.bundle" || operation.endsWith(".bundle");
}

function isTraceOperation(operation: string): boolean {
  return operation === "memory.trace" || operation.endsWith(".trace");
}

function percentile(values: readonly number[], target: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * target) - 1));
  return roundMetric(values[index] ?? 0);
}

function sum(values: readonly (number | undefined)[]): number {
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
  }
  return total;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
