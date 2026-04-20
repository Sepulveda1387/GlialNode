# Storage Backends

GlialNode is SQLite-first today. The storage backend contract keeps that explicit while leaving a clear path for future server-backed adapters.

## Current Adapter

The built-in adapter is `sqlite`:

- `localFirst=true`
- `embedded=true`
- `durableFileBacked=true`
- `serverBacked=false`
- `transactions=true`
- `fullTextSearch=true`
- `schemaMigrations=true`
- `crossProcessWrites=single_writer`

`writeMode=serialized_local` can serialize local writes through one host-managed process boundary, but it does not turn SQLite into a backend-coordinated multi-writer service.

## Adapter Contract

Every storage adapter should declare:

- `name`
- `dialect`
- `schemaVersion`
- `capabilities`
- bootstrap SQL or an equivalent migration entrypoint

The exported helper `assertStorageAdapterContract(adapter)` validates that an adapter has a non-empty identity, positive schema version, bootstrap SQL, and non-conflicting capability flags.

The exported helper `describeStorageAdapter(adapter)` returns a machine-readable contract with capability-derived guarantees and non-goals.

## CLI Inspection

Inspect the current adapter contract:

```bash
glialnode storage contract --json
```

Preview a future migration path to a server-backed adapter:

```bash
glialnode storage migration-plan --target postgres --json
```

The migration plan is read-only. It reports whether snapshot export/import is expected, whether schema migration work is required, what write-coordination assumptions change, and the recommended validation steps before cutover.

## Client Inspection

Host applications can inspect the same contract without shelling out:

```ts
const contract = client.getStorageContract();
const plan = client.planStorageMigration({ target: "postgres" });
```

## Future Server Backend

A Postgres or server-backed source-of-truth adapter should not reuse the SQLite contract claims. It should declare:

- `serverBacked=true`
- `embedded=false`
- `crossProcessWrites=backend_coordinated`
- migration semantics for schema upgrades
- full-text search behavior and ranking differences
- explicit import/export compatibility with current SQLite snapshots

That backend remains deferred until there is a real concurrency or team-deployment need.
