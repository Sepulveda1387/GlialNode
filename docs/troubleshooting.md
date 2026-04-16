# Troubleshooting

This guide collects the most common GlialNode operational failures and the fastest way to diagnose them.

## SQLite Lock Contention

Symptoms:

- `database is locked`
- `SQLITE_BUSY`
- writes fail under concurrent local activity

What it means:

- GlialNode v1 is still a local single-writer system by default
- WAL and busy timeout reduce immediate failures, but they do not create a distributed multi-writer contract

What to check:

- run `glialnode status`
- confirm the reported `writeMode`
- confirm whether multiple local processes are trying to mutate the same database at once

What to do:

- prefer one owning writer process
- if your host already serializes writes locally, use `writeMode=serialized_local`
- if you need stronger multi-process behavior, treat it as a next-layer coordination problem, not a SQLite toggle

## Snapshot Import Fails

Symptoms:

- `Unsupported space snapshot format`
- `Space snapshot checksum verification failed`
- `Space snapshot signature verification failed`

What it means:

- the snapshot is either incompatible, corrupted, or has been modified after export

What to check:

- inspect how the snapshot was produced
- check whether it is a legacy unversioned export or a versioned snapshot
- confirm the file was not edited after export
- if signed, confirm the signer metadata and trust settings match your workflow

What to do:

- re-export the snapshot from the source system
- prefer signed exports for snapshots that move between machines or teams
- use `glialnode import --json ...` to inspect validation output more easily

## Anchored Trust Validation Fails

Symptoms:

- `Snapshot trust profile 'anchored' requires trusted signers or allowed signer key ids`
- `Preset bundle trust validation failed`
- `Trusted signer is revoked`

What it means:

- the artifact is not signed by a currently trusted anchor under the selected policy

What to check:

- list anchors with `glialnode preset trust-list`
- inspect a specific anchor with `glialnode preset trust-show --name <anchor>`
- confirm the trust profile you selected is the one you intended

What to do:

- register the expected signer as a trusted anchor
- rotate or replace revoked anchors intentionally
- do not weaken trust policy just to force an import unless that is a conscious operational decision

## Signer Or Key Rotation Confusion

Symptoms:

- old bundles or snapshots stop validating after a trust change
- anchors exist, but imports still fail

What it means:

- the active signer key id no longer matches the artifact you are validating

What to check:

- compare artifact signer key id with the trusted signer record
- confirm whether the trust anchor was rotated or revoked after the artifact was produced

What to do:

- keep a clear signing/rotation record
- distinguish current anchors from historical artifacts
- re-export artifacts with the new signer if they are meant to remain current

## Search Or Recall Misses Expected Memory

Symptoms:

- expected memory does not appear in search
- recall feels too narrow or too broad

What it means:

- lexical retrieval, status filtering, supersession, or bundle pruning may be shaping the result set

What to check:

- verify the query text
- verify record status and scope
- verify whether the record is active, archived, superseded, or expired
- inspect with `memory show`, `memory search`, `memory trace`, and `memory bundle`

What to do:

- search with a more literal phrase first
- include status filters if you expect non-active memory
- use reviewer-oriented bundles when you want more provenance and supporting context

## Key Material Safety Questions

Symptoms:

- concern that CLI output may reveal secret material
- uncertainty about local file handling

What it means:

- the key registry stores private material locally under `.keys`
- trusted public anchors live under `.trusted`

What to check:

- inspect the local files directly, not command output
- confirm `.keys` is excluded from Git and protected by OS-level permissions

What to do:

- rely on key files, not pasted PEM in shells or docs
- use exported public keys for sharing
- remember that GlialNode key-management commands avoid echoing PEM material in normal output

## When To Escalate Beyond V1

Consider a deeper storage or coordination layer if you need:

- high-concurrency multi-process writes
- cross-machine coordination over one live database
- hosted policy enforcement beyond local trust registries
- semantic retrieval or vector-first ranking
