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
- `space show`
- `space report`
- `space graph-export`
- `memory search`
- `memory recall`
- `memory trace`
- `memory bundle`
- `preset bundle-show`
- `preset bundle-import`
- `import --preview`
