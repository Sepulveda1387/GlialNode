# Space Graph Export

GlialNode can export a space as graph-shaped JSON for topology inspection, provenance tracing, and downstream graph tooling.

## CLI

```bash
glialnode space graph-export --id <space-id> --json
glialnode space graph-export --id <space-id> --output ./exports/space.graph.json
glialnode space graph-export --id <space-id> --format cytoscape --output ./exports/space.graph.cytoscape.json
glialnode space graph-export --id <space-id> --format dot --output ./exports/space.graph.dot
glialnode space graph-export --id <space-id> --include-events false --include-scopes false --json
```

## Client API

```ts
const graph = await client.exportSpaceGraph(spaceId, {
  includeScopes: true,
  includeEvents: true,
});

const cytoscape = await client.exportSpaceGraphCytoscape(spaceId);
const dot = await client.exportSpaceGraphDot(spaceId);

await client.exportSpaceGraphToFile(spaceId, "./exports/space.graph.json");
await client.exportSpaceGraphToFile(spaceId, "./exports/space.graph.cytoscape.json", { format: "cytoscape" });
await client.exportSpaceGraphToFile(spaceId, "./exports/space.graph.dot", { format: "dot" });
```

## Formats

- `native` (default): GlialNode node/edge schema
- `cytoscape`: `{ metadata, counts, elements: { nodes, edges } }`
- `dot`: Graphviz DOT text

## Output Shape

`metadata`:

- `schemaVersion`: currently `1`
- `exportedAt`
- `spaceId`
- `spaceName`
- `nodeCount`
- `edgeCount`
- `options.includeScopes`
- `options.includeEvents`

`counts`:

- `scopes`
- `events`
- `records`
- `links`

`nodes`:

- `space` node
- optional `scope` nodes
- `record` nodes
- optional `event` nodes

`edges`:

- `contains_scope`
- `contains_record`
- `contains_event`
- `scope_parent`
- `record_link`
- `source_event`

## Notes

- This export is additive and designed to be machine-friendly.
- `record_link` edges preserve GlialNode link relation (`supports`, `derived_from`, `contradicts`, etc.).
- `source_event` edges connect records back to their `sourceEventId` when present.
