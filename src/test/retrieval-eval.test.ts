import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GlialNodeClient } from "../client/index.js";

interface EvalRecordFixture {
  summary: string;
  content: string;
  kind: "fact" | "decision" | "preference" | "task" | "summary" | "blocker" | "artifact" | "attempt" | "error";
  tags?: string[];
  importance?: number;
  confidence?: number;
  freshness?: number;
}

interface EvalScenario {
  id: string;
  description: string;
  queryText: string;
  bundleConsumer?: "auto" | "balanced" | "planner" | "executor" | "reviewer";
  bundleProvenanceMode?: "auto" | "minimal" | "balanced" | "preserve";
  bundleMaxSupporting?: number;
  records: EvalRecordFixture[];
  expect: {
    route?: "balanced" | "planner" | "executor" | "reviewer";
    primarySummaryContains?: string;
    warningsInclude?: string[];
    warningsExclude?: string[];
    traceSummaryContains?: string;
    totalProvenanceMin?: number;
    supportingProvenanceMax?: number;
  };
}

interface RetrievalCorpus {
  version: number;
  scenarios: EvalScenario[];
}

test("retrieval eval corpus v1 scenarios match golden route/support expectations", async () => {
  const raw = readFileSync(
    join(process.cwd(), "docs", "evals", "retrieval-corpus.v1.json"),
    "utf8",
  );
  const corpus = JSON.parse(raw) as RetrievalCorpus;
  assert.equal(corpus.version, 1);
  assert.equal(corpus.scenarios.length, 10);

  for (const scenario of corpus.scenarios) {
    const tempDirectory = mkdtempSync(join(tmpdir(), `glialnode-retrieval-eval-${scenario.id}-`));
    const databasePath = join(tempDirectory, "glialnode.sqlite");
    const client = new GlialNodeClient({ filename: databasePath });

    try {
      const space = await client.createSpace({ name: `Retrieval Eval ${scenario.id}` });
      const scope = await client.addScope({
        spaceId: space.id,
        type: "agent",
        label: "eval",
      });

      for (const record of scenario.records) {
        await client.addRecord({
          spaceId: space.id,
          scope: { id: scope.id, type: scope.type },
          tier: "mid",
          kind: record.kind,
          content: record.content,
          summary: record.summary,
          tags: record.tags,
          importance: record.importance,
          confidence: record.confidence,
          freshness: record.freshness,
        });
      }

      const bundles = await client.bundleRecall(
        {
          spaceId: space.id,
          text: scenario.queryText,
          limit: 1,
        },
        {
          primaryLimit: 1,
          supportLimit: 6,
          bundleConsumer: scenario.bundleConsumer,
          bundleProvenanceMode: scenario.bundleProvenanceMode,
          bundleMaxSupporting: scenario.bundleMaxSupporting,
        },
      );

      assert.equal(
        bundles.length,
        1,
        `scenario ${scenario.id} should return one bundle`,
      );

      const bundle = bundles[0]!;
      const warnings = bundle.route.warnings;
      const supportingProvenanceCount = bundle.supporting.filter((entry) => entry.annotations.includes("provenance")).length;
      const totalProvenanceCount = supportingProvenanceCount + (bundle.primary.annotations.includes("provenance") ? 1 : 0);

      if (scenario.expect.route) {
        assert.equal(
          bundle.route.resolvedConsumer,
          scenario.expect.route,
          `scenario ${scenario.id} route mismatch`,
        );
      }

      if (scenario.expect.primarySummaryContains) {
        assert.match(
          bundle.primary.summary ?? "",
          new RegExp(scenario.expect.primarySummaryContains, "i"),
          `scenario ${scenario.id} primary summary mismatch`,
        );
      }

      for (const warning of scenario.expect.warningsInclude ?? []) {
        assert.ok(
          warnings.includes(warning as never),
          `scenario ${scenario.id} missing expected warning ${warning}`,
        );
      }

      for (const warning of scenario.expect.warningsExclude ?? []) {
        assert.ok(
          !warnings.includes(warning as never),
          `scenario ${scenario.id} should not include warning ${warning}`,
        );
      }

      if (scenario.expect.traceSummaryContains) {
        assert.match(
          bundle.trace.summary,
          new RegExp(scenario.expect.traceSummaryContains, "i"),
          `scenario ${scenario.id} trace summary mismatch`,
        );
      }

      if (scenario.expect.totalProvenanceMin !== undefined) {
        assert.ok(
          totalProvenanceCount >= scenario.expect.totalProvenanceMin,
          `scenario ${scenario.id} expected at least ${scenario.expect.totalProvenanceMin} provenance item(s), got ${totalProvenanceCount}`,
        );
      }

      if (scenario.expect.supportingProvenanceMax !== undefined) {
        assert.ok(
          supportingProvenanceCount <= scenario.expect.supportingProvenanceMax,
          `scenario ${scenario.id} expected at most ${scenario.expect.supportingProvenanceMax} supporting provenance item(s), got ${supportingProvenanceCount}`,
        );
      }
    } finally {
      client.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }
});
