# GlialNode V1 Blueprint

## Goal

Ship a usable, publishable memory core for orchestrators, agents, and subagents without overfitting the first release.

## V1 Capabilities

- create and manage memory spaces
- scope memory to orchestrators, agents, subagents, sessions, tasks, and projects
- store curated memory records in short, mid, or long-term tiers
- append raw operational events separately from curated memory
- support lexical-first retrieval with SQLite FTS5
- support promotion and decay policies in the service layer

## V1 Boundaries

GlialNode v1 stays as one package with clear internal module boundaries:

- `src/core`: domain types, ids, config, and errors
- `src/events`: operational event model
- `src/memory`: service and policy logic
- `src/storage`: repository contracts
- `src/storage/sqlite`: SQLite schema and adapter scaffolding
- `src/cli`: inspection-oriented CLI entrypoint

## Data Model

### Memory Space

Top-level tenant boundary used to isolate one orchestrator set from another.

### Scope

Typed namespace within a memory space. Scopes make memory retrieval precise and let GlialNode serve multiple orchestrators and teams safely.

### Memory Record

Curated memory item that should survive beyond raw logs. Records carry tier, kind, visibility, confidence, freshness, and importance signals.

### Memory Event

Append-only operational record of what happened. Events are not automatically durable memory.

### Memory Record Link

Relationship between records such as:

- `derived_from`
- `supports`
- `contradicts`
- `supersedes`
- `references`

## Retrieval Order

1. filter by memory space
2. filter by relevant scopes
3. filter by metadata such as tier, kind, visibility, and status
4. run FTS5 search across record content and summaries
5. rank results using importance, confidence, freshness, and recency

## Deferred From V1

- semantic/vector retrieval
- distributed coordination
- background compaction workers
- policy automation driven by model output
- cross-space sharing rules beyond explicit copying
