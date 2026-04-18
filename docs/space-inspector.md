# Space Inspector Export

`space inspect-export` generates a standalone, read-only HTML artifact for one space.

It is designed for quick operator review without a live GlialNode runtime UI.

## CLI Usage

```bash
glialnode space inspect-export \
  --id <space-id> \
  --output ./exports/space.inspector.html
```

To export the same payload as machine-friendly JSON:

```bash
glialnode space inspect-snapshot \
  --id <space-id> \
  --output ./exports/space.inspector.snapshot.json
```

Optional flags:

- `--recent-events <n>`: number of recent lifecycle/provenance events to include (default `20`)
- `--include-scopes true|false`: include scope nodes in graph snapshot (default `true`)
- `--include-events true|false`: include event nodes in graph snapshot (default `true`)
- `--include-trust-registry true|false`: include trusted signer + trust-pack registry snapshot (default `true`)
- `--directory <path>`: preset/trust directory to resolve trust registry from (defaults to client/CLI preset path)
- `--json`: emit machine-readable export metadata (output path, counts, and inclusion status)
- `--query-text <text>` and query filters (`--query-scope-id`, `--query-tier`, `--query-kind`, `--query-visibility`, `--query-status`): include recall traces/bundles in the inspector artifact
- `--query-limit <n>` and `--query-support-limit <n>`: tune recall preview size
- `--query-bundle-consumer` and `--query-bundle-provenance-mode`: shape preview bundles for planner/executor/reviewer needs

## What The HTML Contains

- space identity and summary counts
- effective policy + origin map (space-set vs default/unset)
- report data (event type counts, maintenance deltas, recent lifecycle/provenance events)
- graph topology snapshot (`space/scope/record/event` nodes + edges)
- trust registry snapshot (trusted signers and trust policy packs when enabled)
- optional recall preview snapshot (trace + bundle payloads for a provided query)
- risk summary (`low|moderate|high`) derived from contested/decayed activity, trust review posture, and maintenance recency

## Multi-Space Index Export

Use `inspect-index-export` when you want one artifact summarizing all spaces:

```bash
glialnode space inspect-index-export \
  --output ./exports/space-inspector-index.html
```

For JSON snapshot output:

```bash
glialnode space inspect-index-snapshot \
  --output ./exports/space-inspector-index.snapshot.json
```

Optional flags:

- `--recent-events <n>`: report event window used per space (default `10`)
- `--include-graph-counts true|false`: include per-space graph node/edge counts (default `true`)
- `--include-trust-registry true|false`: include trust registry summary (default `true`)
- `--directory <path>`: preset/trust directory override
- `--json`: machine-readable summary (`spaceCount`, `totals`, `output`)

Index totals include:

- aggregate records/events/links
- aggregate graph node/edge counts (when enabled)
- `spacesNeedingTrustReview`
- `spacesWithContestedMemory`
- `spacesWithStaleMemory`

## Full Inspector Pack Export

Use `inspect-pack-export` to generate a complete review bundle in one directory:

```bash
glialnode space inspect-pack-export \
  --output-dir ./exports/space-inspector-pack
```

Pack output contains:

- `index.html`
- `index.snapshot.json`
- `manifest.json`
- `spaces/<space-name>-<space-id>.html`
- `spaces/<space-name>-<space-id>.snapshot.json`

Useful flags:

- all flags from `inspect-export` and `inspect-index-export`
- `--query-*` filters to include recall previews in each per-space artifact
- `--capture-screenshots true` to capture PNG screenshots of index and per-space HTML artifacts
- `--screenshot-width` / `--screenshot-height` to set screenshot viewport (defaults `1440x900`)
- `--json` for machine-readable manifest location and totals

When screenshot capture is enabled, the pack also includes:

- `index.png`
- `spaces/<space-name>-<space-id>.png`

Note: screenshot capture requires the `playwright` package at runtime.

## Live Serve Inspector Packs

Use `inspect-pack-serve` to run a temporary local HTTP server for an exported pack directory:

```bash
glialnode space inspect-pack-serve \
  --input-dir ./exports/space-inspector-pack \
  --duration-ms 60000 \
  --port 4173 \
  --probe-path /index.html
```

Options:

- `--duration-ms <n>` required, server lifetime before auto-shutdown
- `--host <host>` bind host (default `127.0.0.1`)
- `--port <n>` bind port (`0` allowed for auto-port)
- `--probe-path <path>` optional in-process HTTP probe reported in command output/json

This mode is useful for quick local review sessions or CI validation that exported inspector packs are servable.

## Programmatic API

Use the client when host apps need to generate inspector artifacts:

```ts
const result = await client.exportSpaceInspectorHtml(spaceId, "./exports/space.inspector.html", {
  recentEventLimit: 30,
  includeTrustRegistry: true,
  recall: {
    query: { text: "trust drift", limit: 2 },
    primaryLimit: 2,
    supportLimit: 2,
    bundleConsumer: "reviewer",
  },
});
```

If you need the raw model first:

```ts
const snapshot = await client.buildSpaceInspectorSnapshot(spaceId, {
  includeScopes: true,
  includeEvents: true,
  includeTrustRegistry: true,
});
```

`snapshot.metadata.schemaVersion` is currently `1`.

For multi-space summaries:

```ts
await client.exportSpaceInspectorIndexHtml("./exports/space-inspector-index.html", {
  recentEventLimit: 10,
  includeGraphCounts: true,
  includeTrustRegistry: true,
});
```

And for raw JSON artifacts:

```ts
await client.exportSpaceInspectorSnapshotToFile(spaceId, "./exports/space.inspector.snapshot.json");
await client.exportSpaceInspectorIndexSnapshotToFile("./exports/space-inspector-index.snapshot.json");
await client.exportSpaceInspectorPack("./exports/space-inspector-pack");
```
