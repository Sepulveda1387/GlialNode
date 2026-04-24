import { ValidationError } from "../core/errors.js";
import { createId } from "../core/ids.js";

export type TokenUsageGranularity = "day" | "week" | "month" | "all";

export type TokenUsageDimensionValue = string | number | boolean | null;

export interface TokenUsageDimensions {
  readonly [key: string]: TokenUsageDimensionValue;
}

export interface TokenCostModel {
  readonly currency: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputCostPerMillionTokens: number;
  readonly outputCostPerMillionTokens: number;
}

export interface RecordTokenUsageInput {
  readonly spaceId?: string;
  readonly scopeId?: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly workflowId?: string;
  readonly operation: string;
  readonly provider?: string;
  readonly model: string;
  readonly baselineTokens?: number;
  readonly actualContextTokens?: number;
  readonly glialnodeOverheadTokens?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedSavedTokens?: number;
  readonly estimatedSavedRatio?: number;
  readonly latencyMs?: number;
  readonly costCurrency?: string;
  readonly inputCost?: number;
  readonly outputCost?: number;
  readonly totalCost?: number;
  readonly dimensions?: TokenUsageDimensions;
  readonly createdAt?: string;
}

export interface TokenUsageRecord extends Required<Pick<RecordTokenUsageInput,
  "operation" | "model" | "inputTokens" | "outputTokens"
>> {
  readonly id: string;
  readonly spaceId?: string;
  readonly scopeId?: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly workflowId?: string;
  readonly provider?: string;
  readonly baselineTokens?: number;
  readonly actualContextTokens?: number;
  readonly glialnodeOverheadTokens?: number;
  readonly estimatedSavedTokens?: number;
  readonly estimatedSavedRatio?: number;
  readonly latencyMs?: number;
  readonly costCurrency?: string;
  readonly inputCost?: number;
  readonly outputCost?: number;
  readonly totalCost?: number;
  readonly dimensions?: TokenUsageDimensions;
  readonly createdAt: string;
}

