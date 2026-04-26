import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  ValidationError,
  assertExecutionContextRecord,
  assertNoForbiddenExecutionContextFields,
  createExecutionContextRecord,
  createExecutionContextTaskFingerprint,
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
