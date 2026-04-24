export interface StorageAdapter {
  readonly name: string;
  readonly dialect: string;
  readonly schemaVersion: number;
  readonly capabilities?: StorageAdapterCapabilities;
  getBootstrapSql(): string;
}

export interface StorageAdapterCapabilities {
  localFirst: boolean;
  embedded: boolean;
  durableFileBacked: boolean;
  serverBacked: boolean;
  transactions: boolean;
  fullTextSearch: boolean;
  schemaMigrations: boolean;
  crossProcessWrites: "single_writer" | "host_serialized" | "backend_coordinated";
}

export interface StorageAdapterContract {
  name: string;
  dialect: string;
  schemaVersion: number;
  capabilities: StorageAdapterCapabilities;
  guarantees: string[];
  nonGoals: string[];
}

export interface StorageBackendMigrationPlan {
  source: StorageAdapterContract;
  target: StorageAdapterContract;
  compatible: boolean;
  requiresSnapshotExport: boolean;
  requiresSchemaMigration: boolean;
  warnings: string[];
  steps: string[];
}

export function describeStorageAdapter(adapter: StorageAdapter): StorageAdapterContract {
  const capabilities = adapter.capabilities ?? defaultStorageAdapterCapabilities();

  return {
    name: adapter.name,
    dialect: adapter.dialect,
    schemaVersion: adapter.schemaVersion,
    capabilities,
    guarantees: buildStorageGuarantees(capabilities),
    nonGoals: buildStorageNonGoals(capabilities),
  };
}

export function assertStorageAdapterContract(adapter: StorageAdapter): void {
  if (!adapter.name.trim()) {
    throw new Error("Storage adapter contract requires a non-empty name.");
  }
  if (!adapter.dialect.trim()) {
    throw new Error("Storage adapter contract requires a non-empty dialect.");
  }
  if (!Number.isInteger(adapter.schemaVersion) || adapter.schemaVersion < 1) {
    throw new Error("Storage adapter contract requires a positive integer schema version.");
  }

  const bootstrapSql = adapter.getBootstrapSql();
  if (!bootstrapSql.trim()) {
    throw new Error("Storage adapter contract requires non-empty bootstrap SQL.");
  }

  const capabilities = describeStorageAdapter(adapter).capabilities;
  if (capabilities.serverBacked && capabilities.embedded) {
    throw new Error("Storage adapter cannot be both embedded and server-backed.");
  }
}

export function createServerBackedStorageContract(
  options: {
    name?: string;
    dialect?: string;
    schemaVersion?: number;
    fullTextSearch?: boolean;
  } = {},
): StorageAdapterContract {
  const capabilities: StorageAdapterCapabilities = {
    localFirst: false,
    embedded: false,
    durableFileBacked: false,
    serverBacked: true,
    transactions: true,
    fullTextSearch: options.fullTextSearch ?? true,
    schemaMigrations: true,
    crossProcessWrites: "backend_coordinated",
  };

  return {
    name: options.name ?? "server-backed",
    dialect: options.dialect ?? "postgres",
    schemaVersion: options.schemaVersion ?? 1,
    capabilities,
    guarantees: buildStorageGuarantees(capabilities),
    nonGoals: buildStorageNonGoals(capabilities),
  };
}

export function planStorageBackendMigration(
  sourceAdapter: StorageAdapter,
  target: StorageAdapter | StorageAdapterContract,
): StorageBackendMigrationPlan {
  assertStorageAdapterContract(sourceAdapter);
  const source = describeStorageAdapter(sourceAdapter);
  const targetContract = "getBootstrapSql" in target
    ? describeStorageAdapter(target)
    : target;

  const warnings = buildMigrationWarnings(source, targetContract);
  const requiresSchemaMigration = source.schemaVersion !== targetContract.schemaVersion ||
    source.dialect !== targetContract.dialect;
  const requiresSnapshotExport = source.name !== targetContract.name ||
    source.dialect !== targetContract.dialect;

  return {
    source,
    target: targetContract,
    compatible: warnings.length === 0,
    requiresSnapshotExport,
    requiresSchemaMigration,
    warnings,
    steps: buildMigrationSteps(source, targetContract, {
      requiresSnapshotExport,
      requiresSchemaMigration,
    }),
  };
}

