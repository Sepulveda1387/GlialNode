# Launch Checklist

## Before First Public Push

- confirm `README.md` reflects the current CLI surface
- review `docs/live-roadmap.gnl.md` and confirm all `V1/P0` items are either `D` or consciously deferred
- run `npm run check`
- run `npm test`
- run `npm run demo`
- run `npm run demo:dashboard`
- run `npm run pack:check`
- review `CHANGELOG.md`
- review `docs/operator-guide.md`
- review `docs/compatibility.md`
- review `docs/json-contract.md`
- review `docs/decision-notes.md`
- review `docs/graph-export.md`
- review `docs/storage-backends.md`
- review `docs/release-readiness.md`
- review `docs/trust-packs.md`
- review `docs/troubleshooting.md`
- run `glialnode status --json --json-envelope` and verify `schemaVersion` is present
- run `glialnode release readiness --tests-green true --pack-green true --demo-green true --docs-reviewed true --tree-clean true --user-approved true --json` only after those confirmations are actually true
- follow `docs/publish-guide.md`
- review `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`
- confirm `.gitignore` excludes local demo artifacts

## GitHub Setup

- create the repository description
- add repository topics such as `memory`, `agents`, `sqlite`, `typescript`, `fts5`
- enable Actions
- verify the `CI` workflow passes on the default branch
- add the project banner or screenshot to the repo page if desired

## First Release Notes

- summarize the core architecture
- call out current limitations
- mention that `node:sqlite` is still experimental in Node 24
- explain that GlialNode is SQLite-first and lexical-first in v1

## Suggested Repo Description

`Tiered memory infrastructure for orchestrators, agents, and subagents.`

## Suggested Topics

- `agents`
- `memory`
- `sqlite`
- `typescript`
- `fts5`
- `cli`
- `multi-agent`
