# CLI JSON Contract

GlialNode has two machine-readable CLI JSON modes:

- `--json`: command payload only (backward-compatible default)
- `--json --json-envelope`: versioned envelope for automation contracts

## Envelope Contract

When `--json-envelope` is set alongside `--json`, GlialNode emits:

```json
{
  "schemaVersion": "1.0.0",
  "command": "memory bundle",
  "generatedAt": "2026-04-17T15:04:05.000Z",
  "data": {}
}
```

Field semantics:

- `schemaVersion`: JSON envelope contract version for automation parsing
- `command`: normalized command path (`resource` or `resource action`)
- `generatedAt`: ISO-8601 UTC timestamp for response generation
- `data`: the same payload that `--json` returns without envelope mode

## Stability Policy

- `schemaVersion=1.0.0` is stable for the v1 line.
- Additive fields inside `data` are allowed.
- Breaking envelope changes require a new `schemaVersion` and changelog callout.
- Human-readable output is not part of the machine contract.

## Current `--json` Command Coverage

- `status`
- `doctor`
- `storage contract`
- `storage migration-plan`
- `release readiness`
- `metrics token-record`
- `metrics token-report`
- `execution-context recommend`
- `execution-context record-outcome`
- `execution-context list-outcomes`
- `dashboard overview`
- `dashboard executive`
- `dashboard space`
- `dashboard agent`
- `dashboard operations`
- `dashboard memory-health`
- `dashboard recall-quality`
- `dashboard trust`
- `dashboard alerts`
- `dashboard routing-efficiency`
- `dashboard export`
- `dashboard serve`
- `space show`
- `space report`
- `space graph-export`
- `space inspect-export`
- `space inspect-snapshot`
- `space inspect-index-export`
- `space inspect-index-snapshot`
- `space inspect-pack-export`
- `space inspect-pack-serve`
- `memory search`
- `memory recall`
- `memory trace`
- `memory bundle`
- `memory semantic-eval`
- `preset bundle-show`
- `preset bundle-import`
- `import --preview`

`--json-envelope` can wrap any command path that uses the shared JSON result helper. New JSON-capable CLI commands should prefer that helper unless they have a documented reason to return a specialized stream or file-only artifact.

## Dashboard And Metrics JSON Notes

Dashboard and metrics JSON payloads are local-first operational telemetry contracts. They must not contain raw prompt text, completion text, private memory content, request bodies, response bodies, API keys, or secret values.

Important additive payload families:

- `metrics token-report`: aggregate token, cost, latency, and saved-token estimates with optional cost model metadata
- `execution-context *`: task fingerprints, selected/skipped tool IDs, first-read paths, outcome counters, confidence labels, and recommendation warnings without raw task text
- `dashboard *`: versioned dashboard snapshots/reports with metric provenance and confidence labels
- `dashboard export`: local artifact metadata; the artifact contents use the export kind contract such as CSV, JSON, or standalone HTML
- `dashboard serve`: startup/probe metadata for a temporary loopback read-only HTTP server
