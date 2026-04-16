import type { DatabaseSync, DatabaseSyncOptions } from "node:sqlite";

import { ConfigurationError } from "../../core/errors.js";

export type SqliteJournalMode = "WAL" | "DELETE";
export type SqliteSynchronousMode = "NORMAL" | "FULL";
export type SqliteWriteMode = "single_writer" | "serialized_local";

export interface SqliteConnectionPolicy {
  enableForeignKeys: boolean;
  busyTimeoutMs: number;
  journalMode: SqliteJournalMode;
  synchronous: SqliteSynchronousMode;
  enableDefensive: boolean;
  writeMode: SqliteWriteMode;
}

export interface SqliteRuntimeSettings {
  filename: string | null;
  busyTimeoutMs: number;
  foreignKeys: boolean;
  journalMode: string;
  synchronous: string;
  defensive: boolean | null;
  writeMode: SqliteWriteMode;
  writeGuarantees: string[];
  writeNonGoals: string[];
}

export const defaultSqliteConnectionPolicy: SqliteConnectionPolicy = {
  enableForeignKeys: true,
  busyTimeoutMs: 5000,
  journalMode: "WAL",
  synchronous: "NORMAL",
  enableDefensive: true,
  writeMode: "single_writer",
};

export function resolveSqliteConnectionPolicy(
  overrides: Partial<SqliteConnectionPolicy> = {},
): SqliteConnectionPolicy {
  const resolved = {
    ...defaultSqliteConnectionPolicy,
    ...overrides,
  };

  if (!Number.isFinite(resolved.busyTimeoutMs) || resolved.busyTimeoutMs < 0) {
    throw new ConfigurationError("SQLite busy timeout must be a non-negative finite number.");
  }

  resolved.busyTimeoutMs = Math.trunc(resolved.busyTimeoutMs);

  return resolved;
}

export function createSqliteDatabaseOptions(
  policyInput: Partial<SqliteConnectionPolicy> = {},
): DatabaseSyncOptions {
  const policy = resolveSqliteConnectionPolicy(policyInput);

  return {
    enableForeignKeyConstraints: policy.enableForeignKeys,
    timeout: policy.busyTimeoutMs,
  };
}

export function applySqliteConnectionPolicy(
  db: DatabaseSync,
  policyInput: Partial<SqliteConnectionPolicy> = {},
): SqliteRuntimeSettings {
  const policy = resolveSqliteConnectionPolicy(policyInput);

  db.exec(`PRAGMA foreign_keys = ${policy.enableForeignKeys ? "ON" : "OFF"}`);
  db.exec(`PRAGMA busy_timeout = ${policy.busyTimeoutMs}`);

  const filename = typeof db.location === "function" ? db.location() : null;

  if (filename !== null) {
    const appliedJournalMode = readPragmaString(
      db,
      `PRAGMA journal_mode = ${policy.journalMode}`,
      "journal_mode",
    ).toUpperCase();

    if (appliedJournalMode !== policy.journalMode) {
      throw new ConfigurationError(
        `Unable to enable SQLite journal mode ${policy.journalMode}; actual mode is ${appliedJournalMode}.`,
      );
    }
  }

  db.exec(`PRAGMA synchronous = ${policy.synchronous}`);
  const defensive = applyDefensiveMode(db, policy.enableDefensive);
  const runtime = readSqliteRuntimeSettings(db, defensive, policy.writeMode);

  if (runtime.foreignKeys !== policy.enableForeignKeys) {
    throw new ConfigurationError("SQLite foreign key enforcement did not match the requested policy.");
  }

  if (runtime.busyTimeoutMs !== policy.busyTimeoutMs) {
    throw new ConfigurationError("SQLite busy timeout did not match the requested policy.");
  }

  if (filename !== null && runtime.synchronous !== policy.synchronous) {
    throw new ConfigurationError(
      `SQLite synchronous mode did not match the requested policy (${policy.synchronous}).`,
    );
  }

  return runtime;
}

export function readSqliteRuntimeSettings(
  db: DatabaseSync,
  defensive: boolean | null = null,
  writeMode: SqliteWriteMode = defaultSqliteConnectionPolicy.writeMode,
): SqliteRuntimeSettings {
  const filename = typeof db.location === "function" ? db.location() : null;
  const foreignKeys = readPragmaNumber(db, "PRAGMA foreign_keys", "foreign_keys") === 1;
  const busyTimeoutMs = readPragmaNumber(db, "PRAGMA busy_timeout", "timeout");
  const journalMode = readPragmaString(db, "PRAGMA journal_mode", "journal_mode").toUpperCase();
  const synchronousCode = readPragmaNumber(db, "PRAGMA synchronous", "synchronous");

  return {
    filename,
    foreignKeys,
    busyTimeoutMs,
    journalMode,
    synchronous: mapSynchronousMode(synchronousCode),
    defensive,
    writeMode,
    writeGuarantees: describeWriteGuarantees(writeMode),
    writeNonGoals: describeWriteNonGoals(),
  };
}

function describeWriteGuarantees(writeMode: SqliteWriteMode): string[] {
  if (writeMode === "serialized_local") {
    return [
      "Caller serializes writes within one local coordination boundary.",
      "WAL plus busy timeout reduces immediate lock failures during local handoff.",
    ];
  }

  return [
    "One writer should own durable mutations for the database at a time.",
    "Readers remain safe, but concurrent writers are outside the default contract.",
  ];
}

function describeWriteNonGoals(): string[] {
  return [
    "GlialNode does not provide a cross-process write broker.",
    "SQLite mode here is not a distributed or high-concurrency multi-writer contract.",
  ];
}

function applyDefensiveMode(db: DatabaseSync, active: boolean): boolean | null {
  const candidate = db as DatabaseSync & {
    enableDefensive?: (active: boolean) => void;
  };

  if (typeof candidate.enableDefensive === "function") {
    candidate.enableDefensive(active);
    return active;
  }

  return null;
}

function readPragmaNumber(db: DatabaseSync, sql: string, column: string): number {
  const row = db.prepare(sql).get() as Record<string, number> | undefined;
  const value = row?.[column];

  if (typeof value !== "number") {
    throw new ConfigurationError(`Expected numeric SQLite pragma column ${column}.`);
  }

  return value;
}

function readPragmaString(db: DatabaseSync, sql: string, column: string): string {
  const row = db.prepare(sql).get() as Record<string, string> | undefined;
  const value = row?.[column];

  if (typeof value !== "string") {
    throw new ConfigurationError(`Expected string SQLite pragma column ${column}.`);
  }

  return value;
}

function mapSynchronousMode(value: number): string {
  switch (value) {
    case 0:
      return "OFF";
    case 1:
      return "NORMAL";
    case 2:
      return "FULL";
    case 3:
      return "EXTRA";
    default:
      return String(value);
  }
}
