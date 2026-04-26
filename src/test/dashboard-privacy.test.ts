import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  ValidationError,
  assertDashboardCapabilityAllowed,
  assertDashboardPrivacyPolicy,
  assertDashboardSnapshotPrivacy,
  assertOssDashboardBoundary,
  createDashboardDistributionBoundary,
  createDefaultDashboardPrivacyPolicy,
  createUnavailableDashboardMetric,
  type DashboardDistributionBoundary,
  type OperationsDashboardSnapshot,
} from "../index.js";

test("dashboard privacy policy defaults to local metrics-only access", () => {
  const policy = createDefaultDashboardPrivacyPolicy();

  assert.equal(policy.accessMode, "local_process");
  assert.equal(policy.allowRawText, false);
  assert.ok(policy.redactionRules.includes("no_prompt_text"));
  assert.ok(policy.redactionRules.includes("no_memory_content"));
  assert.doesNotThrow(() => assertDashboardPrivacyPolicy(policy));
});

test("dashboard privacy policy rejects hosted team mode in OSS contracts", () => {
  const policy = createDefaultDashboardPrivacyPolicy({
    accessMode: "hosted_team",
  });

  assert.throws(() => assertDashboardPrivacyPolicy(policy), ValidationError);
});

test("dashboard distribution boundary reserves paid team capabilities outside OSS", () => {
  const boundary = createDashboardDistributionBoundary("oss_local");

  assert.equal(boundary.tier, "oss_local");
  assert.ok(boundary.allowedCapabilities.includes("local_metrics_sqlite"));
  assert.ok(boundary.allowedCapabilities.includes("local_read_only_http"));
  assert.ok(boundary.reservedCapabilities.includes("supabase_project_backend"));
  assert.ok(boundary.reservedCapabilities.includes("subscription_billing"));
  assert.doesNotThrow(() => assertOssDashboardBoundary(boundary));
  assert.doesNotThrow(() => assertDashboardCapabilityAllowed("local_static_html", boundary));
  assert.throws(() => assertDashboardCapabilityAllowed("hosted_team_dashboard", boundary), ValidationError);
});

test("dashboard distribution boundary rejects malformed OSS capability mixes", () => {
  const unsafeBoundary: DashboardDistributionBoundary = {
    ...createDashboardDistributionBoundary("oss_local"),
    allowedCapabilities: [
      ...createDashboardDistributionBoundary("oss_local").allowedCapabilities,
      "postgres_team_storage",
    ],
  };

  assert.throws(() => assertOssDashboardBoundary(unsafeBoundary), ValidationError);
});

test("dashboard privacy policy requires origins for local HTTP access", () => {
  const unsafePolicy = createDefaultDashboardPrivacyPolicy({
    accessMode: "local_read_only_http",
  });
  const safePolicy = createDefaultDashboardPrivacyPolicy({
    accessMode: "local_read_only_http",
    allowedOrigins: ["http://127.0.0.1:8787"],
  });

  assert.throws(() => assertDashboardPrivacyPolicy(unsafePolicy), ValidationError);
  assert.doesNotThrow(() => assertDashboardPrivacyPolicy(safePolicy));
});

test("dashboard snapshot privacy rejects raw prompt or memory fields", () => {
  const snapshot = createOperationsSnapshot();
  const unsafeSnapshot = {
    ...snapshot,
    promptText: "Summarize this private customer conversation.",
  } as OperationsDashboardSnapshot & { promptText: string };

  assert.throws(() => assertDashboardSnapshotPrivacy(unsafeSnapshot), ValidationError);
});

test("dashboard snapshot privacy accepts metrics-only operations snapshots", () => {
  const snapshot = createOperationsSnapshot();

  assert.doesNotThrow(() => assertDashboardSnapshotPrivacy(snapshot));
});

function createOperationsSnapshot(): OperationsDashboardSnapshot {
  return {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    kind: "operations",
    generatedAt: "2026-04-24T00:00:00.000Z",
    warnings: [],
    compatibilityNotes: ["Privacy contract fixture contains metrics only."],
    storage: {
      backend: {
        label: "Storage backend",
        value: "sqlite",
        unit: "count",
        confidence: "configured",
        provenance: {
          source: "storage_contract",
        },
      },
      schemaVersion: {
        label: "Storage schema version",
        value: "1",
        unit: "count",
        confidence: "computed",
        provenance: {
          source: "storage_contract",
        },
      },
      databaseBytes: createUnavailableDashboardMetric("Database size", {
        unit: "bytes",
        source: "doctor_status",
      }),
    },
    maintenance: {
      lastMaintenanceAt: createUnavailableDashboardMetric("Last maintenance", {
        unit: "timestamp",
        source: "memory_events",
      }),
      pendingCompactions: createUnavailableDashboardMetric("Pending compactions", {
        unit: "count",
        source: "memory_report",
      }),
      pendingRetentionActions: createUnavailableDashboardMetric("Pending retention actions", {
        unit: "count",
        source: "memory_report",
      }),
    },
    reliability: {
      doctorStatus: {
        label: "Doctor status",
        value: "unknown",
        unit: "count",
        confidence: "computed",
        provenance: {
          source: "doctor_status",
        },
      },
      latestBackupAt: createUnavailableDashboardMetric("Latest backup", {
        unit: "timestamp",
        source: "doctor_status",
      }),
      criticalWarnings: {
        label: "Critical warnings",
        value: 0,
        unit: "count",
        confidence: "computed",
        provenance: {
          source: "doctor_status",
        },
      },
    },
  };
}
