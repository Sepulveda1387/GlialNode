import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  ValidationError,
  assertDashboardMetric,
  assertDashboardSnapshot,
  assertDashboardSnapshotVersion,
  createUnavailableDashboardMetric,
  isDashboardSnapshotVersion,
  type DashboardMetric,
  type ExecutiveDashboardSnapshot,
} from "../index.js";

test("dashboard schema exposes a stable version contract", () => {
  assert.equal(DASHBOARD_SNAPSHOT_SCHEMA_VERSION, "1.0.0");
  assert.equal(isDashboardSnapshotVersion("1.0.0"), true);
  assert.equal(isDashboardSnapshotVersion("2.0.0"), false);
});

test("dashboard metric validation accepts computed metrics with provenance", () => {
  const metric: DashboardMetric<number> = {
    label: "Active records",
    value: 42,
    unit: "count",
    confidence: "computed",
    provenance: {
      source: "memory_report",
      collectedAt: "2026-04-24T00:00:00.000Z",
    },
  };

  assert.doesNotThrow(() => assertDashboardMetric(metric));
});

test("dashboard metric validation refuses estimates without basis", () => {
  const metric: DashboardMetric<number> = {
    label: "Saved tokens",
    value: 1000,
    unit: "tokens",
    confidence: "estimated",
    provenance: {
      source: "metrics_store",
    },
  };

  assert.throws(() => assertDashboardMetric(metric), ValidationError);
});

test("dashboard metric validation keeps unavailable values explicit", () => {
  const metric = createUnavailableDashboardMetric<number>("Saved cost", {
    unit: "currency",
    source: "metrics_store",
    notes: ["Token usage recording has not been configured yet."],
  });

  assert.equal(metric.value, null);
  assert.equal(metric.confidence, "unavailable");
  assert.equal(metric.provenance.source, "metrics_store");
  assert.doesNotThrow(() => assertDashboardMetric(metric));

  assert.throws(
    () =>
      assertDashboardMetric({
        ...metric,
        value: 0,
      }),
    ValidationError,
  );
});

test("dashboard snapshot validation rejects unsupported versions", () => {
  assert.throws(
    () =>
      assertDashboardSnapshotVersion({
        schemaVersion: "9.9.9",
      }),
    ValidationError,
  );
});

test("dashboard snapshot validation accepts an executive snapshot contract", () => {
  const measuredMetric = (label: string, value: number): DashboardMetric<number> => ({
    label,
    value,
    unit: "count",
    confidence: "computed",
    provenance: {
      source: "fixture",
      collectedAt: "2026-04-24T00:00:00.000Z",
    },
  });

  const snapshot: ExecutiveDashboardSnapshot = {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    kind: "executive",
    generatedAt: "2026-04-24T00:00:00.000Z",
    warnings: [],
    compatibilityNotes: ["Initial V2.07 dashboard snapshot contract."],
    value: {
      savedTokens: {
        label: "Saved tokens",
        value: 125000,
        unit: "tokens",
        confidence: "estimated",
        provenance: {
          source: "fixture",
          estimateBasis: {
            method: "fixture",
            assumptions: ["Fixture baseline uses deterministic sample token counts."],
          },
        },
      },
      savedCost: createUnavailableDashboardMetric("Saved cost", {
        unit: "currency",
        source: "cost_model",
      }),
      netSavings: createUnavailableDashboardMetric("Net savings", {
        unit: "currency",
        source: "cost_model",
      }),
      activeSpaces: measuredMetric("Active spaces", 2),
    },
    risk: {
      memoryHealthScore: {
        ...measuredMetric("Memory health score", 91),
        unit: "percent",
      },
      trustPostureScore: {
        ...measuredMetric("Trust posture score", 86),
        unit: "percent",
      },
      openCriticalWarnings: measuredMetric("Open critical warnings", 0),
    },
    trends: [measuredMetric("Weekly recall requests", 230)],
    insights: {
      topRoi: [
        {
          key: "space:demo",
          label: "Demo",
          category: "space",
          metric: measuredMetric("Saved tokens", 1200),
          notes: ["space:demo"],
        },
      ],
      topRisk: [
        {
          key: "space:demo",
          label: "Demo",
          category: "risk",
          metric: {
            ...measuredMetric("Risk score", 12),
            unit: "percent",
          },
          secondaryMetric: {
            ...measuredMetric("Memory health score", 88),
            unit: "percent",
          },
          notes: ["space:demo"],
        },
      ],
    },
  };

  assert.doesNotThrow(() => assertDashboardSnapshot(snapshot));
});