function defaultStorageAdapterCapabilities(): StorageAdapterCapabilities {
  return {
    localFirst: true,
    embedded: true,
    durableFileBacked: false,
    serverBacked: false,
    transactions: true,
    fullTextSearch: false,
    schemaMigrations: true,
    crossProcessWrites: "single_writer",
  };
}

function buildStorageGuarantees(capabilities: StorageAdapterCapabilities): string[] {
  return [
    capabilities.localFirst ? "Local-first operation is supported." : "Adapter depends on an external backend.",
    capabilities.transactions ? "Durable mutations are expected to use transactional writes." : "Transactional writes are not guaranteed.",
    capabilities.schemaMigrations ? "Schema versioning and migrations are part of the adapter contract." : "Schema migrations are outside this adapter contract.",
    capabilities.fullTextSearch ? "Full-text search is available through the adapter." : "Full-text search must be provided by a higher layer or separate index.",
    `Cross-process write coordination mode is ${capabilities.crossProcessWrites}.`,
  ];
}

function buildStorageNonGoals(capabilities: StorageAdapterCapabilities): string[] {
  const nonGoals = [];

  if (!capabilities.serverBacked) {
    nonGoals.push("This adapter is not a team/server source-of-truth backend.");
  }
  if (capabilities.crossProcessWrites !== "backend_coordinated") {
    nonGoals.push("This adapter does not provide backend-coordinated multi-writer semantics.");
  }
  if (!capabilities.fullTextSearch) {
    nonGoals.push("This adapter does not provide built-in full-text search.");
  }

  return nonGoals;
}

function buildMigrationWarnings(
  source: StorageAdapterContract,
  target: StorageAdapterContract,
): string[] {
  const warnings = [];

  if (!source.capabilities.schemaMigrations || !target.capabilities.schemaMigrations) {
    warnings.push("Both source and target should declare schema migration support before migration.");
  }
  if (!source.capabilities.fullTextSearch && target.capabilities.fullTextSearch) {
    warnings.push("Target search behavior may rank differently because source lacks full-text search.");
  }
  if (source.capabilities.fullTextSearch && !target.capabilities.fullTextSearch) {
    warnings.push("Target does not declare full-text search; retrieval behavior may regress.");
  }
  if (source.capabilities.crossProcessWrites !== target.capabilities.crossProcessWrites) {
    warnings.push(
      `Write coordination changes from ${source.capabilities.crossProcessWrites} to ${target.capabilities.crossProcessWrites}; review host concurrency assumptions.`,
    );
  }
  if (source.schemaVersion > target.schemaVersion) {
    warnings.push("Target schema version is older than source schema version.");
  }

  return warnings;
}

function buildMigrationSteps(
  source: StorageAdapterContract,
  target: StorageAdapterContract,
  options: { requiresSnapshotExport: boolean; requiresSchemaMigration: boolean },
): string[] {
  const steps = [
    `Review source adapter contract (${source.name}/${source.dialect}) and target adapter contract (${target.name}/${target.dialect}).`,
    "Run full checks and export a versioned, checksummed GlialNode snapshot from the source backend.",
  ];

  if (options.requiresSchemaMigration) {
    steps.push("Apply target schema migrations before importing data.");
  }
  if (options.requiresSnapshotExport) {
    steps.push("Import through the snapshot restore path with explicit collision and trust policy settings.");
  }

  steps.push("Run retrieval evals, status/doctor checks, and a representative recall/bundle smoke test on the target backend.");
  steps.push("Keep the source backend read-only until target validation is complete.");

  return steps;
}
