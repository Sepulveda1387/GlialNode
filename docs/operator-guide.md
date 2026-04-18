# Operator Guide

This guide collects the safest day-to-day workflows for exporting, validating, importing, backing up, and trusting GlialNode data.

## Snapshot Basics

GlialNode full-space snapshots now carry:

- `snapshotFormatVersion`
- `glialnodeVersion`
- `nodeEngine`
- `checksumAlgorithm`
- `checksum`
- optional signing metadata and signature

That means snapshot portability is no longer "raw JSON only." Imports can now reject corrupted or incompatible files before writing them into a database.

## Diagnostics First

Before backup, restore, or trust changes, run:

```bash
glialnode doctor
```

For automation or CI-style verification, prefer:

```bash
glialnode doctor --json
```

The doctor report checks:

- SQLite runtime hardening state
- applied vs latest schema version
- database path and WAL sidecars
- preset registry path
- signing-key store path and file counts
- trusted-signer store path, file counts, and revoked-anchor count
- common path-sanity problems such as a store path being a file instead of a directory

If `doctor` reports `status=attention`, inspect the warnings before you proceed with import, export, rotation, or restore workflows.

## Recommended Backup Flow

For a normal local backup:

```bash
glialnode export --space-id <space-id> --output ./exports/space.snapshot.json
```

For a signed backup using a local signing key:

```bash
glialnode preset keygen --name ops-snapshot-key --signer "Ops Team"
glialnode export --space-id <space-id> --output ./exports/space.snapshot.json --origin local-backup --signing-key ops-snapshot-key
```

Recommended habits:

- write snapshots to a dedicated backup directory
- keep multiple dated copies instead of one rolling file
- sign snapshots that cross machine or team boundaries
- treat signed snapshots as portable artifacts, not mutable working files

## Recommended Restore Flow

For a straightforward local restore:

```bash
glialnode import --input ./exports/space.snapshot.json
```

For a no-write dry-run preview (counts, conflicts, schema/trust status):

```bash
glialnode import --input ./exports/space.snapshot.json --preview --json
```

If the target space already exists and you want an explicit duplicate instead of a hard failure:

```bash
glialnode import --input ./exports/space.snapshot.json --collision rename
```

If you intentionally want to restore over the existing ids:

```bash
glialnode import --input ./exports/space.snapshot.json --collision overwrite
```

For a stricter restore that requires a signed snapshot from a trusted anchor:

```bash
glialnode preset trust-local-key --name ops-snapshot-key --trust-name ops-anchor
glialnode import --input ./exports/space.snapshot.json --trust-profile anchored --trust-signer ops-anchor
```

If you want machine-readable output during restore:

```bash
glialnode import --input ./exports/space.snapshot.json --trust-profile anchored --trust-signer ops-anchor --json
```

Collision policy rules:

- default is `error`
- use `overwrite` only when you mean to reuse the imported ids
- use `rename` when you want a second imported copy to coexist safely
- use `--preview` first when restore risk is unclear or automation is about to apply changes

Preset bundle import follows the same pattern:

```bash
glialnode preset bundle-import --input ./team-executor.bundle.json --collision rename
```

## Compatibility Rules

Current snapshot behavior:

- format `1` snapshots are the current portable format
- GlialNode checks checksum integrity before import
- GlialNode warns when the exporting runtime version or Node engine differ
- unsupported snapshot formats are rejected

Legacy note:

- older unversioned snapshots can still be normalized and imported
- they are treated as legacy imports and do not get checksum verification
- re-export them in the new format if you plan to keep or share them

## Signing Keys And Trusted Anchors

Local signer keys live under the preset directory in:

- `.keys/` for private signing keys
- `.trusted/` for trusted public anchors

Recommended flow:

1. create a local signing key
2. trust that key locally if you want anchored validation
3. use the key for signed exports
4. rotate or revoke trust anchors when needed

Examples:

```bash
glialnode preset keygen --name ops-snapshot-key --signer "Ops Team"
glialnode preset trust-local-key --name ops-snapshot-key --trust-name ops-anchor
glialnode preset trust-list
glialnode preset trust-show --name ops-anchor
```

Rotation / revocation:

```bash
glialnode preset trust-revoke --name ops-anchor
glialnode preset trust-rotate --name ops-anchor --next-name ops-anchor-2026 --input ./ops-anchor-2026.pub.pem
```

## Key-Handling Guidance

GlialNode now writes local key and trust records through an atomic write path.

Best practices:

- treat `.keys/*.json` as secrets
- do not commit `.keys/` to Git
- back up `.keys/` separately from portable snapshots
- share only exported public keys, not the local key JSON file
- keep `.trusted/` under review, because trust anchors are policy, not just data
- normal key-management CLI output does not print PEM material; inspect files directly when needed

