# Publish Guide

This guide assumes GlialNode is being published for the first time from the current local repository.

## 1. Final Local Verification

Run the standard checks:

```bash
npm run check
npm run test
npm run demo
```

## 2. Review What Will Be Committed

Confirm the working tree only contains the files you want in the first public release:

```bash
git status --short
```

Expected top-level areas include:

- `.github/`
- `assets/`
- `docs/`
- `scripts/`
- `src/`
- root docs such as `README.md`, `LICENSE`, and `CHANGELOG.md`

## 3. Make The First Commit

Stage the initial release:

```bash
git add .
git commit -m "Initial public release"
```

If Git user identity is not configured yet:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

## 4. Create The GitHub Repository

Create a new empty GitHub repository named `GlialNode`.

Suggested settings:

- visibility: public
- initialize with README: no
- initialize with `.gitignore`: no
- initialize with license: no

The local repo already contains those files.

## 5. Connect The Remote

Replace the placeholder URL with your actual repository URL:

```bash
git remote add origin https://github.com/<your-account>/GlialNode.git
```

Confirm the remote:

```bash
git remote -v
```

## 6. Push The First Branch

If you want the default branch to be `main`:

```bash
git branch -M main
git push -u origin main
```

## 7. Verify GitHub Setup

After the first push:

- confirm the README renders correctly
- confirm the banner and Mermaid diagram display as expected
- confirm the `CI` workflow runs
- confirm the issue templates and PR template appear
- review `docs/operator-guide.md`, `docs/compatibility.md`, `docs/json-contract.md`, `docs/decision-notes.md`, `docs/graph-export.md`, and `docs/trust-packs.md`
- run `glialnode status --json --json-envelope` and verify `schemaVersion`
- set the repo description and topics from `docs/launch-checklist.md`

## 8. Optional First Tag

If you want to tag the initial release immediately:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 9. Suggested Initial Release Notes

You can use this as a starting point for the first GitHub release:

```text
GlialNode 0.1.0 is the first public release of a SQLite-first memory system for orchestrators, agents, and subagents.

Highlights:
- tiered memory spaces with scoped records, events, and provenance links
- lexical retrieval with SQLite FTS5
- lifecycle workflows for promote, archive, compaction, retention, and maintenance
- reporting, import/export, and a demo flow

Current limitations:
- SQLite is currently best suited for local single-writer usage
- semantic retrieval is not implemented yet
- Node's built-in sqlite module is still experimental in Node 24
```

## 10. After Publishing

Recommended follow-up work:

- create the first GitHub release page
- add one screenshot of the report output if desired
- decide whether to keep using the PowerShell-first demo or add a cross-platform demo path
- start collecting feedback through issues instead of local notes
