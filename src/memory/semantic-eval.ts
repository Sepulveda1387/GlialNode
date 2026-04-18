import type { MemoryKind } from "../core/types.js";
import { createMemoryRecord } from "./service.js";
import { rankRecordsForRetrieval, rerankRecordsWithSemanticPrototype } from "./retrieval.js";

export interface SemanticEvalRecordFixture {
  summary: string;
  content: string;
  kind: MemoryKind;
  tags?: string[];
  importance?: number;
  confidence?: number;
  freshness?: number;
}

export interface SemanticEvalScenario {
  id: string;
  description: string;
  queryText: string;
  records: SemanticEvalRecordFixture[];
  expect?: {
    primarySummaryContains?: string;
  };
}

export interface SemanticEvalCorpus {
  version: number;
  scenarios: SemanticEvalScenario[];
}

export interface SemanticEvalOptions {
  semanticWeight?: number;
  minDeltaTop1Accuracy?: number;
}

export interface SemanticEvalScenarioResult {
  id: string;
  description: string;
  queryText: string;
  expectedPrimarySummaryPattern?: string;
  lexicalTop1Summary?: string;
  semanticTop1Summary?: string;
  lexicalTop1Matched: boolean;
  semanticTop1Matched: boolean;
  skipped: boolean;
}

export interface SemanticEvalReport {
  schemaVersion: "1.0.0";
  reportId: string;
  generatedAt: string;
  corpus: {
    version: number;
    scenarioCount: number;
    scoredScenarioCount: number;
  };
  semantic: {
    semanticWeight: number;
  };
  metrics: {
    lexicalTop1Accuracy: number;
    semanticTop1Accuracy: number;
    deltaTop1Accuracy: number;
    lexicalWins: number;
    semanticWins: number;
    ties: number;
  };
  passCriteria: {
    minDeltaTop1Accuracy: number;
  };
  passed: boolean;
  gate: {
    requirePass: true;
    passed: boolean;
    reason: string;
  };
  scenarios: SemanticEvalScenarioResult[];
}

export function evaluateSemanticPrototypeCorpus(
  corpus: SemanticEvalCorpus,
  options: SemanticEvalOptions = {},
): SemanticEvalReport {
  const generatedAt = new Date().toISOString();
  const semanticWeight = clamp01(options.semanticWeight ?? 0.35);
  const minDeltaTop1Accuracy = options.minDeltaTop1Accuracy ?? 0;

  let scoredScenarioCount = 0;
  let lexicalMatches = 0;
  let semanticMatches = 0;
  let lexicalWins = 0;
  let semanticWins = 0;
  let ties = 0;
  const scenarioResults: SemanticEvalScenarioResult[] = [];

  for (const scenario of corpus.scenarios) {
    const expectedPattern = scenario.expect?.primarySummaryContains;
    if (!expectedPattern) {
      scenarioResults.push({
        id: scenario.id,
        description: scenario.description,
        queryText: scenario.queryText,
        skipped: true,
        lexicalTop1Matched: false,
        semanticTop1Matched: false,
      });
      continue;
    }

    scoredScenarioCount += 1;
    const records = scenario.records.map((record, index) =>
      createMemoryRecord({
        spaceId: `semantic_eval_${scenario.id}`,
        scope: { id: "scope_eval", type: "agent" },
        tier: "mid",
        kind: record.kind,
        summary: record.summary,
        content: record.content,
        tags: record.tags,
        importance: record.importance,
        confidence: record.confidence,
        freshness: record.freshness,
        sourceEventId: `evt_${scenario.id}_${index}`,
      }),
    );

    const lexicalTop = rankRecordsForRetrieval(records, scenario.queryText)[0];
    const semanticTop = rerankRecordsWithSemanticPrototype(records, scenario.queryText, {
      enabled: true,
      semanticWeight,
    }).records[0];

    const pattern = new RegExp(expectedPattern, "i");
    const lexicalTop1Summary = lexicalTop?.summary ?? lexicalTop?.content;
    const semanticTop1Summary = semanticTop?.summary ?? semanticTop?.content;
    const lexicalTop1Matched = lexicalTop1Summary ? pattern.test(lexicalTop1Summary) : false;
    const semanticTop1Matched = semanticTop1Summary ? pattern.test(semanticTop1Summary) : false;

    if (lexicalTop1Matched) {
      lexicalMatches += 1;
    }
    if (semanticTop1Matched) {
      semanticMatches += 1;
    }
    if (lexicalTop1Matched && semanticTop1Matched) {
      ties += 1;
    } else if (semanticTop1Matched) {
      semanticWins += 1;
    } else if (lexicalTop1Matched) {
      lexicalWins += 1;
    } else {
      ties += 1;
    }

    scenarioResults.push({
      id: scenario.id,
      description: scenario.description,
      queryText: scenario.queryText,
      expectedPrimarySummaryPattern: expectedPattern,
      lexicalTop1Summary,
      semanticTop1Summary,
      lexicalTop1Matched,
      semanticTop1Matched,
      skipped: false,
    });
  }

  const lexicalTop1Accuracy = scoredScenarioCount === 0 ? 0 : lexicalMatches / scoredScenarioCount;
  const semanticTop1Accuracy = scoredScenarioCount === 0 ? 0 : semanticMatches / scoredScenarioCount;
  const deltaTop1Accuracy = semanticTop1Accuracy - lexicalTop1Accuracy;
  const passed = scoredScenarioCount > 0 &&
    semanticTop1Accuracy >= lexicalTop1Accuracy &&
    deltaTop1Accuracy >= minDeltaTop1Accuracy;
  const reason = passed
    ? `Semantic top-1 accuracy (${semanticTop1Accuracy.toFixed(3)}) met gate threshold delta >= ${minDeltaTop1Accuracy.toFixed(3)}.`
    : `Semantic gate failed: lexical=${lexicalTop1Accuracy.toFixed(3)}, semantic=${semanticTop1Accuracy.toFixed(3)}, delta=${deltaTop1Accuracy.toFixed(3)}, minDelta=${minDeltaTop1Accuracy.toFixed(3)}.`;

  return {
    schemaVersion: "1.0.0",
    reportId: `semantic-eval-v${corpus.version}-${generatedAt}`,
    generatedAt,
    corpus: {
      version: corpus.version,
      scenarioCount: corpus.scenarios.length,
      scoredScenarioCount,
    },
    semantic: {
      semanticWeight,
    },
    metrics: {
      lexicalTop1Accuracy,
      semanticTop1Accuracy,
      deltaTop1Accuracy,
      lexicalWins,
      semanticWins,
      ties,
    },
    passCriteria: {
      minDeltaTop1Accuracy,
    },
    passed,
    gate: {
      requirePass: true,
      passed,
      reason,
    },
    scenarios: scenarioResults,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.35;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
