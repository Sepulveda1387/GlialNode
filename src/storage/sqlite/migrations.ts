import { sqliteBootstrapSql, SQLITE_SCHEMA_VERSION } from "./schema.js";

export interface SqliteMigration {
  version: number;
  description: string;
  sql: string;
}

export const sqliteMigrations: SqliteMigration[] = [
  {
    version: SQLITE_SCHEMA_VERSION,
    description: "Bootstrap GlialNode core schema, indexes, and FTS tables.",
    sql: sqliteBootstrapSql,
  },
];
