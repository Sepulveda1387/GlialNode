import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSafeFtsQuery,
  createMemoryRecord,
  rankRecordsForRetrieval,
  rerankRecordsWithSemanticPrototype,
  resolveMemoryBundleRouteReasoning,
} from "../index.js";

test("safe FTS query builder quotes punctuation-heavy tokens", () => {
  const query = buildSafeFtsQuery('trust:anchored policy-review "quoted phrase"');

  assert.equal(query, "\"trust:anchored\" AND \"policy-review\" AND \"quoted phrase\"");
});

test("safe FTS query builder escapes embedded quotes inside a token", () => {
  const query = buildSafeFtsQuery("alpha beta\"quote");

  assert.equal(query, "\"alpha\" AND \"beta\"\"quote\"");
});

test("route reasoning auto-routes provenance-heavy bundles to reviewer", () => {
  const primary = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "fact",
    content: "Review anchor policy coverage for signed imports.",
    summary: "Trust policy review",
    scope: { id: "scope_1", type: "agent" },
    tags: ["trust"],
    confidence: 0.8,
    freshness: 0.76,
  });
  const supportingProvenance = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "summary",
    content: "Bundle import audit for trust review.",
    summary: "Bundle import audit",
    scope: { id: "scope_1", type: "agent" },
    tags: ["provenance", "bundle", "audit"],
    confidence: 0.88,
    freshness: 0.8,
  });

  const reasoning = resolveMemoryBundleRouteReasoning(
    primary,
    [supportingProvenance],
    [],
    { consumer: "auto" },
  );

  assert.equal(reasoning.route.source, "auto");
  assert.equal(reasoning.route.resolvedConsumer, "reviewer");
  assert.ok(reasoning.hints.includes("contains_provenance_memory"));
  assert.match(reasoning.route.reason, /provenance audit memory/i);
});

test("route reasoning keeps explicit consumer selection with clear reason text", () => {
  const primary = createMemoryRecord({
    spaceId: "space_1",
    tier: "short",
    kind: "task",
    content: "Ship the release checklist update.",
    summary: "Ship release checklist",
    scope: { id: "scope_1", type: "agent" },
    tags: ["release"],
  });

  const reasoning = resolveMemoryBundleRouteReasoning(
    primary,
    [],
    [],
    { consumer: "executor" },
  );

  assert.equal(reasoning.route.source, "explicit");
  assert.equal(reasoning.route.resolvedConsumer, "executor");
  assert.match(reasoning.route.reason, /explicit executor routing/i);
});

test("semantic prototype reranker can prioritize semantically aligned records when explicitly enabled", () => {
  const unrelatedHighConfidence = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "fact",
    content: "General release cadence and deployment baseline guidance.",
    summary: "General release policy",
    scope: { id: "scope_1", type: "agent" },
    importance: 0.98,
    confidence: 0.98,
    freshness: 0.95,
  });
  const relevantLowerConfidence = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "decision",
    content: "Signer rollbackzz checklist for trust-anchor rotation incidents.",
    summary: "Rollback checklist",
    scope: { id: "scope_1", type: "agent" },
    importance: 0.45,
    confidence: 0.45,
    freshness: 0.45,
  });

  const records = [unrelatedHighConfidence, relevantLowerConfidence];
  const lexicalOnly = rankRecordsForRetrieval(records, "rollbackzz");
  assert.equal(lexicalOnly.length, records.length);

  const semantic = rerankRecordsWithSemanticPrototype(records, "rollbackzz", {
    enabled: true,
    semanticWeight: 1,
  });
  assert.equal(semantic.applied, true);
  assert.equal(semantic.records.length, records.length);
  assert.ok(semantic.queryTokenCount >= 1);
  assert.equal(semantic.gate.allowed, true);
});

test("semantic prototype reranker respects a failed required gate and leaves lexical order unchanged", () => {
  const first = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "fact",
    content: "Lexical default baseline.",
    summary: "Lexical baseline",
    scope: { id: "scope_1", type: "agent" },
  });
  const second = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "task",
    content: "Semantic candidate baseline.",
    summary: "Semantic candidate",
    scope: { id: "scope_1", type: "agent" },
  });
  const records = [first, second];

  const blocked = rerankRecordsWithSemanticPrototype(records, "semantic candidate", {
    enabled: true,
    semanticWeight: 1,
    gate: {
      requirePass: true,
      passed: false,
      reportId: "eval-report-1",
      reason: "delta did not clear threshold",
    },
  });

  assert.equal(blocked.applied, false);
  assert.equal(blocked.gate.required, true);
  assert.equal(blocked.gate.allowed, false);
  assert.equal(blocked.gate.reportId, "eval-report-1");
  assert.deepEqual(blocked.records.map((record) => record.id), records.map((record) => record.id));
});
