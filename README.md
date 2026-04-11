# GlialNode

<p align="center">
  <img src="./assets/glialnode-banner.svg" alt="GlialNode banner" width="100%" />
</p>

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-24%2B-339933.svg)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)
![Storage](https://img.shields.io/badge/storage-SQLite-003B57.svg)

GlialNode is a memory system for orchestrators, agents, and subagents.

It is designed for systems that need more than a chat transcript. GlialNode gives you structured memory, scoped recall, lifecycle policy, and operational tooling in one SQLite-first package.

It is built around three ideas:

- tiered memory: short, mid, and long-term state
- scoped memory: separate spaces for different orchestrators, projects, and agents
- retrieval over replay: search and inject only the memory that matters now

## Why GlialNode

Most agent memory attempts fall into one of two traps:

- they replay too much raw history into context
- they store data, but do not manage it as memory

GlialNode takes a different path:

- it separates operational events from curated memory records
- it treats memory as scoped, tiered, and policy-driven
- it supports provenance, lifecycle operations, and observability
- it stays local and inspectable with a SQLite-first architecture

The goal is not just to save facts. The goal is to manage memory as a living system.

## Vision

GlialNode aims to provide a publishable, open-source memory layer for orchestrators, agents, and multi-agent systems.

The v1 architecture is SQLite-first and built around:

- an event log for operational history
- structured memory records with tiers and scopes
- FTS-backed retrieval for continuity and recall
- promotion and decay rules that keep active memory small

## Architecture At A Glance

```mermaid
flowchart TD
    A[Incoming requests and tool output] --> B[Event Store]
    A --> C[Memory Service Layer]
    B --> C
    C --> D[Short / Mid / Long Memory]
    C --> E[Policy Workflows]
    E --> F[Compaction]
    E --> G[Retention]
    C --> H[Retrieval and Reporting]
    D --> I[(SQLite + FTS5)]
    B --> I
    H --> I
```

## Current Capabilities

- create isolated memory spaces
- scope memory to agents, subagents, sessions, tasks, and projects
- store curated records, raw events, and provenance links
- store both human-readable memory text and compact internal memory text
- search memory with query-aware lexical retrieval and structured filters
- promote, archive, compact, and expire records through explicit policy workflows
- distill related active records into durable summary memory with provenance links
- detect contradictory durable memory and preserve it as contested state
- configure compaction and retention policy per space
- apply hardened SQLite defaults for file-backed databases
- track applied SQLite schema versions inside the database
- inspect memory health through reporting and maintenance commands
- import and export full space snapshots

## How It Fits

GlialNode is a good fit when you want:

- a local-first memory layer
- strong inspectability over opaque hosted storage
- structured recall for multi-agent workflows
- lifecycle operations such as compaction, retention, and maintenance
- a codebase you can extend without needing a separate database service first

It is less ideal if you already need:

- high-concurrency multi-writer coordination
- large-scale semantic/vector retrieval as the primary retrieval mode
- a distributed storage system from day one

## Initial Roadmap

1. Define the v1 domain model for spaces, scopes, events, records, and links.
2. Add the SQLite bootstrap schema and retrieval indexes.
3. Implement a basic repository and memory service layer.
4. Add a small CLI for inspecting spaces, records, and schema state.
5. Publish examples for orchestrator and subagent integration.

## Repo Layout

- `src/core`: shared types and constants
- `src/events`: operational events
- `src/memory`: tier and retrieval logic
- `src/storage`: storage adapters and schema support
- `src/cli`: command-line entrypoints
- `docs`: architecture notes

## Status

GlialNode currently includes:

- the v1 domain model for spaces, scopes, events, records, and links
- a SQLite bootstrap schema with FTS5 indexing and sync triggers
- a working SQLite repository implementation
- a typed `GlialNodeClient` for programmatic use
- compact memory encoding for lower-token internal recall
- query-aware retrieval ranking and record promotion helpers
- a functional CLI for spaces, scopes, and memory records
- import/export and memory lifecycle commands
- record provenance and link management
- compaction history with system events and summary records
- semantic distillation of related records during compaction
- automatic contradiction detection with confidence penalties on older conflicting memory
- time-based confidence and freshness decay for stale durable memory
- explicit reinforcement workflows that strengthen confirmed memory again
- per-space policy settings for configurable memory behavior
- SQLite connection hardening with WAL, busy timeout, foreign keys, and runtime inspection
- applied SQLite migration tracking and schema-version introspection
- active retention sweeps with expiration events and summaries
- space-level reporting for memory and lifecycle observability
- unified maintenance workflow for operational upkeep
- repository tests for core persistence and lexical search

## Current Notes

GlialNode currently uses Node's built-in `node:sqlite` module to keep the first release lightweight. In Node 24, that API is still marked experimental, so a later release may choose to wrap it behind a stricter storage boundary or swap the underlying SQLite driver without changing the GlialNode memory model.

File-backed SQLite connections now default to:

- `journal_mode=WAL`
- `synchronous=NORMAL`
- `busy_timeout=5000`
- foreign key enforcement enabled
- defensive mode enabled when the runtime supports it

These defaults make the local single-writer story sturdier, but they do not turn SQLite into a high-concurrency distributed store.

GlialNode also records applied SQLite migrations inside the database so bootstrap stays idempotent and the runtime can report the actual schema version that has been applied.

Memory records now support a compact internal form as well. GlialNode keeps the readable `content` and `summary`, but it can also store a denser symbolic representation in `compactContent` for memory compression and retrieval.

## Quick Start

```bash
npm install
npm run check
npm run test
npm run demo
npm run demo:client
npm run pack:check
```

The demo paths are Node-based and intended to run on Windows, Linux, and macOS:

- `npm run demo` exercises the CLI workflow
- `npm run demo:client` exercises the typed client API directly

## Example Report

This is the kind of operational summary GlialNode can emit after maintenance:

```text
spaceId=space_example
records=4
events=2
links=2
tiers=mid:3,short:1
statuses=active:3,expired:1
kinds=summary:2,task:2
recentLifecycleEvents=2
evt_x memory_expired Retention expired mem_y after 0 day(s).
evt_z memory_promoted Compaction promoted mem_a from short to mid.
```

## What The Demo Shows

The demo flow exercises the main operational loop:

1. create a space
2. configure policy
3. add working records
4. run maintenance
5. inspect the resulting report
6. export the final snapshot

That makes it a good first check for whether the current project shape matches your use case.

The client demo follows the same lifecycle through `GlialNodeClient`, which makes it a better fit if you plan to embed GlialNode into another Node application.

## Library Example

GlialNode can be used directly from code without shelling out to the CLI:

```ts
import { GlialNodeClient } from "glialnode";

const client = new GlialNodeClient({
  filename: ".glialnode/app.sqlite",
});

const space = await client.createSpace({ name: "Team Memory" });
const scope = await client.addScope({
  spaceId: space.id,
  type: "agent",
  label: "planner",
});

await client.addRecord({
  spaceId: space.id,
  scope: { id: scope.id, type: scope.type },
  tier: "mid",
  kind: "decision",
  content: "Prefer lexical retrieval first.",
  summary: "Retrieval preference",
});

const matches = await client.searchRecords({
  spaceId: space.id,
  text: "lexical retrieval",
  limit: 5,
});

console.log(matches.map((record) => record.summary ?? record.content));
client.close();
```

The client also accepts SQLite connection policy overrides when you need to tune lock handling or journaling for a local deployment.

Search stays side-effect free by default, but host apps can opt into reinforcing records that proved useful:

```ts
const matches = await client.searchRecords(
  {
    spaceId: space.id,
    text: "lexical retrieval",
    limit: 5,
  },
  {
    reinforce: {
      enabled: true,
      limit: 2,
      strength: 1.5,
      reason: "successful-retrieval",
    },
  },
);
```

GlialNode can also build recall packs so a primary match comes back with nearby supporting memory:

```ts
const packs = await client.recallRecords(
  {
    spaceId: space.id,
    text: "lexical retrieval",
    limit: 3,
  },
  {
    primaryLimit: 1,
    supportLimit: 3,
  },
);

console.log(packs[0]?.primary.summary);
console.log(packs[0]?.supporting.map((record) => record.summary ?? record.content));
```

## Compact Memory

GlialNode now supports a compact internal memory encoding layer so the system can preserve high-signal structure in fewer tokens.

It does not replace readable text. Instead, each record can keep:

- `content`: human-readable source text
- `summary`: short readable form
- `compactContent`: symbolic compressed form for internal memory use
- `compactSource`: whether the compact form was generated by GlialNode or provided manually

Example:

```text
content: "Fix the login bug first and keep mobile support intact."
compactContent: "tr=s;k=tsk;sc=agt:planner-1;st=act;sm=login_bug_first;ct=fix_login_bug_first_keep_mobile_support_intact"
```

If you do not provide `compactContent`, GlialNode generates one automatically when the record is created. If you already have your own compact language, you can store it explicitly and GlialNode will preserve and index it.

Generated compact memory stays in sync automatically when records are promoted, archived, expired, or refreshed during maintenance. Manual compact memory is preserved as-is so GlialNode does not overwrite a custom symbolic language you intentionally stored.

## Distilled Memory

GlialNode compaction now includes a semantic distillation pass.

When multiple active records in the same scope share meaningful tags or enough signal-token overlap, GlialNode can create a new durable summary record that:

- captures the common thread in a single higher-value memory
- links back to the source records with `derived_from` provenance
- avoids re-distilling prior system-generated compaction and retention summaries

This gives the system a more brain-like behavior: it does not just keep records tidy, it can consolidate repeated related knowledge into something easier to retrieve later.

The default distillation policy is conservative:

- `distillMinClusterSize=2`
- `distillMinTokenOverlap=2`
- `distillSupersedeSources=true`
- `distillSupersedeMinConfidence=0.8`

When a distilled summary is strong enough, GlialNode can also mark the contributing mid-term durable records as `superseded`. This keeps the active set smaller without deleting source provenance.

Normal search now defaults to `active` records unless you explicitly request another status such as `superseded`, `archived`, or `expired`.

These values can be tuned through space policy settings if you want distillation to be stricter or more aggressive.

## Retrieval Behavior

GlialNode is still lexical-first in v1, but ranking is now query-aware instead of purely generic.

When records match a query, retrieval now balances:

- structural memory quality like importance, confidence, freshness, and recency
- direct query alignment across summary, content, compact memory text, and tags
- a modest preference for distilled long-term summaries when the query is broad
- a modest preference for specific decisions, facts, or summaries when the query wording clearly asks for them

That means a distilled durable summary can lead for broad recall, while a more specific raw decision can still win when the query is narrow and intent-heavy.

On top of plain ranked search, GlialNode can now assemble recall packs:

- one primary matched record
- linked supporting records like `supports`, `derived_from`, `references`, or `supersedes`
- nearby same-scope distilled summaries when they add helpful context

This gives host systems a more usable retrieval shape for answers, planning, and tool decisions.

## Contradiction Handling

GlialNode can now detect likely contradictions when a new durable record is written into the same scope as older durable memory.

When the new record overlaps strongly enough with older `decision`, `fact`, or `preference` records and the language points in an opposing direction, GlialNode can:

- add a `contradicts` provenance link from the new record to the older one
- emit a `memory_conflicted` event for observability
- reduce confidence on the older conflicting record instead of deleting it

This keeps contested knowledge visible without treating every conflicting update as a hard overwrite.

The default conflict policy is:

- `enabled=true`
- `minTokenOverlap=2`
- `confidencePenalty=0.15`

You can tune or disable this behavior through space settings.

## Memory Decay

GlialNode now includes a decay phase for stale durable memory.

Instead of letting old decisions and facts keep their original trust forever, GlialNode can gradually reduce:

- `confidence` when a durable record goes stale
- `freshness` as the record ages

Decay is designed to be gradual and bounded. Records never fall below configured floors, and decay runs as an explicit maintenance workflow so the system remains inspectable.

The default decay policy is:

- `enabled=true`
- `minAgeDays=14`
- `confidenceDecayPerDay=0.01`
- `freshnessDecayPerDay=0.02`
- `minConfidence=0.2`
- `minFreshness=0.15`

Decay can be run directly or as part of `space maintain`.

## Memory Reinforcement

GlialNode now includes explicit reinforcement for memory that has been confirmed again.

Instead of mutating trust on every read, reinforcement is an observable workflow. That keeps retrieval side-effect free by default while still letting an operator or host system strengthen a record after:

- a manual confirmation
- a successful downstream use
- a deliberate review step

Reinforcement can raise:

- `confidence` when a memory has been revalidated
- `freshness` when a memory has become recently relevant again

The default reinforcement policy is:

- `enabled=true`
- `confidenceBoost=0.08`
- `freshnessBoost=0.12`
- `maxConfidence=1`
- `maxFreshness=1`

Reinforcement creates a `memory_reinforced` event and a reinforcement summary record so the trust increase is inspectable later.

Host applications can also opt into reinforcement during search when a result was actually used successfully. Normal search does not mutate memory unless you ask for that behavior explicitly.

## Packaging Notes

GlialNode is packaged as both a library and a CLI:

- the library entrypoint is exposed through the package root export
- the CLI entrypoint is exposed through the `glialnode` bin and `./cli` export
- the compiled CLI keeps a Unix shebang so installed package binaries work cleanly across Windows, Linux, and macOS tooling

`npm run pack:check` rebuilds the project, runs `npm pack --dry-run --json`, and validates that the tarball includes the public build artifacts without bundling compiled tests.

## CLI Examples

```bash
glialnode space create --name "Team Memory"
glialnode status
glialnode scope add --space-id <space-id> --type agent --label planner
glialnode memory add --space-id <space-id> --scope-id <scope-id> --scope-type agent --tier mid --kind decision --content "Prefer lexical retrieval first."
glialnode memory add --space-id <space-id> --scope-id <scope-id> --scope-type agent --tier mid --kind decision --content "Prefer lexical retrieval first." --compact-content "U:req retrieval=lexical_first"
glialnode memory search --space-id <space-id> --text lexical
glialnode memory search --space-id <space-id> --text lexical --reinforce --reinforce-limit 2 --reinforce-strength 1.5
glialnode memory recall --space-id <space-id> --text lexical --limit 1 --support-limit 3
glialnode event add --space-id <space-id> --scope-id <scope-id> --scope-type agent --actor-type agent --actor-id planner-1 --event-type decision_made --summary "Recorded a durable design choice."
glialnode memory promote --record-id <record-id>
glialnode memory archive --record-id <record-id>
glialnode link add --space-id <space-id> --from-record-id <record-a> --to-record-id <record-b> --type derived_from
glialnode memory show --record-id <record-b>
glialnode memory compact --space-id <space-id>
glialnode memory compact --space-id <space-id> --apply
glialnode memory decay --space-id <space-id>
glialnode memory decay --space-id <space-id> --apply
glialnode memory reinforce --record-id <record-id> --strength 2 --reason manual-confirmation
glialnode space configure --id <space-id> --settings "{\"compaction\":{\"shortPromoteImportanceMin\":0.95}}"
glialnode space configure --id <space-id> --distill-min-cluster-size 3 --distill-min-token-overlap 3
glialnode space configure --id <space-id> --distill-supersede-sources false
glialnode space configure --id <space-id> --conflict-enabled true --conflict-min-token-overlap 3 --conflict-confidence-penalty 0.2
glialnode space configure --id <space-id> --decay-enabled true --decay-min-age-days 7 --decay-confidence-per-day 0.02 --decay-freshness-per-day 0.03
glialnode space configure --id <space-id> --reinforcement-enabled true --reinforcement-confidence-boost 0.05 --reinforcement-freshness-boost 0.1
glialnode space configure --id <space-id> --retention-short-days 7 --retention-mid-days 30
glialnode space report --id <space-id>
glialnode space maintain --id <space-id>
glialnode space maintain --id <space-id> --apply
glialnode memory retain --space-id <space-id>
glialnode memory retain --space-id <space-id> --apply
glialnode export --space-id <space-id> --output ./exports/team-memory.json
glialnode import --input ./exports/team-memory.json
```

## Comparison

GlialNode is closest to a memory-management layer, not just a context cache.

- use it when you want memory spaces, lifecycle policy, provenance, and inspectable state
- pair it with other context-window tools when you also need aggressive transcript compression
- grow out of SQLite later if concurrency or scale becomes the primary concern

## Current Limitations

- SQLite now uses WAL and a busy timeout by default, but it is still best treated as local single-writer infrastructure
- retrieval is lexical-first; semantic retrieval is not implemented yet
- policy is explicit and heuristic-driven; it is not model-driven
- the extra PowerShell demo script remains Windows-oriented; use `npm run demo` for the portable path

## Publishing Checklist

- `npm run check`
- `npm run test`
- `npm run demo`
- `npm run demo:client`
- `npm run pack:check`
- review `README.md`, `CHANGELOG.md`, and `docs/architecture.md`
- review `docs/launch-checklist.md`
- follow `docs/publish-guide.md` for the first push

## Project Files

- `assets/glialnode-banner.svg`: repository banner
- `assets/glialnode-mark.svg`: project mark
- `LICENSE`: MIT license
- `CODE_OF_CONDUCT.md`: collaboration expectations
- `CONTRIBUTING.md`: contributor workflow and expectations
- `CHANGELOG.md`: release notes
- `SECURITY.md`: security reporting guidance
- `.github/workflows/ci.yml`: GitHub Actions verification workflow
- `docs/publish-guide.md`: first-publish handoff steps
- `scripts/demo.mjs`: cross-platform end-to-end demo flow for Windows, Linux, and macOS
- `scripts/client-demo.mjs`: cross-platform end-to-end client API demo flow
- `scripts/demo.ps1`: end-to-end local demo flow
