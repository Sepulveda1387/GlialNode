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
