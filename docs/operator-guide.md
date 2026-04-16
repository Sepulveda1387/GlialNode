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

For a stricter restore that requires a signed snapshot from a trusted anchor:

```bash
glialnode preset trust-local-key --name ops-snapshot-key --trust-name ops-anchor
glialnode import --input ./exports/space.snapshot.json --trust-profile anchored --trust-signer ops-anchor
```

If you want machine-readable output during restore:

```bash
glialnode import --input ./exports/space.snapshot.json --trust-profile anchored --trust-signer ops-anchor --json
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

## Operational Notes

- SQLite remains a local single-writer or host-serialized-local system in v1
- snapshots are for portability and recovery, not concurrent multi-writer coordination
- verify snapshots before destructive restore or migration steps
- prefer restoring into a new database path first, then validating memory/search behavior

## Post-Restore Verification

After import, verify the destination explicitly:

```bash
glialnode space report --id <space-id>
glialnode memory search --space-id <space-id> --text "<known phrase>"
glialnode status
```

If the restored snapshot will be used by automation:

- confirm trust profile expectations
- confirm preset/trusted signer directories are present where needed
- confirm the runtime still matches your operational Node version policy
