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
