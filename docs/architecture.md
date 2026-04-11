# Architecture Notes

## Core Principles

1. Memory should be scoped before it is retrieved.
2. Working memory should stay small and explicit.
3. Mid-term memory should carry session and workstream continuity.
4. Long-term memory should contain only durable, reusable knowledge.
5. Raw operational events and curated memory records should stay distinct.
6. Memory spaces should isolate orchestrator groups by default.
7. Promotion rules belong in policy code, not in storage.

## Planned Layers

### Event Store

The event store captures what happened:

- user requests
- orchestrator decisions
- agent actions
- tool executions
- errors
- task updates

### Memory Store

The memory store captures what should be remembered:

- facts
- decisions
- preferences
- blockers
- summaries
- tasks

Each record will include a tier, scope, source, confidence, and freshness signal.

### Link Store

Memory records may reference other records so GlialNode can keep provenance and resolve changing truth over time.

Examples:

- a summary record derived from multiple raw notes
- a corrected decision that supersedes an earlier one
- an alert that contradicts a stale fact

### Retrieval Layer

Retrieval should favor:

1. scope filters
2. metadata filters
3. full-text retrieval
4. optional semantic retrieval later

Ranking should combine:

- importance
- confidence
- freshness
- recency

## Scopes

GlialNode should support:

- memory spaces
- orchestrators
- agents
- subagents
- sessions
- tasks
- projects

## V1 Tables

- `memory_spaces`
- `scopes`
- `memory_events`
- `memory_records`
- `memory_record_links`
- `memory_records_fts`

## Current Direction

GlialNode v1 is SQLite-first and lexical-first:

- SQLite is the source of truth
- FTS5 is the first retrieval engine
- semantic retrieval is deferred until the structured and lexical path is strong

## V1 Operational Note

The current SQLite-first implementation is best treated as a local single-writer foundation. Multiple concurrent CLI or process writes against the same database file may require a later hardening pass with connection policy, WAL tuning, or a different backing store.

## Current CLI Lifecycle Support

The current CLI now supports:

- creating and listing spaces
- adding and listing scopes
- adding, listing, searching, promoting, and archiving memory records
- running dry-run or applied memory compaction by simple policy
- recording compaction outcomes as system events and summary records
- storing per-space policy settings that can tune compaction behavior
- enforcing per-space retention windows through sweepable expiration policy
- surfacing space-level observability for counts and recent lifecycle actions
- providing a unified maintenance entrypoint for compaction plus retention
- adding and listing events
- linking records and inspecting record provenance
- exporting and importing a full space snapshot
