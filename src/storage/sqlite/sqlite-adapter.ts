import type { StorageAdapter } from "../adapter.js";
import { sqliteBootstrapSql, SQLITE_SCHEMA_VERSION } from "./schema.js";

export const sqliteAdapter: StorageAdapter = {
  name: "sqlite",
  dialect: "sqlite",
  schemaVersion: SQLITE_SCHEMA_VERSION,
  capabilities: {
    localFirst: true,
    embedded: true,
    durableFileBacked: true,
    serverBacked: false,
    transactions: true,
    fullTextSearch: true,
    schemaMigrations: true,
    crossProcessWrites: "single_writer",
  },
  getBootstrapSql(): string {
    return sqliteBootstrapSql;
  },
};
