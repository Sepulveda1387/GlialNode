export interface StorageAdapter {
  readonly name: string;
  readonly dialect: string;
  readonly schemaVersion: number;
  getBootstrapSql(): string;
}
