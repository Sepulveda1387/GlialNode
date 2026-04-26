import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  applySqliteConnectionPolicy,
  createSqliteDatabaseOptions,
  type SqliteConnectionPolicy,
  type SqliteRuntimeSettings,
} from "../storage/sqlite/connection.js";
import {
  applyMetricsSqliteMigrations,
  getMetricsSqliteSchemaVersion,
  listAppliedMetricsSqliteMigrations,
  type AppliedMetricsSqliteMigration,
} from "./migrations.js";
import {
  buildTokenUsageReport,
  createExecutionOutcomeRecord,
  createTokenUsageRecord,
  type ExecutionContextRecordFilters,
  type MetricsRepository,
  type RecordExecutionOutcomeInput,
  type RecordTokenUsageInput,
  type TokenUsageFilters,
  type TokenUsageRecord,
  type TokenUsageReport,
  type TokenUsageReportOptions,
} from "./repository.js";
import type { ExecutionContextRecord } from "../execution-context/index.js";

export interface SqliteMetricsRepositoryOptions {
  filename?: string;
  bootstrap?: boolean;
  connection?: Partial<SqliteConnectionPolicy>;
}

interface TokenUsageRow {
  id: string;
  space_id: string | null;
  scope_id: string | null;
  agent_id: string | null;
  project_id: string | null;
  workflow_id: string | null;
  operation: string;
  provider: string | null;
  model: string;
  baseline_tokens: number | null;
  actual_context_tokens: number | null;
  glialnode_overhead_tokens: number | null;
  input_tokens: number;
  output_tokens: number;
  estimated_saved_tokens: number | null;
  estimated_saved_ratio: number | null;
  latency_ms: number | null;
  cost_currency: string | null;
  input_cost: number | null;
  output_cost: number | null;
  total_cost: number | null;
  dimensions_json: string | null;
  created_at: string;
}

interface ExecutionContextRow {
  id: string;
  fingerprint_method: string;
  fingerprint_hash: string;
  fingerprint_feature_count: number;
  repo_id: string | null;
  project_id: string | null;
  workflow_id: string | null;
  agent_id: string | null;
  selected_skills_json: string;
  selected_tools_json: string;
  skipped_tools_json: string;
  first_reads_json: string;
  outcome_state: ExecutionContextRecord["outcome"]["state"];
  latency_ms: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  outcome_notes_json: string;
  confidence: ExecutionContextRecord["confidence"];
  created_at: string;
  expires_at: string;
}

export class SqliteMetricsRepository implements MetricsRepository {
  readonly db: DatabaseSync;
  readonly runtimeSettings: SqliteRuntimeSettings;
  private schemaVersion: number;

  constructor(options: SqliteMetricsRepositoryOptions = {}) {
    const filename = options.filename ?? ":memory:";
    if (filename !== ":memory:") {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }

    this.db = new DatabaseSync(filename, createSqliteDatabaseOptions(options.connection));
    this.runtimeSettings = applySqliteConnectionPolicy(this.db, options.connection);
    this.schemaVersion = getMetricsSqliteSchemaVersion(this.db);

    if (options.bootstrap ?? true) {
      this.bootstrap();
    }
  }

  bootstrap(): void {
    this.schemaVersion = applyMetricsSqliteMigrations(this.db);
  }

