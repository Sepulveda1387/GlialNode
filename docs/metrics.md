# Metrics And Token Usage

GlialNode metrics are intentionally stored outside semantic memory. The default metrics database lives beside the memory database:

- Memory database: `.glialnode/glialnode.sqlite`
- Metrics database: `.glialnode/glialnode.metrics.sqlite`

This keeps high-volume token, cost, and latency telemetry separate from memory records, snapshots, and recall content.

## Privacy Contract

Token usage metrics must not store prompts, completions, memory content, request bodies, response bodies, API keys, or secret values.

The API and CLI reject raw-text field names such as:

- `promptText`
- `completionText`
- `memoryContent`
- `rawText`
- `requestBody`
- `responseBody`
- `apiKey`
- `secretValue`

Allowed metric fields are numeric usage/cost signals, stable IDs, operation names, model/provider labels, scalar dimensions, and timestamps.

## Client API

```ts
import { GlialNodeClient } from "glialnode";

const client = new GlialNodeClient({
  filename: ".glialnode/glialnode.sqlite",
  metrics: {
    filename: ".glialnode/glialnode.metrics.sqlite",
  },
});

await client.recordTokenUsage({
  spaceId: "space_123",
  agentId: "agent_planner",
  operation: "memory.recall",
  provider: "openai",
  model: "gpt-example",
  baselineTokens: 1200,
  actualContextTokens: 430,
  glialnodeOverheadTokens: 30,
  inputTokens: 460,
  outputTokens: 120,
  latencyMs: 42,
});

const report = await client.getTokenUsageReport({
  spaceId: "space_123",
  granularity: "day",
  costModel: {
    currency: "USD",
    provider: "openai",
    model: "gpt-example",
    inputCostPerMillionTokens: 2,
    outputCostPerMillionTokens: 8,
  },
});
```

## CLI

Record usage from a host app or script:

```bash
glialnode metrics token-record \
  --operation memory.recall \
  --provider openai \
  --model gpt-example \
  --baseline-tokens 1200 \
  --actual-context-tokens 430 \
  --glialnode-overhead-tokens 30 \
  --input-tokens 460 \
  --output-tokens 120 \
  --latency-ms 42 \
  --metrics-db .glialnode/glialnode.metrics.sqlite \
  --json
```

Report aggregate token ROI:

```bash
glialnode metrics token-report \
  --granularity day \
  --input-cost-per-million 2 \
  --output-cost-per-million 8 \
  --metrics-db .glialnode/glialnode.metrics.sqlite \
  --json
```

Build a dashboard snapshot from memory plus metrics:

```bash
glialnode dashboard overview \
  --metrics-db .glialnode/glialnode.metrics.sqlite \
  --granularity day \
  --json
```

Supported report granularities:

- `day`
- `week`
- `month`
- `all`

Supported filters:

- `spaceId`
- `scopeId`
- `agentId`
- `projectId`
- `workflowId`
- `operation`
- `provider`
- `model`
- `from`
- `to`

## Field Reference

| Field | Required | Meaning |
| --- | --- | --- |
| `operation` | yes | Stable host-app operation name, for example `memory.recall` |
| `model` | yes | Model label reported by the host app |
| `inputTokens` | yes | Actual provider input tokens |
| `outputTokens` | yes | Actual provider output tokens |
| `baselineTokens` | no | Estimated tokens for the same operation without GlialNode |
| `actualContextTokens` | no | Actual context tokens supplied after GlialNode memory selection |
| `glialnodeOverheadTokens` | no | Extra tokens added by GlialNode framing/citations |
| `estimatedSavedTokens` | no | Explicit saved token estimate, otherwise derived when possible |
| `estimatedSavedRatio` | no | Explicit ratio, otherwise derived when possible |
| `latencyMs` | no | Host-observed latency in milliseconds |
| `costCurrency` | no | Currency for recorded cost values |
| `inputCost` | no | Host-recorded input cost |
| `outputCost` | no | Host-recorded output cost |
| `totalCost` | no | Host-recorded total cost |
| `dimensions` | no | Scalar labels only: string, number, boolean, or null |

## Backup Notes

Back up the metrics database separately from memory snapshots:

- Memory snapshots remain portable semantic artifacts.
- Metrics database backups are local operational telemetry artifacts.
- If metrics are not needed for a deployment, configure `metrics: { disabled: true }` in the client.
- Do not merge metrics rows into memory snapshots unless a future explicit export format defines that boundary.

## Anti-Examples

Do not record:

```ts
await client.recordTokenUsage({
  operation: "chat.reply",
  model: "gpt-example",
  inputTokens: 100,
  outputTokens: 20,
  promptText: "Private user text",
});
```

Do not hide raw text inside dimensions:

```ts
await client.recordTokenUsage({
  operation: "memory.recall",
  model: "gpt-example",
  inputTokens: 100,
  outputTokens: 20,
  dimensions: {
    memoryContent: "Private memory text",
  },
});
```
