# Changelog

## Unreleased

- Added semantic memory distillation during compaction.
- Added provenance links from distilled summary records back to their source records.
- Added compaction policy knobs for `distillMinClusterSize` and `distillMinTokenOverlap`.

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
