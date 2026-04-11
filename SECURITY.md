# Security Policy

## Supported Versions

GlialNode is early-stage software. Security fixes should target the current mainline codebase.

## Reporting

If you discover a security issue, please avoid opening a public issue with exploit details.

Instead, report it privately to the project maintainer with:

- a short description of the issue
- affected files or commands
- reproduction steps
- expected impact

If private reporting infrastructure is not available yet, open a minimal public issue that states a security concern exists without disclosing sensitive details.

## Scope Notes

Current areas worth extra scrutiny:

- SQLite file handling and local persistence paths
- import and export flows
- CLI parsing of JSON settings and payloads
- future concurrency changes around maintenance workflows
