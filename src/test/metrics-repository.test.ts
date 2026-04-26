import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigurationError,
  GlialNodeClient,
  METRICS_SQLITE_SCHEMA_VERSION,
  SqliteMetricsRepository,
  ValidationError,
  resolveDefaultMetricsDatabasePath,
  type RecordTokenUsageInput,
} from "../index.js";

test("SqliteMetricsRepository bootstraps a separate token usage database", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-metrics-"));
  const metricsPath = join(tempDirectory, "glialnode.metrics.sqlite");
  const repository = new SqliteMetricsRepository({ filename: metricsPath });

  try {
    assert.equal(repository.getSchemaVersion(), METRICS_SQLITE_SCHEMA_VERSION);
    assert.equal(repository.listAppliedMigrations().length, 2);
    assert.ok(repository.getRuntimeSettings().filename?.endsWith("glialnode.metrics.sqlite"));
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMetricsRepository records token usage without prompt payloads", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    const record = await repository.recordTokenUsage({
      spaceId: "space_test",
      agentId: "agent_planner",
      operation: "memory.recall",
      provider: "openai",
      model: "gpt-test",
      baselineTokens: 1200,
      actualContextTokens: 430,
      glialnodeOverheadTokens: 30,
      inputTokens: 460,
      outputTokens: 120,
      latencyMs: 42,
      dimensions: {
        environment: "test",
      },
      createdAt: "2026-04-24T12:00:00.000Z",
    });

    assert.equal(record.estimatedSavedTokens, 740);
    assert.equal(record.estimatedSavedRatio, 740 / 1200);

    const listed = await repository.listTokenUsage({ spaceId: "space_test" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.operation, "memory.recall");
    assert.equal(listed[0]?.dimensions?.environment, "test");
  } finally {
    repository.close();
  }
});

test("SqliteMetricsRepository rejects raw prompt and memory payload fields", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    await assert.rejects(
      () =>
        repository.recordTokenUsage({
          operation: "memory.recall",
          model: "gpt-test",
          inputTokens: 10,
          outputTokens: 2,
          promptText: "Do not store this.",
        } as RecordTokenUsageInput & { promptText: string }),
      ValidationError,
    );

    await assert.rejects(
      () =>
        repository.recordTokenUsage({
          operation: "memory.recall",
          model: "gpt-test",
          inputTokens: 10,
          outputTokens: 2,
          dimensions: {
            memoryContent: "Do not store this either.",
          },
        } as RecordTokenUsageInput),
      ValidationError,
    );
  } finally {
    repository.close();
  }
});

test("SqliteMetricsRepository records execution context outcomes without raw task text", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    const record = await repository.recordExecutionOutcome({
      taskText: "Use the GitHub connector and then run the local verification command.",
      scope: {
        repoId: "glialnode",
        projectId: "dashboard",
        agentId: "codex",
      },
      features: ["ci", "dashboard", "ci"],
      selectedTools: ["github.pull_request", "functions.shell_command"],
      skippedTools: ["web.search"],
      firstReads: ["docs/live-roadmap.gnl.md"],
      outcome: {
        state: "success",
        latencyMs: 87,
        toolCallCount: 3,
        inputTokens: 1200,
        outputTokens: 240,
        notes: ["local verification passed"],
      },
      confidence: "high",
      createdAt: "2026-04-24T12:00:00.000Z",
      retentionDays: 7,
    });

    assert.equal(record.taskFingerprint.hash.length, 64);
    assert.equal(record.taskFingerprint.featureCount, 2);
    assert.equal(record.selectedTools.length, 2);

    const listed = await repository.listExecutionContextRecords({
      repoId: "glialnode",
      includeExpired: true,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.outcome.state, "success");
    assert.equal(listed[0]?.outcome.toolCallCount, 3);
    assert.equal(listed[0]?.outcome.inputTokens, 1200);
    assert.deepEqual(listed[0]?.selectedTools, ["functions.shell_command", "github.pull_request"]);
    assert.doesNotMatch(JSON.stringify(listed), /GitHub connector and then run/);
  } finally {
    repository.close();
  }
});

test("SqliteMetricsRepository filters expired execution context outcomes by default", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    const current = await repository.recordExecutionOutcome({
      taskText: "Build dashboard routing recommendations.",
      scope: {
        repoId: "glialnode",
      },
      selectedTools: ["functions.shell_command"],
      outcome: {
        state: "partial",
      },
      createdAt: "2026-04-24T00:00:00.000Z",
      retentionDays: 30,
    });
    await repository.recordExecutionOutcome({
      taskText: "Build dashboard routing recommendations.",
      scope: {
        repoId: "glialnode",
      },
      selectedTools: ["web.search"],
      outcome: {
        state: "failed",
      },
      createdAt: "2026-03-01T00:00:00.000Z",
      retentionDays: 1,
    });

    const active = await repository.listExecutionContextRecords({
      repoId: "glialnode",
      now: "2026-04-25T00:00:00.000Z",
    });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.id, current.id);

    const all = await repository.listExecutionContextRecords({
      repoId: "glialnode",
      includeExpired: true,
    });
    assert.equal(all.length, 2);
  } finally {
    repository.close();
  }
});

