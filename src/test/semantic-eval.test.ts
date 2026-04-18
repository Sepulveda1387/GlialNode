import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSemanticPrototypeCorpus, type SemanticEvalCorpus } from "../memory/semantic-eval.js";

test("semantic eval report computes pass/fail metrics and gate reason", () => {
  const corpus: SemanticEvalCorpus = {
    version: 1,
    scenarios: [
      {
        id: "s1",
        description: "Simple lexical query",
        queryText: "rollout checklist",
        records: [
          {
            summary: "Rollout checklist",
            content: "Ship rollout checklist with validation",
            kind: "task",
            importance: 0.8,
            confidence: 0.8,
            freshness: 0.8,
          },
        ],
        expect: {
          primarySummaryContains: "rollout checklist",
        },
      },
      {
        id: "s2",
        description: "Skipped when no explicit expectation exists",
        queryText: "misc",
        records: [
          {
            summary: "Misc",
            content: "Misc content",
            kind: "fact",
          },
        ],
      },
    ],
  };

  const report = evaluateSemanticPrototypeCorpus(corpus, {
    semanticWeight: 0.35,
    minDeltaTop1Accuracy: 0,
  });

  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.corpus.scenarioCount, 2);
  assert.equal(report.corpus.scoredScenarioCount, 1);
  assert.equal(report.metrics.lexicalTop1Accuracy, 1);
  assert.equal(report.metrics.semanticTop1Accuracy, 1);
  assert.equal(report.metrics.deltaTop1Accuracy, 0);
  assert.equal(report.passed, true);
  assert.equal(report.gate.passed, true);
});
