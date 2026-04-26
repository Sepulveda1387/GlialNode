import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  ValidationError,
  assertExecutionContextRecord,
  assertNoForbiddenExecutionContextFields,
  createExecutionContextRecord,
  createExecutionContextTaskFingerprint,
  recommendExecutionContext,
  type CreateExecutionContextRecordInput,
  type ExecutionContextRecord,
} from "../index.js";

test("execution context fingerprint hashes normalized task text without storing it", () => {
  const first = createExecutionContextTaskFingerprint({
    taskText: "  Fix failing dashboard tests\nwith CLI output. ",
    scope: { repoId: "GlialNode" },
    features: ["TypeScript", " Tests "],
  });
  const second = createExecutionContextTaskFingerprint({
    taskText: "fix failing dashboard tests with cli output.",
    scope: { repoId: "GlialNode" },
    features: ["tests", "typescript"],
  });

  assert.equal(first.method, "sha256_normalized_task_v1");
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.featureCount, 2);
  assert.deepEqual(first, second);
});

test("execution context records normalize routing metadata and retention", () => {
  const fingerprint = createExecutionContextTaskFingerprint({
    taskText: "Implement a CLI dashboard export test.",
    scope: { repoId: "GlialNode" },
    features: ["cli", "dashboard"],
  });

  const record = createExecutionContextRecord({
    taskFingerprint: fingerprint,
    scope: { repoId: "GlialNode", projectId: "oss" },
    selectedSkills: ["typescript", "typescript", "github"],
    selectedTools: ["functions.shell_command", "functions.apply_patch"],
    skippedTools: ["web.run"],
    firstReads: ["docs/live-roadmap.gnl.md", "src/cli/commands.ts"],
    outcome: {
      state: "success",
      latencyMs: 1234,
      toolCallCount: 5,
      inputTokens: 1200,
      outputTokens: 400,
      notes: ["Used local tests only; no hosted service needed."],
    },
    confidence: "high",
    createdAt: "2026-04-24T00:00:00.000Z",
    retentionDays: 7,
  });

  assert.equal(record.schemaVersion, EXECUTION_CONTEXT_SCHEMA_VERSION);
  assert.equal(record.expiresAt, "2026-05-01T00:00:00.000Z");
  assert.deepEqual(record.selectedSkills, ["github", "typescript"]);
  assert.equal(record.outcome.state, "success");
  assert.doesNotThrow(() => assertExecutionContextRecord(record));
});

test("execution context records reject raw task or prompt payload fields", () => {
  const fingerprint = createExecutionContextTaskFingerprint({
    taskText: "Review dashboard changes.",
  });
  const unsafe = {
    taskFingerprint: fingerprint,
    taskText: "Review this private prompt text.",
  } as CreateExecutionContextRecordInput & { taskText: string };

  assert.throws(() => createExecutionContextRecord(unsafe), ValidationError);
  assert.throws(() => assertNoForbiddenExecutionContextFields({ promptText: "secret task" }), ValidationError);
});

test("execution context validation rejects malformed identifiers and counters", () => {
  const fingerprint = createExecutionContextTaskFingerprint({
    taskText: "Run local package checks.",
  });

  assert.throws(
    () => createExecutionContextRecord({
      taskFingerprint: fingerprint,
      selectedTools: ["functions.shell_command\nrm -rf"],
    }),
    ValidationError,
  );
  assert.throws(
    () => createExecutionContextRecord({
      taskFingerprint: fingerprint,
      outcome: { state: "success", toolCallCount: -1 },
    }),
    ValidationError,
  );
});

test("execution context schema validation rejects unsupported versions", () => {
  const record = createExecutionContextRecord({
    taskFingerprint: createExecutionContextTaskFingerprint({
      taskText: "Check package exports.",
    }),
  });
  const unsupported = {
    ...record,
    schemaVersion: "9.9.9",
  } as unknown as ExecutionContextRecord;

  assert.throws(() => assertExecutionContextRecord(unsupported), ValidationError);
});