Platform notes:

- on Unix-like systems, GlialNode attempts restrictive file modes for private key records
- GlialNode also applies restrictive directory-mode hints to `.keys/` and non-world-writable hints to `.trusted/` where the filesystem supports it
- Windows ACLs still matter; use OS-level account and directory protections
- private key material is never echoed by normal CLI output

## Import Trust Modes

GlialNode currently supports three trust modes for portable artifacts:

- `permissive`: accept unsigned artifacts if compatibility and checksum rules pass
- `signed`: require signer + signature
- `anchored`: require signer + signature + trusted signer anchors

Recommended usage:

- local backup/restore on one machine: `permissive` or `signed`
- cross-machine restore inside one team: `signed`
- shared/team-controlled restore workflows: `anchored`

Trust reports now distinguish:

- which trusted signer names were actually matched by the artifact signer key
- which trusted signer names were requested but unmatched
- which requested signer names were revoked and therefore unusable

For structured failure diagnostics without immediate command failure, use:

```bash
glialnode preset bundle-show --input ./team-executor.bundle.json --allow-origin production --trust-explain --json
```

That output includes policy failures plus requested/matched/unmatched signer-name sets for faster trust-policy debugging.

For reusable team policies, you can also define named trust packs and apply them with `--trust-pack`:

```bash
glialnode preset trust-pack-register --name strict-signed --base-profile signed --allow-origin production
glialnode preset bundle-show --input ./team-executor.bundle.json --trust-pack strict-signed
glialnode import --input ./exports/space.snapshot.json --trust-pack strict-signed
```

Automation can set `GLIALNODE_TRUST_POLICY_PACK=<name>` as a default pack for trust-sensitive CLI flows.

## Trust Lifecycle Verification Drill

Before release or major trust-policy changes, run one explicit revoke/rotate drill:

1. generate a signer key and trust anchor
2. export a signed snapshot
3. rotate the trusted anchor to a new public key
4. verify imports anchored to the revoked name now fail
5. verify imports anchored to the rotated replacement succeed

CLI example:

```bash
glialnode preset keygen --name snapshot-key-v1 --signer "Ops Team"
glialnode preset trust-local-key --name snapshot-key-v1 --trust-name snapshot-anchor
glialnode preset keygen --name snapshot-key-v2 --signer "Ops Team"
glialnode preset key-export --name snapshot-key-v2 --output ./snapshot-key-v2.public.pem
glialnode preset trust-rotate --name snapshot-anchor --input ./snapshot-key-v2.public.pem --next-name snapshot-anchor-v2
glialnode export --space-id <space-id> --output ./space-v2.snapshot.json --signing-key snapshot-key-v2
glialnode import --input ./space-v2.snapshot.json --trust-profile anchored --trust-signer snapshot-anchor-v2 --json
```

Expected behavior:

- revoked anchor names fail with `Trusted signers are revoked: ...`
- replacement anchors validate and import cleanly under `anchored`

## Data Classification

Treat these artifact classes differently during operations:

- `.keys/*.json`: secret private-key material
- `.trusted/*.json`: trust-policy control data
- snapshots and preset bundles: internal portable data that may include sensitive memory content
- memory records/events/summary artifacts: operational data that can include user/project context

Recommended handling:

- keep `.keys/` out of source control and tightly scoped in backups
- share `key-export` outputs (public keys), not local key records
- encrypt/scope backup media that stores snapshots or bundle artifacts

## Operational Notes

- SQLite remains a local single-writer or host-serialized-local system in v1
- snapshots are for portability and recovery, not concurrent multi-writer coordination
- verify snapshots before destructive restore or migration steps
- prefer restoring into a new database path first, then validating memory/search behavior
- if one process may trigger overlapping writes, prefer `writeMode=serialized_local` so writes are queued through one local adapter boundary

## Post-Restore Verification

After import, verify the destination explicitly:

```bash
glialnode space report --id <space-id>
glialnode memory search --space-id <space-id> --text "<known phrase>"
glialnode status
```

The space report now also includes:
- `eventTypes=` aggregated counts by event type
- `provenanceSummaryRecords=` count of durable provenance audit summaries
- `maintenanceLatest*=` timestamps for the most recent maintenance runs
- `maintenance*Delta=` latest maintenance-summary deltas (compaction/retention/decay/reinforcement)

If the restored snapshot will be used by automation:

- confirm trust profile expectations
- confirm preset/trusted signer directories are present where needed
- confirm the runtime still matches your operational Node version policy
