import type { DatabaseSync } from "node:sqlite";

import { ConfigurationError } from "../../core/errors.js";
import { sqliteBootstrapSql, SQLITE_SCHEMA_VERSION } from "./schema.js";

export interface SqliteMigration {
  version: number;
  description: string;
  sql: string;
}

export interface AppliedSqliteMigration {
  version: number;
  description: string;
  appliedAt: string;
}

const sqliteMigrationMetadataSql = `
CREATE TABLE IF NOT EXISTS glialnode_schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const sqliteMigrations: SqliteMigration[] = [
  {
    version: SQLITE_SCHEMA_VERSION,
    description: "Bootstrap GlialNode core schema, indexes, and FTS tables.",
    sql: sqliteBootstrapSql,
  },
];

export function applySqliteMigrations(
  db: DatabaseSync,
  migrations: SqliteMigration[] = sqliteMigrations,
): number {
  ensureMigrationMetadataTable(db);
  validateMigrationSequence(migrations);

  const currentVersion = getSqliteSchemaVersion(db);

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    db.exec("BEGIN");

    try {
      db.exec(migration.sql);
      db.prepare(
        `
        INSERT INTO glialnode_schema_migrations (version, description, applied_at)
        VALUES (?, ?, ?)
        `,
      ).run(migration.version, migration.description, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return getSqliteSchemaVersion(db);
}

export function getSqliteSchemaVersion(db: DatabaseSync): number {
  ensureMigrationMetadataTable(db);

  const row = db.prepare(
    `
    SELECT COALESCE(MAX(version), 0) AS version
    FROM glialnode_schema_migrations
    `,
  ).get() as { version: number } | undefined;

  return Number(row?.version ?? 0);
}

export function listAppliedSqliteMigrations(db: DatabaseSync): AppliedSqliteMigration[] {
  ensureMigrationMetadataTable(db);

  const rows = db.prepare(
    `
    SELECT version, description, applied_at
    FROM glialnode_schema_migrations
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

function ensureMigrationMetadataTable(db: DatabaseSync): void {
  db.exec(sqliteMigrationMetadataSql);
}

function validateMigrationSequence(migrations: SqliteMigration[]): void {
  const seenVersions = new Set<number>();
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new ConfigurationError("SQLite migration versions must be positive integers.");
    }

    if (seenVersions.has(migration.version)) {
      throw new ConfigurationError(`Duplicate SQLite migration version detected: ${migration.version}`);
    }

    if (migration.version <= previousVersion) {
      throw new ConfigurationError("SQLite migrations must be ordered by ascending version.");
    }

    seenVersions.add(migration.version);
    previousVersion = migration.version;
  }
}
