import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  GlialNodeClient,
  assertDashboardSnapshot,
  assertDashboardSnapshotPrivacy,
} from "../index.js";

test("GlialNodeClient builds dashboard overview snapshots from memory and token metrics", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-builders-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    const space = await client.createSpace({ name: "Dashboard Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Use token metrics to prove dashboard ROI.",
      summary: "Dashboard ROI decision",
      freshness: 0.8,
    });
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "This stale record is only used to test dashboard health counts.",
      summary: "Stale dashboard fact",
      freshness: 0.1,
    });

    await client.recordTokenUsage({
      spaceId: space.id,
      agentId: scope.id,
      operation: "memory.recall",
      model: "gpt-test",
      baselineTokens: 1000,
      actualContextTokens: 300,
      glialnodeOverheadTokens: 50,
      inputTokens: 350,
      outputTokens: 100,
      createdAt: "2026-04-24T00:00:00.000Z",
    });

    const snapshot = await client.buildDashboardOverviewSnapshot({
      tokenUsage: {
        granularity: "all",
        costModel: {
          currency: "USD",
          model: "gpt-test",
          inputCostPerMillionTokens: 2,
          outputCostPerMillionTokens: 8,
        },
      },
    });

    assert.equal(snapshot.schemaVersion, DASHBOARD_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(snapshot.kind, "overview");
    assert.equal(snapshot.memory.activeSpaces.value, 1);
    assert.equal(snapshot.memory.activeRecords.value, 2);
    assert.equal(snapshot.memory.staleRecords.value, 1);
    assert.equal(snapshot.value.savedTokens.value, 650);
    assert.equal(snapshot.value.savedTokens.confidence, "estimated");
    assert.ok((snapshot.value.savedCost.value ?? 0) > 0);
    assert.doesNotThrow(() => assertDashboardSnapshot(snapshot));
    assert.doesNotThrow(() => assertDashboardSnapshotPrivacy(snapshot));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient builds scoped space and agent dashboard snapshots", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-scoped-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    const space = await client.createSpace({ name: "Scoped Dashboard Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "executor",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "fact",
      content: "Scoped dashboard snapshots use the same stable schema.",
      summary: "Scoped dashboard fact",
    });

    await client.recordTokenUsage({
      spaceId: space.id,
      agentId: scope.id,
      operation: "memory.bundle",
      model: "gpt-test",
      baselineTokens: 900,
      actualContextTokens: 330,
      inputTokens: 330,
      outputTokens: 90,
      createdAt: "2026-04-24T00:00:00.000Z",
    });

    const spaceSnapshot = await client.buildSpaceDashboardSnapshot(space.id, {
      tokenUsage: { granularity: "all" },
    });
    const agentSnapshot = await client.buildAgentDashboardSnapshot(scope.id, {
      tokenUsage: { granularity: "all" },
    });

    assert.equal(spaceSnapshot.scope?.spaceId, space.id);
    assert.equal(spaceSnapshot.memory.activeRecords.value, 1);
    assert.equal(spaceSnapshot.value.savedTokens.value, 570);
    assert.equal(agentSnapshot.scope?.agentId, scope.id);
    assert.equal(agentSnapshot.memory.activeSpaces.value, 1);
    assert.equal(agentSnapshot.memory.activeRecords.value, 1);
    assert.equal(agentSnapshot.value.savedTokens.value, 570);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient builds executive and memory health dashboard reports", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-executive-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    const space = await client.createSpace({ name: "Executive Dashboard Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Healthy dashboard memory.",
      summary: "Healthy dashboard memory",
      confidence: 0.9,
      freshness: 0.9,
    });
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Low confidence dashboard memory.",
      summary: "Low confidence dashboard memory",
      confidence: 0.2,
      freshness: 0.2,
    });

    await client.recordTokenUsage({
      spaceId: space.id,
      agentId: scope.id,
      operation: "memory.recall",
      model: "gpt-test",
      baselineTokens: 1000,
      actualContextTokens: 350,
      inputTokens: 350,
      outputTokens: 120,
      createdAt: "2026-04-24T00:00:00.000Z",
    });

    const executive = await client.buildExecutiveDashboardSnapshot({
      tokenUsage: {
        granularity: "all",
        costModel: {
          currency: "USD",
          model: "gpt-test",
          inputCostPerMillionTokens: 2,
          outputCostPerMillionTokens: 8,
        },
      },
    });
    const health = await client.buildMemoryHealthReport();

    assert.equal(executive.kind, "executive");
    assert.equal(executive.value.activeSpaces.value, 1);
    assert.equal(executive.value.savedTokens.value, 650);
    assert.equal(executive.risk.openCriticalWarnings.value, 0);
    assert.ok((executive.risk.memoryHealthScore.value ?? 0) < 100);
    assert.equal(health.lowConfidenceRecords.value, 1);
    assert.equal(health.staleRecords.value, 1);
    assert.doesNotThrow(() => assertDashboardSnapshot(executive));
    assert.doesNotThrow(() => assertDashboardSnapshotPrivacy(executive));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient builds operations dashboard snapshots", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-operations-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    await client.createSpace({ name: "Operations Dashboard Space" });

    const operations = await client.buildOperationsDashboardSnapshot({
      latestBackupAt: "2026-04-24T00:00:00.000Z",
    });

    assert.equal(operations.kind, "operations");
    assert.equal(operations.storage.backend.value, "sqlite");
    assert.equal(operations.reliability.doctorStatus.value, "attention");
    assert.equal(operations.reliability.criticalWarnings.value, 1);
    assert.equal(operations.reliability.latestBackupAt.value, "2026-04-24T00:00:00.000Z");
    assert.doesNotThrow(() => assertDashboardSnapshot(operations));
    assert.doesNotThrow(() => assertDashboardSnapshotPrivacy(operations));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
