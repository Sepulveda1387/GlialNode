import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("dashboard fixture script writes local demo artifacts", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-dashboard-fixture-"));

  try {
    execFileSync(process.execPath, [
      "scripts/dashboard-fixture.mjs",
      "--output-dir",
      tempDirectory,
      "--skip-build",
      "true",
    ], {
      cwd: resolve("."),
      encoding: "utf8",
    });

    const manifestPath = join(tempDirectory, "manifest.json");
    assert.equal(existsSync(manifestPath), true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: string;
      fixture: string;
      artifacts: Record<string, string>;
    };

    assert.equal(manifest.schemaVersion, "1.0.0");
    assert.equal(manifest.fixture, "dashboard-demo");
    assert.equal(existsSync(manifest.artifacts.executive), true);
    assert.equal(existsSync(manifest.artifacts.recallQuality), true);
    assert.equal(existsSync(manifest.artifacts.trust), true);
    assert.equal(existsSync(manifest.artifacts.routingEfficiency), true);
    assert.equal(existsSync(manifest.artifacts.tokenRoiCsv), true);
    assert.equal(existsSync(manifest.artifacts.dashboardHtml), true);
    assert.match(readFileSync(manifest.artifacts.tokenRoiCsv, "utf8"), /estimated_saved_tokens/);
    assert.match(readFileSync(manifest.artifacts.dashboardHtml, "utf8"), /GlialNode Dashboard/);
    assert.match(readFileSync(manifest.artifacts.dashboardHtml, "utf8"), /Benchmark Baseline/);
    assert.match(readFileSync(manifest.artifacts.dashboardHtml, "utf8"), /Routing Efficiency/);
    assert.doesNotMatch(readFileSync(manifest.artifacts.dashboardHtml, "utf8"), /Primary dashboard memory/);

    const executive = JSON.parse(readFileSync(manifest.artifacts.executive, "utf8")) as {
      snapshot: {
        kind: string;
        value: { savedTokens: { value: number } };
        insights?: { topRoi: unknown[]; topRisk: unknown[] };
        routing?: { totals: { recordedOutcomes: { value: number }; successRate: { value: number } } };
      };
    };
    const recallQuality = JSON.parse(readFileSync(manifest.artifacts.recallQuality, "utf8")) as {
      report: { totals: { recallRequests: number; bundleRequests: number }; topRecalled: unknown[] };
    };
    const operations = JSON.parse(readFileSync(manifest.artifacts.operations, "utf8")) as {
      snapshot: { performance?: { benchmarkBaseline: { records: { value: number } } } };
    };
    const trust = JSON.parse(readFileSync(manifest.artifacts.trust, "utf8")) as {
      report: { totals: { policyFailureEvents: number; trustedSigners: number } };
    };
    const routingEfficiency = JSON.parse(readFileSync(manifest.artifacts.routingEfficiency, "utf8")) as {
      report: {
        totals: {
          recordedOutcomes: { value: number };
          successfulOutcomes: { value: number };
          partialOutcomes: { value: number };
          failedOutcomes: { value: number };
          skippedToolMentions: { value: number };
          failedPathInputTokens: { value: number };
        };
        topUsefulTools: unknown[];
        topNoisyTools: unknown[];
        topUsefulSkills: unknown[];
      };
    };

    assert.equal(executive.snapshot.kind, "executive");
    assert.ok(executive.snapshot.value.savedTokens.value > 0);
    assert.ok((executive.snapshot.insights?.topRoi.length ?? 0) > 0);
    assert.ok((executive.snapshot.insights?.topRisk.length ?? 0) > 0);
    assert.equal(executive.snapshot.routing?.totals.recordedOutcomes.value, 3);
    assert.equal(executive.snapshot.routing?.totals.successRate.value, 0.3333);
    assert.ok((operations.snapshot.performance?.benchmarkBaseline.records.value ?? 0) > 0);
    assert.equal(recallQuality.report.totals.recallRequests, 1);
    assert.equal(recallQuality.report.totals.bundleRequests, 1);
    assert.ok(recallQuality.report.topRecalled.length > 0);
    assert.equal(trust.report.totals.trustedSigners, 1);
    assert.equal(trust.report.totals.policyFailureEvents, 1);
    assert.equal(routingEfficiency.report.totals.recordedOutcomes.value, 3);
    assert.equal(routingEfficiency.report.totals.successfulOutcomes.value, 1);
    assert.equal(routingEfficiency.report.totals.partialOutcomes.value, 1);
    assert.equal(routingEfficiency.report.totals.failedOutcomes.value, 1);
    assert.equal(routingEfficiency.report.totals.skippedToolMentions.value, 3);
    assert.equal(routingEfficiency.report.totals.failedPathInputTokens.value, 480);
    assert.ok(routingEfficiency.report.topUsefulTools.length > 0);
    assert.ok(routingEfficiency.report.topNoisyTools.length > 0);
    assert.ok(routingEfficiency.report.topUsefulSkills.length > 0);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