  async recordTokenUsage(input: RecordTokenUsageInput): Promise<TokenUsageRecord> {
    const record = createTokenUsageRecord(input);

    this.db.prepare(
      `
      INSERT INTO token_usage_records (
        id,
        space_id,
        scope_id,
        agent_id,
        project_id,
        workflow_id,
        operation,
        provider,
        model,
        baseline_tokens,
        actual_context_tokens,
        glialnode_overhead_tokens,
        input_tokens,
        output_tokens,
        estimated_saved_tokens,
        estimated_saved_ratio,
        latency_ms,
        cost_currency,
        input_cost,
        output_cost,
        total_cost,
        dimensions_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      record.id,
      record.spaceId ?? null,
      record.scopeId ?? null,
      record.agentId ?? null,
      record.projectId ?? null,
      record.workflowId ?? null,
      record.operation,
      record.provider ?? null,
      record.model,
      record.baselineTokens ?? null,
      record.actualContextTokens ?? null,
      record.glialnodeOverheadTokens ?? null,
      record.inputTokens,
      record.outputTokens,
      record.estimatedSavedTokens ?? null,
      record.estimatedSavedRatio ?? null,
      record.latencyMs ?? null,
      record.costCurrency ?? null,
      record.inputCost ?? null,
      record.outputCost ?? null,
      record.totalCost ?? null,
      serializeJson(record.dimensions),
      record.createdAt,
    );

    return record;
  }

  async listTokenUsage(filters: TokenUsageFilters = {}): Promise<TokenUsageRecord[]> {
    const { sql, values } = buildTokenUsageListQuery(filters);
    const rows = this.db.prepare(sql).all(...values) as unknown as TokenUsageRow[];
    return rows.map(mapTokenUsageRow);
  }

  async getTokenUsageReport(options: TokenUsageReportOptions = {}): Promise<TokenUsageReport> {
    const records = await this.listTokenUsage({
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
    });
    return buildTokenUsageReport(records, options);
  }

  async recordExecutionOutcome(input: RecordExecutionOutcomeInput): Promise<ExecutionContextRecord> {
    const record = createExecutionOutcomeRecord(input);

    this.db.prepare(
      `
      INSERT INTO execution_context_records (
        id,
        fingerprint_method,
        fingerprint_hash,
        fingerprint_feature_count,
        repo_id,
        project_id,
        workflow_id,
        agent_id,
        selected_skills_json,
        selected_tools_json,
        skipped_tools_json,
        first_reads_json,
        outcome_state,
        latency_ms,
        tool_call_count,
        input_tokens,
        output_tokens,
        outcome_notes_json,
        confidence,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      record.id,
      record.taskFingerprint.method,
      record.taskFingerprint.hash,
      record.taskFingerprint.featureCount,
      record.scope?.repoId ?? null,
      record.scope?.projectId ?? null,
      record.scope?.workflowId ?? null,
      record.scope?.agentId ?? null,
      JSON.stringify(record.selectedSkills),
      JSON.stringify(record.selectedTools),
      JSON.stringify(record.skippedTools),
      JSON.stringify(record.firstReads),
      record.outcome.state,
      record.outcome.latencyMs ?? null,
      record.outcome.toolCallCount ?? null,
      record.outcome.inputTokens ?? null,
      record.outcome.outputTokens ?? null,
      JSON.stringify(record.outcome.notes ?? []),
      record.confidence,
      record.createdAt,
      record.expiresAt,
    );

    return record;
  }

  async listExecutionContextRecords(
    filters: ExecutionContextRecordFilters = {},
  ): Promise<ExecutionContextRecord[]> {
    const { sql, values } = buildExecutionContextListQuery(filters);
    const rows = this.db.prepare(sql).all(...values) as unknown as ExecutionContextRow[];
    return rows.map(mapExecutionContextRow);
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  getRuntimeSettings(): SqliteRuntimeSettings {
    return this.runtimeSettings;
  }

  listAppliedMigrations(): AppliedMetricsSqliteMigration[] {
    return listAppliedMetricsSqliteMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }
}

export function resolveDefaultMetricsDatabasePath(memoryDatabasePath = ".glialnode/glialnode.sqlite"): string {
  if (memoryDatabasePath === ":memory:") {
    return resolve(".glialnode/glialnode.metrics.sqlite");
  }

  return join(dirname(resolve(memoryDatabasePath)), "glialnode.metrics.sqlite");
}

function buildTokenUsageListQuery(filters: TokenUsageFilters): { sql: string; values: Array<string | number> } {
  const where: string[] = [];
  const values: Array<string | number> = [];

  addFilter(where, values, "space_id", filters.spaceId);
  addFilter(where, values, "scope_id", filters.scopeId);
  addFilter(where, values, "agent_id", filters.agentId);
  addFilter(where, values, "project_id", filters.projectId);
  addFilter(where, values, "workflow_id", filters.workflowId);
  addFilter(where, values, "operation", filters.operation);
  addFilter(where, values, "provider", filters.provider);
  addFilter(where, values, "model", filters.model);

  if (filters.from) {
    where.push("created_at >= ?");
    values.push(filters.from);
  }
  if (filters.to) {
    where.push("created_at <= ?");
    values.push(filters.to);
  }

  const limit = filters.limit ?? 500;
  values.push(limit);

  return {
    sql: `
      SELECT *
      FROM token_usage_records
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    values,
  };
}

function buildExecutionContextListQuery(filters: ExecutionContextRecordFilters): { sql: string; values: Array<string | number> } {
  const where: string[] = [];
  const values: Array<string | number> = [];

  addFilter(where, values, "fingerprint_hash", filters.fingerprintHash);
  addFilter(where, values, "repo_id", filters.repoId);
  addFilter(where, values, "project_id", filters.projectId);
  addFilter(where, values, "workflow_id", filters.workflowId);
  addFilter(where, values, "agent_id", filters.agentId);
  addFilter(where, values, "outcome_state", filters.outcomeState);

  if (filters.from) {
    where.push("created_at >= ?");
    values.push(filters.from);
  }
  if (filters.to) {
    where.push("created_at <= ?");
    values.push(filters.to);
  }
  if (!filters.includeExpired) {
    where.push("expires_at > ?");
    values.push(filters.now ?? new Date().toISOString());
  }

  const limit = filters.limit ?? 500;
  values.push(limit);

  return {
    sql: `
      SELECT *
      FROM execution_context_records
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    values,
  };
}

function addFilter(where: string[], values: Array<string | number>, column: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  where.push(`${column} = ?`);
  values.push(value);
}

function mapTokenUsageRow(row: TokenUsageRow): TokenUsageRecord {
  return omitUndefined({
    id: row.id,
    spaceId: row.space_id ?? undefined,
    scopeId: row.scope_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    operation: row.operation,
    provider: row.provider ?? undefined,
    model: row.model,
    baselineTokens: row.baseline_tokens ?? undefined,
    actualContextTokens: row.actual_context_tokens ?? undefined,
    glialnodeOverheadTokens: row.glialnode_overhead_tokens ?? undefined,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedSavedTokens: row.estimated_saved_tokens ?? undefined,
    estimatedSavedRatio: row.estimated_saved_ratio ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    costCurrency: row.cost_currency ?? undefined,
    inputCost: row.input_cost ?? undefined,
    outputCost: row.output_cost ?? undefined,
    totalCost: row.total_cost ?? undefined,
    dimensions: parseJson(row.dimensions_json),
    createdAt: row.created_at,
  });
}

function mapExecutionContextRow(row: ExecutionContextRow): ExecutionContextRecord {
  return omitUndefined({
    schemaVersion: "1.0.0" as const,
    id: row.id,
    taskFingerprint: {
      method: row.fingerprint_method as ExecutionContextRecord["taskFingerprint"]["method"],
      hash: row.fingerprint_hash,
      featureCount: row.fingerprint_feature_count,
    },
    scope: omitUndefined({
      repoId: row.repo_id ?? undefined,
      projectId: row.project_id ?? undefined,
      workflowId: row.workflow_id ?? undefined,
      agentId: row.agent_id ?? undefined,
    }),
    selectedSkills: parseJsonStringArray(row.selected_skills_json),
    selectedTools: parseJsonStringArray(row.selected_tools_json),
    skippedTools: parseJsonStringArray(row.skipped_tools_json),
    firstReads: parseJsonStringArray(row.first_reads_json),
    outcome: omitUndefined({
      state: row.outcome_state,
      latencyMs: row.latency_ms ?? undefined,
      toolCallCount: row.tool_call_count ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      notes: parseJsonStringArray(row.outcome_notes_json),
    }),
    confidence: row.confidence,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

function serializeJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson(value: string | null): Record<string, string | number | boolean | null> | undefined {
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as Record<string, string | number | boolean | null>;
}

function parseJsonStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    return [];
  }
  return parsed;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
