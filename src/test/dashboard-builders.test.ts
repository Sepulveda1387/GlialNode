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
  evaluateDashboardAlerts,
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
        granularity: "day",
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
      importance: 0.1,
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
        granularity: "day",
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
    assert.ok(executive.trends.some((metric) => metric.label === "Saved tokens 2026-04-24" && metric.value === 650));
    assert.ok(executive.trends.some((metric) => metric.label === "Saved cost 2026-04-24" && metric.confidence === "estimated"));
    assert.equal(health.lowConfidenceRecords.value, 1);
    assert.equal(health.staleRecords.value, 1);
    assert.equal(health.lifecycleDue.spacesMissingMaintenance.value, 1);
    assert.ok((health.lifecycleDue.compactionCandidates.value ?? 0) >= 1);
    assert.equal(health.lifecycleDue.retentionCandidates.value, 0);
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
      operationsBenchmarkBaseline: {
        generatedAt: "2026-04-24T00:00:00.000Z",
        records: 1000,
        searchMs: 12,
        recallMs: 34,
        bundleBuildMs: 56,
        compactionDryRunMs: 78,
        reportMs: 9,
      },
    });

    assert.equal(operations.kind, "operations");
    assert.equal(operations.storage.backend.value, "sqlite");
    assert.equal(operations.reliability.doctorStatus.value, "attention");
    assert.equal(operations.reliability.criticalWarnings.value, 1);
    assert.equal(operations.reliability.latestBackupAt.value, "2026-04-24T00:00:00.000Z");
    assert.equal(operations.performance?.benchmarkBaseline.records.value, 1000);
    assert.equal(operations.performance?.benchmarkBaseline.reportMs.value, 9);
    assert.doesNotThrow(() => assertDashboardSnapshot(operations));
    assert.doesNotThrow(() => assertDashboardSnapshotPrivacy(operations));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("dashboard alerts evaluate memory health and operations thresholds", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-alerts-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    const space = await client.createSpace({ name: "Alert Dashboard Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "operator",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Low quality dashboard memory.",
      summary: "Low quality dashboard memory",
      confidence: 0.1,
      freshness: 0.1,
    });

    const evaluation = await client.evaluateDashboardAlerts({
      alertThresholds: {
        memoryHealthWarningBelow: 95,
        memoryHealthCriticalBelow: 80,
        staleRecordWarningRatio: 0.1,
        staleRecordCriticalRatio: 0.8,
        lowConfidenceWarningRatio: 0.1,
        lowConfidenceCriticalRatio: 0.8,
      },
    });

    assert.equal(evaluation.schemaVersion, DASHBOARD_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(evaluation.summary.highestSeverity, "critical");
    assert.ok(evaluation.alerts.some((alert) => alert.code === "memory_health_critical"));
    assert.ok(evaluation.alerts.some((alert) => alert.code === "stale_memory_critical"));
    assert.ok(evaluation.alerts.some((alert) => alert.code === "low_confidence_memory_critical"));
    assert.ok(evaluation.alerts.some((alert) => alert.code === "maintenance_due"));

    const standalone = evaluateDashboardAlerts({
      memoryHealth: await client.buildMemoryHealthReport(),
      maintenanceDue: false,
      thresholds: {
        databaseWarningBytes: 1,
      },
      databaseBytes: 2,
    });
    assert.ok(standalone.alerts.some((alert) => alert.code === "database_size_warning"));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient builds recall quality reports from metrics-only telemetry", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-recall-quality-"));
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    metrics: {
      filename: join(tempDirectory, "glialnode.metrics.sqlite"),
    },
  });

  try {
    const space = await client.createSpace({ name: "Recall Quality Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "retriever",
    });
    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Recall quality primary memory.",
      summary: "Recall quality primary",
      importance: 0.9,
      confidence: 0.9,
      freshness: 0.9,
    });
    const supporting = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Recall quality supporting memory.",
      summary: "Recall quality support",
      importance: 0.7,
      confidence: 0.8,
      freshness: 0.8,
    });
    const neverRecalled = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "fact",
      content: "Important but never recalled memory.",
      summary: "Never recalled candidate",
      importance: 1,
      confidence: 1,
      freshness: 1,
    });

    await client.recordTokenUsage({
      spaceId: space.id,
      agentId: scope.id,
      operation: "memory.recall",
      model: "gpt-test",
      baselineTokens: 1200,
      actualContextTokens: 400,
      glialnodeOverheadTokens: 50,
      inputTokens: 450,
      outputTokens: 100,
      latencyMs: 25,
      dimensions: {
        primaryRecordId: primary.id,
        supportingRecordIds: supporting.id,
      },
    });
    await client.recordTokenUsage({
      spaceId: space.id,
      agentId: scope.id,
      operation: "memory.bundle",
      model: "gpt-test",
      baselineTokens: 1000,
      actualContextTokens: 500,
      inputTokens: 500,
      outputTokens: 90,
      latencyMs: 75,
      dimensions: {
        primaryRecordId: primary.id,
      },
    });

    const report = await client.buildRecallQualityReport({
      tokenUsage: {
        granularity: "all",
        spaceId: space.id,
      },
      maxTopRecalled: 2,
      maxNeverRecalled: 3,
    });

    assert.equal(report.schemaVersion, DASHBOARD_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(report.totals.recallRequests, 1);
    assert.equal(report.totals.bundleRequests, 1);
    assert.equal(report.totals.measuredLatencyRequests, 2);
    assert.equal(report.totals.p50LatencyMs, 25);
    assert.equal(report.totals.p95LatencyMs, 75);
    assert.equal(report.topRecalled[0]?.recordId, primary.id);
    assert.equal(report.topRecalled[0]?.count, 2);
    assert.ok(report.topRecalled.some((entry) => entry.recordId === supporting.id));
    assert.ok(report.neverRecalledCandidates.some((entry) => entry.recordId === neverRecalled.id));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient builds trust dashboard reports from registry and provenance metadata", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-trust-"));
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({
    filename: join(tempDirectory, "glialnode.sqlite"),
    presetDirectory,
  });

  try {
    const space = await client.createSpace({
      name: "Trust Dashboard Space",
      settings: {
        provenance: {
          trustProfile: "anchored",
          trustedSignerNames: ["team-anchor"],
        },
      },
    });
    const signingKey = client.generateSigningKey("team-key", {
      signer: "GlialNode Test",
      directory: presetDirectory,
    });
    client.trustSigningKey("team-key", {
      trustName: "team-anchor",
      directory: presetDirectory,
    });
    client.registerTrustPolicyPack("strict-anchor", {
      directory: presetDirectory,
      baseProfile: "anchored",
      policy: {
        trustedSignerNames: ["team-anchor"],
      },
    });
    client.revokeTrustedSigner("team-anchor", {
      directory: presetDirectory,
      replacedBy: "team-anchor-v2",
    });
    const auditScope = await client.addScope({
      spaceId: space.id,
      type: "memory_space",
      label: "Trust Audit",
    });

    await client.addEvent({
      spaceId: space.id,
      scope: { type: auditScope.type, id: auditScope.id },
      actorType: "system",
      actorId: "trust-dashboard-test",
      type: "bundle_reviewed",
      summary: "Reviewed preset bundle for dashboard trust report.",
      payload: {
        trustProfile: "anchored",
        trusted: false,
        signer: signingKey.signer,
        origin: "local-test",
        matchedTrustedSignerNames: ["team-anchor"],
        warnings: ["Trusted signer was revoked."],
      },
    });

    const report = await client.buildTrustDashboardReport({
      presetDirectory,
      recentTrustEventLimit: 5,
    });

    assert.equal(report.schemaVersion, DASHBOARD_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(report.totals.spaces, 1);
    assert.equal(report.totals.spacesWithTrustProfile, 1);
    assert.equal(report.totals.trustedSigners, 1);
    assert.equal(report.totals.revokedTrustedSigners, 1);
    assert.equal(report.totals.rotatedTrustedSigners, 1);
    assert.equal(report.totals.trustPolicyPacks, 1);
    assert.equal(report.totals.policyFailureEvents, 1);
    assert.equal(report.spaces[0]?.trustProfile, "anchored");
    assert.equal(report.recentTrustEvents[0]?.trusted, false);
    assert.equal(report.recentTrustEvents[0]?.warningCount, 1);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
