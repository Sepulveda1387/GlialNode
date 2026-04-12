# Changelog

## Unreleased

- Added semantic memory distillation during compaction.
- Added provenance links from distilled summary records back to their source records.
- Added compaction policy knobs for `distillMinClusterSize` and `distillMinTokenOverlap`.
- Added controlled source-record supersession for strong distilled summaries.
- Made normal memory search default to active records unless a status filter is provided.
- Added query-aware lexical ranking so broad queries can favor distilled memory while narrow queries can still favor specific records.
- Added contradiction detection for new durable memory with `contradicts` links and confidence penalties on older conflicting records.
- Added explicit stale-memory decay with configurable confidence and freshness reduction during maintenance.
- Added explicit memory reinforcement with configurable confidence and freshness boosts for revalidated records.
- Added opt-in reinforcement for successful search results in the client and CLI without changing default search behavior.
- Added recall-pack retrieval so client and CLI can return primary matches with linked supporting memory.
- Added structured recall traces with citation-style reasons for primary and supporting memory.
- Added reusable memory bundles for downstream agent and orchestrator handoff.
- Added bundle profiles and pruning controls for tighter downstream handoff payloads.
- Added bundle annotations and consumer hints so handoff bundles can flag actionable, stale, distilled, and contested memory explicitly.
- Added bundle intent routing so GlialNode can auto-shape handoff payloads for planner, executor, or reviewer consumers.
- Added per-space routing policy controls so auto-routing behavior can be tuned without changing application code.
- Added named space presets so new memory spaces can start from balanced, execution-first, conservative-review, or planning-heavy policy bundles.
- Added preset introspection so the client and CLI can list and show preset definitions before applying them.
- Added preset export and preset-file application so custom brain styles can be shared as JSON and reapplied to new spaces.
- Added a local preset registry so custom brain styles can be registered once and reused by name.
- Added preset provenance metadata so exported and registered brain styles can carry version, author, source, and timestamp fields.
- Added preset history snapshots and inspection so registered brain styles keep a local version trail instead of only overwriting the latest file.
- Added preset diffing so built-in, local, and file-backed brain styles can be compared across metadata and policy settings.
- Added preset rollback so a registered local brain style can be restored to an earlier version from history.
- Added preset release channels so registered brain styles can promote versions into lanes like `stable` and `candidate`.
- Added bundle trust-policy enforcement so preset bundle inspection/import can require signers and allowlist origins or signers.
- Added Ed25519 preset bundle signatures with signer public-key fingerprints and key-id allowlisting.
- Added channel-based space creation and configuration so spaces can consume a named preset lane directly.
- Added default preset channels so local preset consumers can resolve a recommended lane without specifying it every time.
- Added preset channel export/import so channel manifests can move between machines or repos.
- Added full preset bundle export/import so active presets, history, and channel state can travel together.
- Added preset bundle compatibility metadata and validation, plus bundle inspection via `preset bundle-show`.
- Fixed the CLI `memory add --status ...` path so non-active record states are persisted correctly.

## 0.1.0

- Bootstrapped the GlialNode TypeScript project structure.
- Added SQLite-first storage with FTS-backed retrieval.
- Added a typed client API for programmatic use.
- Added a runnable cross-platform client demo for the package API.
- Added compact memory encoding support for lower-token internal recall.
- Added compact-memory source tracking and automatic refresh for generated encodings.
- Added SQLite connection hardening defaults and runtime inspection.
- Added applied SQLite migration tracking and schema version reporting.
- Added memory spaces, scopes, records, events, and provenance links.
- Added CLI workflows for create, search, import/export, and inspection.
- Added lifecycle operations for promote, archive, compaction, retention, reporting, and maintenance.
