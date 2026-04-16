# Launch Checklist

## Before First Public Push

- confirm `README.md` reflects the current CLI surface
- review `docs/live-roadmap.gnl.md` and confirm all `V1/P0` items are either `D` or consciously deferred
- run `npm run check`
- run `npm run test`
- run `npm run demo`
- review `CHANGELOG.md`
- review `docs/operator-guide.md`
- review `docs/compatibility.md`
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
