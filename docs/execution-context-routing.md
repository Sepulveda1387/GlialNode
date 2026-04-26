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

## Retention

The default retention window is 30 days. Callers can provide `retentionDays` when creating a record. Short retention is intentional because tool inventories, skill names, repo layout, and project conventions can change quickly.

Long-lived recommendations should be earned by repeated successful outcomes, not by keeping a stale route forever.

## V2.08 Implementation Order

1. Define the execution-context model, validation, privacy rules, and retention policy. Complete.
2. Add a recommendation API that accepts task text and available tools/skills, but returns only explainable metadata.
3. Add outcome recording to metrics storage without raw text.
4. Surface routing efficiency in the dashboard after outcome telemetry exists.
5. Add freshness/degrade behavior when skills, MCP tools, repo paths, or project conventions change.