test("SqliteMetricsRepository rejects raw execution context outcome payload fields", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    await assert.rejects(
      () =>
        repository.recordExecutionOutcome({
          taskText: "Allowed input used only for fingerprinting.",
          selectedTools: ["functions.shell_command"],
          outcome: {
            state: "success",
          },
          promptText: "Do not persist this.",
        } as Parameters<typeof repository.recordExecutionOutcome>[0] & { promptText: string }),
      ValidationError,
    );
  } finally {
    repository.close();
  }
});

test("SqliteMetricsRepository builds aggregate token ROI reports with cost model metadata", async () => {
  const repository = new SqliteMetricsRepository();

  try {
    await repository.recordTokenUsage({
      spaceId: "space_test",
      operation: "memory.bundle",
      provider: "openai",
      model: "gpt-test",
      baselineTokens: 1000,
      actualContextTokens: 300,
      glialnodeOverheadTokens: 50,
      inputTokens: 350,
      outputTokens: 100,
      createdAt: "2026-04-24T01:00:00.000Z",
    });
    await repository.recordTokenUsage({
      spaceId: "space_test",
      operation: "memory.bundle",
      provider: "openai",
      model: "gpt-test",
      baselineTokens: 900,
      actualContextTokens: 320,
      glialnodeOverheadTokens: 40,
      inputTokens: 360,
      outputTokens: 120,
      createdAt: "2026-04-24T18:00:00.000Z",
    });

    const report = await repository.getTokenUsageReport({
      spaceId: "space_test",
      granularity: "day",
      costModel: {
        currency: "USD",
        provider: "openai",
        model: "gpt-test",
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
      },
    });

    assert.equal(report.schemaVersion, "1.0.0");
    assert.equal(report.buckets.length, 1);
    assert.equal(report.buckets[0]?.key, "2026-04-24");
    assert.equal(report.totals.recordCount, 2);
    assert.equal(report.totals.baselineTokens, 1900);
    assert.equal(report.totals.inputTokens, 710);
    assert.equal(report.totals.estimatedSavedTokens, 1190);
    assert.ok((report.totals.costSaved ?? 0) > 0);
  } finally {
    repository.close();
  }
});

test("GlialNodeClient lazily records token usage in the configured metrics database", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-metrics-"));
  const memoryPath = join(tempDirectory, "glialnode.sqlite");
  const metricsPath = join(tempDirectory, "custom.metrics.sqlite");
  const client = new GlialNodeClient({
    filename: memoryPath,
    metrics: {
      filename: metricsPath,
    },
  });

  try {
    await client.recordTokenUsage({
      operation: "memory.recall",
      model: "gpt-test",
      inputTokens: 101,
      outputTokens: 22,
      createdAt: "2026-04-24T00:00:00.000Z",
    });

    const report = await client.getTokenUsageReport({ granularity: "all" });
    assert.equal(report.totals.recordCount, 1);
    assert.equal(report.totals.inputTokens, 101);
    assert.equal(existsSync(metricsPath), true);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient records execution context outcomes in the configured metrics database", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-routing-"));
  const memoryPath = join(tempDirectory, "glialnode.sqlite");
  const metricsPath = join(tempDirectory, "custom.metrics.sqlite");
  const client = new GlialNodeClient({
    filename: memoryPath,
    metrics: {
      filename: metricsPath,
    },
  });

  try {
    const record = await client.recordExecutionOutcome({
      taskText: "Prefer local repository reads before browser automation.",
      scope: {
        repoId: "glialnode",
      },
      selectedTools: ["functions.shell_command"],
      skippedTools: ["playwright.browser"],
      outcome: {
        state: "success",
        toolCallCount: 1,
      },
      createdAt: "2026-04-24T00:00:00.000Z",
    });

    const records = await client.listExecutionContextRecords({
      fingerprintHash: record.taskFingerprint.hash,
      includeExpired: true,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.skippedTools[0], "playwright.browser");
    assert.equal(existsSync(metricsPath), true);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient supports explicit metrics disable mode", async () => {
  const client = new GlialNodeClient({
    metrics: {
      disabled: true,
    },
  });

  try {
    await assert.rejects(
      () =>
        client.recordTokenUsage({
          operation: "memory.recall",
          model: "gpt-test",
          inputTokens: 1,
          outputTokens: 1,
        }),
      ConfigurationError,
    );
    await assert.rejects(
      () =>
        client.recordExecutionOutcome({
          taskText: "Disabled metrics should reject this outcome.",
          outcome: {
            state: "success",
          },
        }),
      ConfigurationError,
    );
  } finally {
    client.close();
  }
});

test("default metrics database path lives beside the memory database", () => {
  assert.equal(
    resolveDefaultMetricsDatabasePath(join("project", "data", "glialnode.sqlite")).endsWith(join("data", "glialnode.metrics.sqlite")),
    true,
  );
});
