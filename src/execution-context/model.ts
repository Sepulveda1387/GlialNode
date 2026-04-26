import { createHash } from "node:crypto";

import { ValidationError } from "../core/errors.js";
import { createId } from "../core/ids.js";

export const EXECUTION_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;

export type ExecutionContextSchemaVersion = typeof EXECUTION_CONTEXT_SCHEMA_VERSION;
export type ExecutionContextOutcomeState = "success" | "partial" | "failed" | "unknown";
export type ExecutionContextConfidence = "low" | "medium" | "high";
export type ExecutionContextFingerprintMethod = "sha256_normalized_task_v1";

export interface ExecutionContextScope {
  readonly repoId?: string;
  readonly projectId?: string;
  readonly workflowId?: string;
  readonly agentId?: string;
}

export interface ExecutionContextTaskFingerprint {
  readonly method: ExecutionContextFingerprintMethod;
  readonly hash: string;
  readonly featureCount: number;
}

export interface CreateExecutionContextTaskFingerprintInput {
  readonly taskText: string;
  readonly scope?: ExecutionContextScope;
  readonly features?: readonly string[];
}

export interface ExecutionContextOutcome {
  readonly state: ExecutionContextOutcomeState;
  readonly latencyMs?: number;
  readonly toolCallCount?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly notes?: readonly string[];
}

export interface ExecutionContextRecord {
  readonly schemaVersion: ExecutionContextSchemaVersion;
  readonly id: string;
  readonly taskFingerprint: ExecutionContextTaskFingerprint;
  readonly scope?: ExecutionContextScope;
  readonly selectedSkills: readonly string[];
  readonly selectedTools: readonly string[];
  readonly skippedTools: readonly string[];
  readonly firstReads: readonly string[];
  readonly outcome: ExecutionContextOutcome;
  readonly confidence: ExecutionContextConfidence;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateExecutionContextRecordInput {
  readonly taskFingerprint: ExecutionContextTaskFingerprint;
  readonly scope?: ExecutionContextScope;
  readonly selectedSkills?: readonly string[];
  readonly selectedTools?: readonly string[];
  readonly skippedTools?: readonly string[];
  readonly firstReads?: readonly string[];
  readonly outcome?: Partial<ExecutionContextOutcome>;
  readonly confidence?: ExecutionContextConfidence;
  readonly createdAt?: string;
  readonly retentionDays?: number;
}

const DEFAULT_EXECUTION_CONTEXT_RETENTION_DAYS = 30;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_NOTES = 8;
const MAX_NOTE_LENGTH = 180;
const MAX_FEATURES = 20;
const MAX_FEATURE_LENGTH = 80;

const FORBIDDEN_EXECUTION_CONTEXT_KEYS = new Set([
  "apiKey",
  "commandOutput",
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
  "taskText",
]);

export function createExecutionContextTaskFingerprint(
  input: CreateExecutionContextTaskFingerprintInput,
): ExecutionContextTaskFingerprint {
  if (!input.taskText.trim()) {
    throw new ValidationError("Execution context taskText is required for fingerprinting.");
  }

  const features = [...new Set((input.features ?? []).map(normalizeFeature).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_FEATURES);
  const normalizedPayload = JSON.stringify({
    task: normalizeTaskText(input.taskText),
    scope: normalizeScope(input.scope),
    features,
  });

  return {
    method: "sha256_normalized_task_v1",
    hash: createHash("sha256").update(normalizedPayload).digest("hex"),
    featureCount: features.length,
  };
}

export function createExecutionContextRecord(input: CreateExecutionContextRecordInput): ExecutionContextRecord {
  assertNoForbiddenExecutionContextFields(input);
  assertExecutionContextFingerprint(input.taskFingerprint);
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertIsoTimestamp(createdAt, "createdAt");
  const retentionDays = input.retentionDays ?? DEFAULT_EXECUTION_CONTEXT_RETENTION_DAYS;
  assertNonNegativeFiniteNumber(retentionDays, "retentionDays");

  const record: ExecutionContextRecord = {
    schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
    id: createId("ectx"),
    taskFingerprint: input.taskFingerprint,
    scope: input.scope ? normalizeScope(input.scope) : undefined,
    selectedSkills: normalizeIdentifiers(input.selectedSkills ?? [], "selectedSkills"),
    selectedTools: normalizeIdentifiers(input.selectedTools ?? [], "selectedTools"),
    skippedTools: normalizeIdentifiers(input.skippedTools ?? [], "skippedTools"),
    firstReads: normalizeIdentifiers(input.firstReads ?? [], "firstReads"),
    outcome: normalizeOutcome(input.outcome ?? {}),
    confidence: input.confidence ?? "medium",
    createdAt,
    expiresAt: addDays(createdAt, retentionDays),
  };

  assertExecutionContextRecord(record);
  return record;
}

export function assertExecutionContextRecord(record: ExecutionContextRecord): void {
  assertNoForbiddenExecutionContextFields(record);

  if (record.schemaVersion !== EXECUTION_CONTEXT_SCHEMA_VERSION) {
    throw new ValidationError(`Unsupported execution context schema version: ${record.schemaVersion}.`);
  }

  if (!record.id.trim()) {
    throw new ValidationError("Execution context record id is required.");
  }

  assertExecutionContextFingerprint(record.taskFingerprint);
  validateScope(record.scope);
  normalizeIdentifiers(record.selectedSkills, "selectedSkills");
  normalizeIdentifiers(record.selectedTools, "selectedTools");
  normalizeIdentifiers(record.skippedTools, "skippedTools");
  normalizeIdentifiers(record.firstReads, "firstReads");
  normalizeOutcome(record.outcome);
  assertIsoTimestamp(record.createdAt, "createdAt");
  assertIsoTimestamp(record.expiresAt, "expiresAt");

  if (!["low", "medium", "high"].includes(record.confidence)) {
    throw new ValidationError("Execution context confidence must be low, medium, or high.");
  }
}

export function assertExecutionContextFingerprint(fingerprint: ExecutionContextTaskFingerprint): void {
  if (fingerprint.method !== "sha256_normalized_task_v1") {
    throw new ValidationError(`Unsupported execution context fingerprint method: ${fingerprint.method}.`);
  }

  if (!/^[a-f0-9]{64}$/.test(fingerprint.hash)) {
    throw new ValidationError("Execution context fingerprint hash must be a lowercase sha256 hex digest.");
  }

  if (!Number.isInteger(fingerprint.featureCount) || fingerprint.featureCount < 0 || fingerprint.featureCount > MAX_FEATURES) {
    throw new ValidationError(`Execution context fingerprint featureCount must be between 0 and ${MAX_FEATURES}.`);
  }
}

export function assertNoForbiddenExecutionContextFields(value: unknown, path = "executionContext"): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenExecutionContextFields(entry, `${path}[${index}]`));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_EXECUTION_CONTEXT_KEYS.has(key)) {
      throw new ValidationError(`Execution context payload contains forbidden raw field '${path}.${key}'.`);
    }
    assertNoForbiddenExecutionContextFields(entry, `${path}.${key}`);
  }
}