export interface TokenUsageFilters {
  readonly spaceId?: string;
  readonly scopeId?: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly workflowId?: string;
  readonly operation?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface TokenUsageReportOptions extends TokenUsageFilters {
  readonly granularity?: TokenUsageGranularity;
  readonly costModel?: TokenCostModel;
}

export interface TokenUsageTotals {
  readonly recordCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly baselineTokens: number;
  readonly actualContextTokens: number;
  readonly glialnodeOverheadTokens: number;
  readonly estimatedSavedTokens: number;
  readonly estimatedSavedRatio?: number;
  readonly latencyMs: number;
  readonly costBefore?: number;
  readonly costAfter?: number;
  readonly costSaved?: number;
  readonly recordedCost?: number;
}

export interface TokenUsageReportBucket {
  readonly key: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly totals: TokenUsageTotals;
}

export interface TokenUsageReport {
  readonly schemaVersion: "1.0.0";
  readonly generatedAt: string;
  readonly granularity: TokenUsageGranularity;
  readonly filters: TokenUsageFilters;
  readonly costModel?: TokenCostModel;
  readonly totals: TokenUsageTotals;
  readonly buckets: readonly TokenUsageReportBucket[];
}

export interface MetricsRepository {
  recordTokenUsage(input: RecordTokenUsageInput): Promise<TokenUsageRecord>;
  listTokenUsage(filters?: TokenUsageFilters): Promise<TokenUsageRecord[]>;
  getTokenUsageReport(options?: TokenUsageReportOptions): Promise<TokenUsageReport>;
}

const FORBIDDEN_TOKEN_USAGE_KEYS = new Set([
  "apiKey",
  "completion",
  "completionText",
  "content",
  "memoryContent",
  "memoryText",
  "messages",
  "prompt",
  "promptText",
  "raw",
  "rawText",
  "requestBody",
  "responseBody",
  "secret",
  "secretValue",
]);

export function createTokenUsageRecord(input: RecordTokenUsageInput): TokenUsageRecord {
  assertTokenUsageInput(input);

  const glialnodeOverheadTokens = input.glialnodeOverheadTokens ?? 0;
  const estimatedSavedTokens = input.estimatedSavedTokens ?? deriveEstimatedSavedTokens(input, glialnodeOverheadTokens);
  const estimatedSavedRatio = input.estimatedSavedRatio ?? deriveEstimatedSavedRatio(input.baselineTokens, estimatedSavedTokens);

  return omitUndefined({
    id: createId("metric"),
    spaceId: input.spaceId,
    scopeId: input.scopeId,
    agentId: input.agentId,
    projectId: input.projectId,
    workflowId: input.workflowId,
    operation: input.operation.trim(),
    provider: input.provider?.trim(),
    model: input.model.trim(),
    baselineTokens: input.baselineTokens,
    actualContextTokens: input.actualContextTokens,
    glialnodeOverheadTokens,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens,
    estimatedSavedRatio,
    latencyMs: input.latencyMs,
    costCurrency: input.costCurrency?.trim().toUpperCase(),
    inputCost: input.inputCost,
    outputCost: input.outputCost,
    totalCost: input.totalCost,
    dimensions: input.dimensions,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

export function assertTokenUsageInput(input: RecordTokenUsageInput): void {
  assertNoForbiddenTokenUsagePayload(input);

  if (input.operation.trim().length === 0) {
    throw new ValidationError("Token usage operation is required.");
  }
  if (input.model.trim().length === 0) {
    throw new ValidationError("Token usage model is required.");
  }

  for (const [field, value] of Object.entries({
    baselineTokens: input.baselineTokens,
    actualContextTokens: input.actualContextTokens,
    glialnodeOverheadTokens: input.glialnodeOverheadTokens,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens: input.estimatedSavedTokens,
  })) {
    if (value !== undefined) {
      assertNonNegativeInteger(value, field);
    }
  }

  for (const [field, value] of Object.entries({
    latencyMs: input.latencyMs,
    inputCost: input.inputCost,
    outputCost: input.outputCost,
    totalCost: input.totalCost,
  })) {
    if (value !== undefined) {
      assertNonNegativeNumber(value, field);
    }
  }

  if (input.estimatedSavedRatio !== undefined && (input.estimatedSavedRatio < 0 || input.estimatedSavedRatio > 1)) {
    throw new ValidationError("Token usage estimatedSavedRatio must be between 0 and 1.");
  }

  if (input.baselineTokens !== undefined && input.estimatedSavedTokens !== undefined && input.estimatedSavedTokens > input.baselineTokens) {
    throw new ValidationError("Token usage estimatedSavedTokens cannot exceed baselineTokens.");
  }

  if (input.createdAt !== undefined && Number.isNaN(Date.parse(input.createdAt))) {
    throw new ValidationError("Token usage createdAt must be an ISO-compatible timestamp.");
  }

  if (input.dimensions !== undefined) {
    validateDimensions(input.dimensions);
  }
}

export function buildTokenUsageReport(
  records: readonly TokenUsageRecord[],
  options: TokenUsageReportOptions = {},
): TokenUsageReport {
  const granularity = options.granularity ?? "day";
  const filtered = filterTokenUsageRecords(records, options);
  const buckets = groupTokenUsageRecords(filtered, granularity, options.costModel);

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    granularity,
    filters: omitUndefined({
      spaceId: options.spaceId,
      scopeId: options.scopeId,
      agentId: options.agentId,
      projectId: options.projectId,
      workflowId: options.workflowId,
      operation: options.operation,
      provider: options.provider,
      model: options.model,
      from: options.from,
      to: options.to,
      limit: options.limit,
    }),
    costModel: options.costModel,
    totals: summarizeTokenUsage(filtered, options.costModel),
    buckets,
  };
}

export function assertTokenCostModel(costModel: TokenCostModel): void {
  if (costModel.currency.trim().length === 0) {
    throw new ValidationError("Token cost model currency is required.");
  }
  assertNonNegativeNumber(costModel.inputCostPerMillionTokens, "inputCostPerMillionTokens");
  assertNonNegativeNumber(costModel.outputCostPerMillionTokens, "outputCostPerMillionTokens");
}

function filterTokenUsageRecords(
  records: readonly TokenUsageRecord[],
  filters: TokenUsageFilters,
): TokenUsageRecord[] {
  const fromTime = filters.from ? Date.parse(filters.from) : undefined;
  const toTime = filters.to ? Date.parse(filters.to) : undefined;

  if (fromTime !== undefined && Number.isNaN(fromTime)) {
    throw new ValidationError("Token usage report from must be an ISO-compatible timestamp.");
  }
  if (toTime !== undefined && Number.isNaN(toTime)) {
    throw new ValidationError("Token usage report to must be an ISO-compatible timestamp.");
  }

  const filtered = records.filter((record) => {
    if (filters.spaceId && record.spaceId !== filters.spaceId) return false;
    if (filters.scopeId && record.scopeId !== filters.scopeId) return false;
    if (filters.agentId && record.agentId !== filters.agentId) return false;
    if (filters.projectId && record.projectId !== filters.projectId) return false;
    if (filters.workflowId && record.workflowId !== filters.workflowId) return false;
    if (filters.operation && record.operation !== filters.operation) return false;
    if (filters.provider && record.provider !== filters.provider) return false;
    if (filters.model && record.model !== filters.model) return false;

    const createdAt = Date.parse(record.createdAt);
    if (fromTime !== undefined && createdAt < fromTime) return false;
    if (toTime !== undefined && createdAt > toTime) return false;
    return true;
  });

  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}

function groupTokenUsageRecords(
  records: readonly TokenUsageRecord[],
  granularity: TokenUsageGranularity,
  costModel?: TokenCostModel,
): TokenUsageReportBucket[] {
  if (costModel) {
    assertTokenCostModel(costModel);
  }

  if (granularity === "all") {
    return [
      {
        key: "all",
        totals: summarizeTokenUsage(records, costModel),
      },
    ];
  }

  const grouped = new Map<string, TokenUsageRecord[]>();
  for (const record of records) {
    const key = getBucketKey(record.createdAt, granularity);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bucketRecords]) => ({
      key,
      totals: summarizeTokenUsage(bucketRecords, costModel),
    }));
}

function summarizeTokenUsage(
  records: readonly TokenUsageRecord[],
  costModel?: TokenCostModel,
): TokenUsageTotals {
  let costBefore = 0;
  let costAfter = 0;
  let costSaved = 0;
  let hasDerivedCost = false;

  const totals = records.reduce(
    (accumulator, record) => {
      accumulator.recordCount += 1;
      accumulator.inputTokens += record.inputTokens;
      accumulator.outputTokens += record.outputTokens;
      accumulator.baselineTokens += record.baselineTokens ?? 0;
      accumulator.actualContextTokens += record.actualContextTokens ?? 0;
      accumulator.glialnodeOverheadTokens += record.glialnodeOverheadTokens ?? 0;
      accumulator.estimatedSavedTokens += record.estimatedSavedTokens ?? 0;
      accumulator.latencyMs += record.latencyMs ?? 0;
      accumulator.recordedCost += record.totalCost ?? 0;

      if (costModel && record.baselineTokens !== undefined) {
        const before = calculateTokenCost(record.baselineTokens, record.outputTokens, costModel);
        const after = calculateTokenCost(record.inputTokens, record.outputTokens, costModel);
        costBefore += before;
        costAfter += after;
        costSaved += Math.max(0, before - after);
        hasDerivedCost = true;
      }

      return accumulator;
    },
    {
      recordCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      baselineTokens: 0,
      actualContextTokens: 0,
      glialnodeOverheadTokens: 0,
      estimatedSavedTokens: 0,
      latencyMs: 0,
      recordedCost: 0,
    },
  );

  return omitUndefined({
    ...totals,
    estimatedSavedRatio: totals.baselineTokens > 0 ? totals.estimatedSavedTokens / totals.baselineTokens : undefined,
    costBefore: hasDerivedCost ? roundCurrency(costBefore) : undefined,
    costAfter: hasDerivedCost ? roundCurrency(costAfter) : undefined,
    costSaved: hasDerivedCost ? roundCurrency(costSaved) : undefined,
    recordedCost: totals.recordedCost > 0 ? roundCurrency(totals.recordedCost) : undefined,
  });
}

function calculateTokenCost(inputTokens: number, outputTokens: number, costModel: TokenCostModel): number {
  assertTokenCostModel(costModel);
  return (inputTokens * costModel.inputCostPerMillionTokens + outputTokens * costModel.outputCostPerMillionTokens) / 1_000_000;
}

function getBucketKey(createdAt: string, granularity: Exclude<TokenUsageGranularity, "all">): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("Token usage createdAt must be an ISO-compatible timestamp.");
  }

  if (granularity === "month") {
    return date.toISOString().slice(0, 7);
  }

  if (granularity === "week") {
    return getIsoWeekKey(date);
  }

  return date.toISOString().slice(0, 10);
}

function getIsoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function deriveEstimatedSavedTokens(
  input: RecordTokenUsageInput,
  glialnodeOverheadTokens: number,
): number | undefined {
  if (input.baselineTokens === undefined || input.actualContextTokens === undefined) {
    return undefined;
  }

  return Math.max(0, input.baselineTokens - input.actualContextTokens - glialnodeOverheadTokens);
}

function deriveEstimatedSavedRatio(
  baselineTokens: number | undefined,
  estimatedSavedTokens: number | undefined,
): number | undefined {
  if (!baselineTokens || estimatedSavedTokens === undefined) {
    return undefined;
  }

  return estimatedSavedTokens / baselineTokens;
}

function validateDimensions(dimensions: TokenUsageDimensions): void {
  for (const [key, value] of Object.entries(dimensions)) {
    if (key.trim().length === 0) {
      throw new ValidationError("Token usage dimension keys cannot be empty.");
    }
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
      throw new ValidationError(`Token usage dimension '${key}' must be a string, number, boolean, or null.`);
    }
  }
}

function assertNoForbiddenTokenUsagePayload(value: unknown, path = "tokenUsage"): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenTokenUsagePayload(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_TOKEN_USAGE_KEYS.has(key)) {
      throw new ValidationError(`Token usage payload contains forbidden raw-text field '${path}.${key}'.`);
    }
    assertNoForbiddenTokenUsagePayload(entry, `${path}.${key}`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Token usage ${field} must be a non-negative integer.`);
  }
}

function assertNonNegativeNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`Token usage ${field} must be a non-negative finite number.`);
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
