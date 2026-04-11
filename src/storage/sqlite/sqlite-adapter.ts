import type { StorageAdapter } from "../adapter.js";
import { sqliteBootstrapSql, SQLITE_SCHEMA_VERSION } from "./schema.js";

export const sqliteAdapter: StorageAdapter = {
  name: "sqlite",
  dialect: "sqlite",
  schemaVersion: SQLITE_SCHEMA_VERSION,
  getBootstrapSql(): string {
    return sqliteBootstrapSql;
  },
};