function normalizeTaskText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function normalizeFeature(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.length > MAX_FEATURE_LENGTH) {
    throw new ValidationError(`Execution context feature exceeds ${MAX_FEATURE_LENGTH} characters.`);
  }
  return normalized;
}

function normalizeScope(scope: ExecutionContextScope | undefined): ExecutionContextScope | undefined {
  if (!scope) {
    return undefined;
  }

  const normalized: ExecutionContextScope = {
    repoId: normalizeOptionalIdentifier(scope.repoId, "scope.repoId"),
    projectId: normalizeOptionalIdentifier(scope.projectId, "scope.projectId"),
    workflowId: normalizeOptionalIdentifier(scope.workflowId, "scope.workflowId"),
    agentId: normalizeOptionalIdentifier(scope.agentId, "scope.agentId"),
  };

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined),
  ) as ExecutionContextScope;
}

function validateScope(scope: ExecutionContextScope | undefined): void {
  normalizeScope(scope);
}

function normalizeOutcome(outcome: Partial<ExecutionContextOutcome>): ExecutionContextOutcome {
  const normalized: ExecutionContextOutcome = {
    state: outcome.state ?? "unknown",
    latencyMs: outcome.latencyMs,
    toolCallCount: outcome.toolCallCount,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    notes: normalizeNotes(outcome.notes ?? []),
  };

  if (!["success", "partial", "failed", "unknown"].includes(normalized.state)) {
    throw new ValidationError("Execution context outcome state must be success, partial, failed, or unknown.");
  }

  if (normalized.latencyMs !== undefined) {
    assertNonNegativeFiniteNumber(normalized.latencyMs, "outcome.latencyMs");
  }
  if (normalized.toolCallCount !== undefined) {
    assertNonNegativeInteger(normalized.toolCallCount, "outcome.toolCallCount");
  }
  if (normalized.inputTokens !== undefined) {
    assertNonNegativeInteger(normalized.inputTokens, "outcome.inputTokens");
  }
  if (normalized.outputTokens !== undefined) {
    assertNonNegativeInteger(normalized.outputTokens, "outcome.outputTokens");
  }

  return normalized;
}

function normalizeIdentifiers(values: readonly string[], field: string): string[] {
  return [...new Set(values.map((value) => normalizeRequiredIdentifier(value, field)))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeNotes(values: readonly string[]): string[] {
  if (values.length > MAX_NOTES) {
    throw new ValidationError(`Execution context outcome notes cannot exceed ${MAX_NOTES} entries.`);
  }

  return values.map((note) => {
    const normalized = note.trim().replace(/\s+/g, " ");
    if (normalized.length > MAX_NOTE_LENGTH) {
      throw new ValidationError(`Execution context outcome note exceeds ${MAX_NOTE_LENGTH} characters.`);
    }
    return normalized;
  }).filter(Boolean);
}

function normalizeOptionalIdentifier(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeRequiredIdentifier(value, field);
}

function normalizeRequiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError(`Execution context ${field} cannot be empty.`);
  }
  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new ValidationError(`Execution context ${field} exceeds ${MAX_IDENTIFIER_LENGTH} characters.`);
  }
  if (/[\r\n\t]/.test(normalized)) {
    throw new ValidationError(`Execution context ${field} cannot contain control whitespace.`);
  }
  return normalized;
}

function assertIsoTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Execution context ${field} must be an ISO-compatible timestamp.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Execution context ${field} must be a non-negative integer.`);
  }
}

function assertNonNegativeFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`Execution context ${field} must be a non-negative finite number.`);
  }
}

function addDays(isoTimestamp: string, days: number): string {
  const timestamp = Date.parse(isoTimestamp) + days * 24 * 60 * 60 * 1_000;
  return new Date(timestamp).toISOString();
}
