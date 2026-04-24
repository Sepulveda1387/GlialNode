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
    assert.equal(repository.listAppliedMigrations().length, 1);
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
