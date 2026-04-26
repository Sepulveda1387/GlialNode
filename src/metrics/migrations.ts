import type { DatabaseSync } from "node:sqlite";

import { ConfigurationError } from "../core/errors.js";
import { METRICS_SQLITE_SCHEMA_VERSION, metricsBootstrapSql, metricsExecutionContextSql } from "./schema.js";

export interface MetricsSqliteMigration {
  version: number;
  description: string;
  sql: string;
}

export interface AppliedMetricsSqliteMigration {
  version: number;
  description: string;
  appliedAt: string;
}

const metricsMigrationMetadataSql = `
CREATE TABLE IF NOT EXISTS glialnode_metrics_schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const metricsSqliteMigrations: MetricsSqliteMigration[] = [
  {
    version: 1,
    description: "Bootstrap GlialNode token usage metrics schema.",
    sql: metricsBootstrapSql,
  },
  {
    version: 2,
    description: "Add execution context routing outcome records.",
    sql: metricsExecutionContextSql,
  },
];

export function applyMetricsSqliteMigrations(
  db: DatabaseSync,
  migrations: MetricsSqliteMigration[] = metricsSqliteMigrations,
): number {
  ensureMetricsMigrationMetadataTable(db);
  validateMetricsMigrationSequence(migrations);

  const currentVersion = getMetricsSqliteSchemaVersion(db);
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare(
        `
        INSERT INTO glialnode_metrics_schema_migrations (version, description, applied_at)
        VALUES (?, ?, ?)
        `,
      ).run(migration.version, migration.description, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return getMetricsSqliteSchemaVersion(db);
}

export function getMetricsSqliteSchemaVersion(db: DatabaseSync): number {
  ensureMetricsMigrationMetadataTable(db);

  const row = db.prepare(
    `
    SELECT COALESCE(MAX(version), 0) AS version
    FROM glialnode_metrics_schema_migrations
    `,
  ).get() as { version: number } | undefined;

  return Number(row?.version ?? 0);
}

export function listAppliedMetricsSqliteMigrations(db: DatabaseSync): AppliedMetricsSqliteMigration[] {
  ensureMetricsMigrationMetadataTable(db);

  const rows = db.prepare(
    `
    SELECT version, description, applied_at
    FROM glialnode_metrics_schema_migrations
    ORDER BY version ASC
    `,
  ).all() as Array<{
    version: number;
    description: string;
    applied_at: string;
  }>;

  return rows.map((row) => ({
    version: row.version,
    description: row.description,
    appliedAt: row.applied_at,
  }));
}

function ensureMetricsMigrationMetadataTable(db: DatabaseSync): void {
  db.exec(metricsMigrationMetadataSql);
}

function validateMetricsMigrationSequence(migrations: MetricsSqliteMigration[]): void {
  const seenVersions = new Set<number>();
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new ConfigurationError("Metrics SQLite migration versions must be positive integers.");
    }
    if (seenVersions.has(migration.version)) {
      throw new ConfigurationError(`Duplicate metrics SQLite migration version detected: ${migration.version}`);
    }
    if (migration.version <= previousVersion) {
      throw new ConfigurationError("Metrics SQLite migrations must be ordered by ascending version.");
    }

    seenVersions.add(migration.version);
    previousVersion = migration.version;
  }
}

export function assertMetricsSqliteSchemaCurrent(version: number): void {
  if (version !== METRICS_SQLITE_SCHEMA_VERSION) {
    throw new ConfigurationError(
      `Metrics SQLite schema version ${version} does not match latest ${METRICS_SQLITE_SCHEMA_VERSION}.`,
    );
  }
}
