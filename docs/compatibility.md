# Compatibility Policy

GlialNode is currently in the `0.x` phase. That means additive evolution is preferred, but some breaking changes may still happen before `1.0.0`.

This document defines what is versioned today and how to reason about compatibility.

## Versioning Posture

GlialNode follows semver-style release numbers with an important `0.x` caveat:

- patch releases should be safe bugfixes
- minor releases may still include carefully documented breaking changes before `1.0.0`
- whenever a breaking change happens, it should be called out in `CHANGELOG.md` and, when needed, in migration notes

## Compatibility Surface

### TypeScript Client API

Current policy:

- additive APIs are preferred
- existing method signatures should not be broken casually inside the same `0.x` line
- if a breaking API change is unavoidable before `1.0.0`, document it clearly in the changelog

### Human CLI Output

Current policy:

- human-readable CLI output is not a stable machine contract
- wording, ordering, and presentation may change to improve usability

### CLI JSON Output

Current policy:

- `--json` output is the machine-facing CLI contract
- additive fields are allowed
- destructive schema changes should be avoided inside a release line
- if a breaking `--json` contract change is necessary, it must be called out explicitly in the changelog

### SQLite Schema

Current policy:

- GlialNode tracks applied schema versions inside the database
- forward migrations are supported
- downgrade compatibility is not guaranteed
- new runtimes may migrate existing databases; older runtimes should not be assumed to reopen migrated databases safely

### Space Snapshot Format

Current policy:

- full memory snapshots are a versioned portable format
- current format: `snapshotFormatVersion=1`
- imports reject unsupported snapshot format versions
- checksum verification is part of the format contract
- optional signatures and trust validation are layered on top of the base format

Legacy note:

- unversioned historical snapshots may still be imported as legacy data
- legacy imports are warnings-based compatibility, not a long-term stable artifact contract

### Preset Bundle Format

Current policy:

- preset bundles are a separately versioned portable format
- current format: `bundleFormatVersion=1`
- imports reject unsupported bundle format versions
- checksum and optional signatures are part of the bundle portability model

### Trust Profiles

Current policy:

- trust profile names such as `permissive`, `signed`, and `anchored` are part of the operator surface
- new profiles may be added additively
- changing the meaning of an existing trust profile should be treated as a breaking operational change

## What May Still Change Before 1.0

The following areas are still expected to evolve:

- retrieval ranking details
- lifecycle heuristics and policy defaults
- CLI ergonomics and human-readable output
- storage/runtime hardening details
- advanced trust and provenance workflows

## What To Pin For Automation

If you automate around GlialNode, prefer pinning:

- the npm package version
- the Node major/minor runtime you deploy
- snapshot and preset bundle artifact versions
- trusted signer configuration

And prefer consuming:

- `--json` CLI output instead of plain text
- versioned snapshots and preset bundles instead of ad hoc JSON
