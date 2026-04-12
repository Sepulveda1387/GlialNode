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

Each record can also carry two representations at once:

- a human-readable memory body
- a compact symbolic memory body for lower-token internal recall
- a distilled durable summary when related active records converge on the same signal

Generated compact memory should stay aligned with the record lifecycle.
That means tier/status changes and maintenance workflows may rewrite generated compact text, while manually supplied compact text should be preserved.

### Link Store

Memory records may reference other records so GlialNode can keep provenance and resolve changing truth over time.

Examples:

- a summary record derived from multiple raw notes
- a distilled memory derived from multiple related active records in the same scope
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
- query alignment across summary, content, compact memory text, and tags
- a small preference for distilled durable summaries during broad recall
- a small preference for more specific kinds when the query wording signals intent

The retrieval layer should also be able to assemble a recall pack:

- a primary matched memory
- directly linked supporting memory
- nearby distilled summaries in the same scope when they improve context

And it should be able to turn that recall pack into an answer trace:

- a short explanation of why the memory was recalled
- citations for primary and supporting records
- provenance-aware reasons such as query match, distilled memory, or explicit record links

For downstream execution, the retrieval layer should also be able to emit a memory bundle:

- normalized primary and supporting entries
- readable and compact memory text together
- the trace produced from the same recall pack
- links needed to preserve provenance inside the handoff object
- per-entry annotations that flag actionable, stale, distilled, superseded, expired, or high-confidence memory
- bundle-level hints that help consumers quickly detect contested or risky handoff state

That bundle layer should also support pruning policies so different consumers can receive different shapes of memory:

- planners can tolerate broader context
- executors should get a tighter handoff with smaller payloads
- reviewers can keep richer supporting detail

The bundle layer should also support intent routing:

- explicit consumer routing when the caller already knows whether the bundle is for planning, execution, or review
- auto-routing when the memory condition itself signals the right downstream consumer
- route metadata that explains why a bundle was routed toward planner, executor, reviewer, or balanced handling
- route warnings derived from stale, superseded, or contested memory hints
- per-space routing policy so different memory spaces can adjust how aggressively they favor review, planning, or execution

### Conflict Handling

New durable memory can also trigger contradiction detection against older durable memory in the same scope.

The current design:

- looks for meaningful signal-token overlap
- checks for opposing language like `prefer` vs `avoid` or positive vs negative framing
- links the new record to the older one with `contradicts`
- lowers confidence on the older conflicting memory instead of deleting it
- emits a `memory_conflicted` event so reports can surface contested memory

### Decay Handling

Maintenance can also apply gradual trust decay to stale durable memory.

The current design:

- targets durable memory such as `decision`, `fact`, `preference`, and `summary`
- waits until the record passes a configurable age threshold
- lowers confidence and freshness by small configurable daily amounts
- respects configured floors so decay does not erase trust completely
- emits a `memory_decayed` event and a decay summary record for observability

### Reinforcement Handling

The system also needs a positive trust path, not only decay.

The current design:

- keeps retrieval side-effect free by default
- strengthens memory through an explicit reinforcement workflow
- allows host applications to opt into reinforcement after successful retrieval or use
- raises confidence and freshness within configured ceilings
- emits a `memory_reinforced` event and a reinforcement summary record
- allows different spaces to tune how quickly memories regain trust

### Client Layer

GlialNode now exposes a typed client API for programmatic use in addition to the CLI.

The client layer should:

- create and configure spaces
- manage scopes, records, events, and links
- run compaction, retention, and maintenance workflows
- import and export space snapshots
- provide a stable package surface so other systems do not need to shell out to the CLI

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

The configuration layer now also supports named space presets so new memory spaces can start with a coherent policy posture before finer overrides are applied, and those presets can be inspected through the library and CLI before use.

## V1 Operational Note

The current SQLite-first implementation is best treated as a local single-writer foundation.

The storage layer now applies a first hardening pass:

- foreign keys are enforced at connection open
- file-backed databases default to `journal_mode=WAL`
- `synchronous=NORMAL` is applied for the local durability/throughput balance
- a busy timeout is applied to reduce immediate lock failures
- defensive mode is enabled when the runtime exposes it

This improves resilience for local agents and repeated process restarts, but it does not change the broader recommendation: heavier concurrent writers may still need a later backing-store boundary or a different database.

## Current CLI Lifecycle Support

The current CLI now supports:

- creating and listing spaces
- adding and listing scopes
- adding, listing, searching, promoting, and archiving memory records
- running dry-run or applied memory compaction by simple policy
- recording compaction outcomes as system events and summary records
- distilling related active memories into higher-value summary records with provenance links
- optionally superseding source records once a strong distilled summary exists
- storing per-space policy settings that can tune compaction behavior
- enforcing per-space retention windows through sweepable expiration policy
- surfacing space-level observability for counts and recent lifecycle actions
- providing a unified maintenance entrypoint for compaction plus retention
- adding and listing events
- linking records and inspecting record provenance
- exporting and importing a full space snapshot

## Packaging Direction

GlialNode is currently being hardened as a portable Node package:

- the package root export is intended for library consumers
- the CLI is exposed through a package bin plus a dedicated `./cli` export
- the compiled CLI keeps a shebang so package-manager-installed binaries work cleanly across Unix-like environments while still remaining Windows-compatible
- package verification should include a dry-run pack step before any real publish
- the typed client API should remain the primary programmatic integration surface

## Current Storage Boundary

The current SQLite boundary now exposes:

- a resolved connection policy for file-backed databases
- runtime settings inspection for status and tests
- applied migration tracking inside the database
- storage and indexing for compact memory text
- non-recursive semantic distillation that avoids re-distilling system-generated maintenance summaries
- default active-only search behavior so superseded memory does not dominate normal recall
- lock timeout behavior that is exercised under contention in tests

That boundary is still intentionally narrow so a future driver swap can happen without changing the memory model.