test("execution context recommendation returns advisory metadata without raw task text", () => {
  const fingerprint = createExecutionContextTaskFingerprint({
    taskText: "Fix failing dashboard CLI tests.",
    scope: { repoId: "GlialNode" },
    features: ["dashboard", "cli"],
  });
  const record = createExecutionContextRecord({
    taskFingerprint: fingerprint,
    scope: { repoId: "GlialNode" },
    selectedSkills: ["typescript", "github"],
    selectedTools: ["functions.shell_command", "functions.apply_patch", "web.run"],
    skippedTools: ["web.run"],
    firstReads: ["docs/live-roadmap.gnl.md", "src/cli/commands.ts"],
    outcome: { state: "success", toolCallCount: 6 },
    confidence: "high",
    createdAt: "2026-04-24T00:00:00.000Z",
    retentionDays: 30,
  });

  const recommendation = recommendExecutionContext({
    taskText: "fix failing dashboard cli tests",
    scope: { repoId: "GlialNode" },
    features: ["cli", "dashboard"],
    availableSkills: ["typescript"],
    availableTools: ["functions.shell_command", "functions.apply_patch"],
    records: [record],
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(recommendation.schemaVersion, "1.0.0");
  assert.equal(recommendation.matchedRecords, 1);
  assert.equal(recommendation.confidence, "medium");
  assert.deepEqual(recommendation.selectedSkills, ["typescript"]);
  assert.deepEqual(recommendation.selectedTools, ["functions.apply_patch", "functions.shell_command"]);
  assert.deepEqual(recommendation.avoidTools, []);
  assert.ok(recommendation.firstReads.includes("docs/live-roadmap.gnl.md"));
  assert.ok(recommendation.warnings.some((warning) => warning.includes("Ignored unavailable skill")));
  assert.ok(recommendation.warnings.some((warning) => warning.includes("Ignored unavailable tool")));
  assert.doesNotMatch(JSON.stringify(recommendation), /fix failing dashboard cli tests/i);
});

test("execution context recommendation degrades when records expire or are missing", () => {
  const expired = createExecutionContextRecord({
    taskFingerprint: createExecutionContextTaskFingerprint({
      taskText: "Add package export tests.",
    }),
    selectedTools: ["functions.shell_command"],
    outcome: { state: "success" },
    confidence: "high",
    createdAt: "2026-04-01T00:00:00.000Z",
    retentionDays: 1,
  });

  const recommendation = recommendExecutionContext({
    taskText: "Add package export tests",
    records: [expired],
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(recommendation.confidence, "low");
  assert.equal(recommendation.matchedRecords, 0);
  assert.equal(recommendation.ignoredExpiredRecords, 1);
  assert.equal(recommendation.fallbackToNormalDiscovery, true);
  assert.deepEqual(recommendation.selectedTools, []);
  assert.ok(recommendation.warnings.some((warning) => warning.includes("expired")));
});

test("execution context recommendation degrades when tools and paths drift", () => {
  const record = createExecutionContextRecord({
    taskFingerprint: createExecutionContextTaskFingerprint({
      taskText: "Fix the dashboard routing panel.",
      scope: { repoId: "GlialNode" },
      features: ["dashboard", "routing"],
    }),
    selectedSkills: ["typescript"],
    selectedTools: ["functions.apply_patch", "old.mcp_tool"],
    skippedTools: ["web.run"],
    firstReads: ["src/dashboard/old-panel.ts"],
    outcome: { state: "success", toolCallCount: 3 },
    confidence: "high",
    createdAt: "2026-04-24T00:00:00.000Z",
    retentionDays: 30,
  });

  const recommendation = recommendExecutionContext({
    taskText: "Fix the dashboard routing panel.",
    scope: { repoId: "GlialNode" },
    features: ["routing", "dashboard"],
    availableSkills: ["typescript"],
    availableTools: ["functions.apply_patch"],
    availableFirstReads: ["src/dashboard/builders.ts"],
    records: [record],
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(recommendation.confidence, "medium");
  assert.equal(recommendation.fallbackToNormalDiscovery, false);
  assert.deepEqual(recommendation.selectedTools, ["functions.apply_patch"]);
  assert.deepEqual(recommendation.firstReads, []);
  assert.deepEqual(recommendation.availabilityDiff.unavailableTools, ["old.mcp_tool"]);
  assert.deepEqual(recommendation.availabilityDiff.unavailableFirstReads, ["src/dashboard/old-panel.ts"]);
  assert.equal(recommendation.availabilityDiff.driftedRecommendationCount, 2);
  assert.ok(recommendation.warnings.some((warning) => warning.includes("degraded")));
});

test("execution context recommendation falls back when all useful routes are unavailable", () => {
  const record = createExecutionContextRecord({
    taskFingerprint: createExecutionContextTaskFingerprint({
      taskText: "Investigate package publish failure.",
      features: ["release"],
    }),
    selectedTools: ["old.publisher"],
    firstReads: ["scripts/old-publish.mjs"],
    outcome: { state: "success" },
    confidence: "high",
    createdAt: "2026-04-24T00:00:00.000Z",
    retentionDays: 30,
  });

  const recommendation = recommendExecutionContext({
    taskText: "Investigate package publish failure.",
    features: ["release"],
    availableTools: ["functions.shell_command"],
    availableFirstReads: ["scripts/check-pack.mjs"],
    records: [record],
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(recommendation.confidence, "low");
  assert.equal(recommendation.fallbackToNormalDiscovery, true);
  assert.deepEqual(recommendation.selectedTools, []);
  assert.deepEqual(recommendation.firstReads, []);
  assert.ok(recommendation.warnings.some((warning) => warning.includes("fall back to normal discovery")));
});
