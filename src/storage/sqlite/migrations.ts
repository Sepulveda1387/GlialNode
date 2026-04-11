import type { DatabaseSync } from "node:sqlite";

import { ConfigurationError } from "../../core/errors.js";
import { SQLITE_SCHEMA_VERSION } from "./schema.js";

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
    version: 1,
    description: "Bootstrap GlialNode core schema, indexes, and FTS tables.",
    sql: `
CREATE TABLE IF NOT EXISTS memory_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scopes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  type TEXT NOT NULL,
  external_id TEXT,
  label TEXT,
  parent_scope_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(space_id) REFERENCES memory_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_scope_id) REFERENCES scopes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scopes_space_type ON scopes(space_id, type);
CREATE INDEX IF NOT EXISTS idx_scopes_external_id ON scopes(space_id, external_id);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(space_id) REFERENCES memory_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(scope_id) REFERENCES scopes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_events_space_scope ON memory_events(space_id, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('short', 'mid', 'long')),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared', 'space')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'superseded', 'expired')),
  tags_json TEXT NOT NULL,
  importance REAL NOT NULL,
  confidence REAL NOT NULL,
  freshness REAL NOT NULL,
  source_event_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(space_id) REFERENCES memory_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(scope_id) REFERENCES scopes(id) ON DELETE CASCADE,
  FOREIGN KEY(source_event_id) REFERENCES memory_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_records_space_tier ON memory_records(space_id, tier, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_scope_kind ON memory_records(scope_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_status ON memory_records(space_id, status, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(
  record_id UNINDEXED,
  content,
  summary,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_records_ai
AFTER INSERT ON memory_records
BEGIN
  INSERT INTO memory_records_fts(record_id, content, summary)
  VALUES (new.id, new.content, coalesce(new.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS memory_records_au
AFTER UPDATE ON memory_records
BEGIN
  UPDATE memory_records_fts
  SET content = new.content,
      summary = coalesce(new.summary, '')
  WHERE record_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_records_ad
AFTER DELETE ON memory_records
BEGIN
  DELETE FROM memory_records_fts
  WHERE record_id = old.id;
END;

CREATE TABLE IF NOT EXISTS memory_record_links (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(space_id) REFERENCES memory_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(from_record_id) REFERENCES memory_records(id) ON DELETE CASCADE,
  FOREIGN KEY(to_record_id) REFERENCES memory_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_record_links_from_record ON memory_record_links(from_record_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_memory_record_links_to_record ON memory_record_links(to_record_id, relation_type);
`,
  },
  {
    version: 2,
    description: "Add compact memory encoding support and index it for retrieval.",
    sql: `
ALTER TABLE memory_records ADD COLUMN compact_content TEXT;

UPDATE memory_records
SET compact_content = coalesce(summary, content)
WHERE compact_content IS NULL;

DROP TRIGGER IF EXISTS memory_records_ai;
DROP TRIGGER IF EXISTS memory_records_au;
DROP TRIGGER IF EXISTS memory_records_ad;
DROP TABLE IF EXISTS memory_records_fts;

CREATE VIRTUAL TABLE memory_records_fts USING fts5(
  record_id UNINDEXED,
  content,
  summary,
  compact_content,
  tokenize = 'porter unicode61'
);

INSERT INTO memory_records_fts(record_id, content, summary, compact_content)
SELECT id, content, coalesce(summary, ''), coalesce(compact_content, '')
FROM memory_records;

CREATE TRIGGER memory_records_ai
AFTER INSERT ON memory_records
BEGIN
  INSERT INTO memory_records_fts(record_id, content, summary, compact_content)
  VALUES (new.id, new.content, coalesce(new.summary, ''), coalesce(new.compact_content, ''));
END;

CREATE TRIGGER memory_records_au
AFTER UPDATE ON memory_records
BEGIN
  UPDATE memory_records_fts
  SET content = new.content,
      summary = coalesce(new.summary, ''),
      compact_content = coalesce(new.compact_content, '')
  WHERE record_id = new.id;
END;

CREATE TRIGGER memory_records_ad
AFTER DELETE ON memory_records
BEGIN
  DELETE FROM memory_records_fts
  WHERE record_id = old.id;
END;
`,
  },
  {
    version: 3,
    description: "Track whether compact memory content was generated or provided manually.",
    sql: `
ALTER TABLE memory_records ADD COLUMN compact_source TEXT CHECK (compact_source IN ('generated', 'manual'));

UPDATE memory_records
SET compact_source = 'generated'
WHERE compact_source IS NULL;
`,
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
