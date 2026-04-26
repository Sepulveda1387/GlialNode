# Execution Context Routing Memory

GlialNode V2.08 introduces a local, privacy-first model for remembering which execution context worked for recurring task patterns. This is not semantic memory and it must not store prompts, raw task text, command output, request bodies, response bodies, secrets, or memory content.

## Goal

The routing memory should help an agent answer:

- Which skills or tools were useful for this kind of task?
- Which tools were skipped because they were noisy, expensive, or unnecessary?
- What should be read first next time?
- Did the previous route succeed, partially succeed, fail, or become stale?
- How much local/tool/token overhead did the path use?

It should recommend and explain. It must not force tool choices.

## Privacy Contract

Execution-context records store a task fingerprint, not raw task text. The fingerprint is produced by `createExecutionContextTaskFingerprint(...)`, which normalizes the task locally and stores only a SHA-256 digest plus a small feature count.

Forbidden stored fields include:

- `taskText`
- `promptText`
- `completionText`
- `memoryContent`
- `requestBody`
- `responseBody`
- `commandOutput`
- `apiKey`
- `secret`

Use `assertNoForbiddenExecutionContextFields(...)` and `assertExecutionContextRecord(...)` before persisting or exchanging execution-context records.

## Public Contract

```ts
import {
  createExecutionContextTaskFingerprint,
  createExecutionContextRecord,
  createExecutionOutcomeRecord,
  recommendExecutionContext,
  assertExecutionContextRecord,
} from "glialnode";
```

Example:

```ts
const taskFingerprint = createExecutionContextTaskFingerprint({
  taskText: "Fix a failing dashboard CLI test",
  scope: { repoId: "GlialNode" },
  features: ["typescript", "cli", "dashboard"],
});

const record = createExecutionContextRecord({
  taskFingerprint,
  scope: { repoId: "GlialNode" },
  selectedSkills: ["typescript"],
  selectedTools: ["functions.shell_command", "functions.apply_patch"],
  skippedTools: ["web.run"],
  firstReads: ["docs/live-roadmap.gnl.md", "src/cli/commands.ts"],
  outcome: {
    state: "success",
    latencyMs: 1234,
    toolCallCount: 5,
    inputTokens: 1200,
    outputTokens: 400,
    notes: ["Local tests were sufficient; no browser or web lookup needed."],
  },
  confidence: "high",
});

assertExecutionContextRecord(record);
```

Recommendation example:

```ts
const recommendation = recommendExecutionContext({
  taskText: "Fix a failing dashboard CLI test",
  scope: { repoId: "GlialNode" },
  features: ["typescript", "cli", "dashboard"],
  availableSkills: ["typescript"],
  availableTools: ["functions.shell_command", "functions.apply_patch"],
  availableFirstReads: ["docs/live-roadmap.gnl.md", "src/cli/commands.ts"],
  records: [record],
});

console.log(recommendation.selectedTools);
console.log(recommendation.explanations);
```

Recommendations are advisory. They include `warnings` when previous records are expired or when a previously useful skill, tool, or first-read path is unavailable in the current runtime.

Freshness/degrade behavior:

- `availabilityDiff.unavailableSkills` lists previously useful skills that are not present in `availableSkills`.
- `availabilityDiff.unavailableTools` lists previously useful tools that are not present in `availableTools`.
- `availabilityDiff.unavailableFirstReads` lists previously useful first-read paths that are not present in `availableFirstReads`.
- `availabilityDiff.driftedRecommendationCount` counts unavailable recommendations.
- `fallbackToNormalDiscovery=true` means matching records existed but no useful current recommendation survived, or no matching non-expired records existed.
- Confidence is lowered when the previous route no longer matches the current tool/skill/path inventory.

Outcome persistence example:

```ts
const outcome = await client.recordExecutionOutcome({
  taskText: "Fix a failing dashboard CLI test",
  scope: { repoId: "GlialNode" },
  features: ["typescript", "cli", "dashboard"],
  selectedTools: ["functions.shell_command", "functions.apply_patch"],
  skippedTools: ["web.run"],
  firstReads: ["docs/live-roadmap.gnl.md", "src/cli/commands.ts"],
  outcome: {
    state: "success",
    latencyMs: 1234,
    toolCallCount: 5,
    inputTokens: 1200,
    outputTokens: 400,
  },
  confidence: "high",
});

const records = await client.listExecutionContextRecords({
  fingerprintHash: outcome.taskFingerprint.hash,
});
```

`recordExecutionOutcome(...)` accepts raw `taskText` only long enough to compute the local fingerprint. The stored SQLite row contains the fingerprint, scope IDs, selected/skipped tool names, first-read paths, outcome state, latency/tool-call/token counters, confidence, and retention timestamps.

CLI JSON:

```bash
glialnode execution-context recommend \
  --task "Fix a failing dashboard CLI test" \
  --repo-id GlialNode \
  --features typescript,cli,dashboard \
  --available-skills typescript \
  --available-tools functions.shell_command,functions.apply_patch \
  --available-first-reads docs/live-roadmap.gnl.md,src/cli/commands.ts \
  --records execution-context-records.json \
  --json
```

The CLI can read records from a local JSON array or `{ "records": [...] }` object. Passing `--metrics-db` also reads non-expired execution-context outcomes from the metrics SQLite database.

Outcome recording:

```bash
glialnode execution-context record-outcome \
  --task "Fix a failing dashboard CLI test" \
  --repo-id GlialNode \
  --features typescript,cli,dashboard \
  --selected-tools functions.shell_command,functions.apply_patch \
  --skipped-tools web.run \
  --first-reads docs/live-roadmap.gnl.md,src/cli/commands.ts \
  --outcome success \
  --tool-call-count 5 \
  --input-tokens 1200 \
  --output-tokens 400 \
  --metrics-db .glialnode/glialnode.metrics.sqlite \
  --json
```

Outcome listing:

```bash
glialnode execution-context list-outcomes \
  --repo-id GlialNode \
  --metrics-db .glialnode/glialnode.metrics.sqlite \
  --json
```

## Retention

The default retention window is 30 days. Callers can provide `retentionDays` when creating a record. Short retention is intentional because tool inventories, skill names, repo layout, and project conventions can change quickly.

Long-lived recommendations should be earned by repeated successful outcomes, not by keeping a stale route forever.

## V2.08 Implementation Order

1. Define the execution-context model, validation, privacy rules, and retention policy. Complete.
2. Add a recommendation API that accepts task text and available tools/skills, but returns only explainable metadata. Complete for the pure API and CLI JSON.
3. Add outcome recording to metrics storage without raw text. Complete for API, client, SQLite, CLI, docs, and tests.
4. Surface routing efficiency in the dashboard after outcome telemetry exists.
5. Add freshness/degrade behavior when skills, MCP tools, repo paths, or project conventions change. Complete for availability diff, stale recommendation warnings, confidence degradation, normal-discovery fallback, CLI JSON, docs, and tests.
