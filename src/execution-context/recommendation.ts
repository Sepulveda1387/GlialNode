import type {
  CreateExecutionContextTaskFingerprintInput,
  ExecutionContextRecord,
  ExecutionContextTaskFingerprint,
} from "./model.js";
import {
  assertExecutionContextRecord,
  createExecutionContextTaskFingerprint,
} from "./model.js";

export interface RecommendExecutionContextInput extends CreateExecutionContextTaskFingerprintInput {
  readonly availableSkills?: readonly string[];
  readonly availableTools?: readonly string[];
  readonly records?: readonly ExecutionContextRecord[];
  readonly now?: string;
  readonly maxRecommendations?: number;
}

export interface ExecutionContextRecommendation {
  readonly schemaVersion: "1.0.0";
  readonly generatedAt: string;
  readonly taskFingerprint: ExecutionContextTaskFingerprint;
  readonly confidence: "low" | "medium" | "high";
  readonly selectedSkills: readonly string[];
  readonly selectedTools: readonly string[];
  readonly avoidTools: readonly string[];
  readonly firstReads: readonly string[];
  readonly matchedRecords: number;
  readonly ignoredExpiredRecords: number;
  readonly explanations: readonly string[];
  readonly warnings: readonly string[];
}

interface WeightedValue {
  readonly value: string;
  score: number;
}

export function recommendExecutionContext(input: RecommendExecutionContextInput): ExecutionContextRecommendation {
  const generatedAt = input.now ?? new Date().toISOString();
  const taskFingerprint = createExecutionContextTaskFingerprint(input);
  const availableSkills = input.availableSkills ? new Set(input.availableSkills) : undefined;
  const availableTools = input.availableTools ? new Set(input.availableTools) : undefined;
  const maxRecommendations = input.maxRecommendations ?? 5;
  const selectedSkills = new Map<string, WeightedValue>();
  const selectedTools = new Map<string, WeightedValue>();
  const avoidTools = new Map<string, WeightedValue>();
  const firstReads = new Map<string, WeightedValue>();
  const warnings: string[] = [];
  let matchedRecords = 0;
  let ignoredExpiredRecords = 0;
  let bestScore = 0;

  for (const record of input.records ?? []) {
    assertExecutionContextRecord(record);

    if (!sameFingerprint(record.taskFingerprint, taskFingerprint)) {
      continue;
    }

    if (Date.parse(record.expiresAt) <= Date.parse(generatedAt)) {
      ignoredExpiredRecords += 1;
      continue;
    }

    matchedRecords += 1;
    const recordScore = scoreRecord(record);
    bestScore = Math.max(bestScore, recordScore);

    for (const skill of record.selectedSkills) {
      addWeighted(selectedSkills, skill, recordScore);
    }
    for (const tool of record.selectedTools) {
      addWeighted(selectedTools, tool, recordScore);
    }
    for (const tool of record.skippedTools) {
      addWeighted(avoidTools, tool, Math.max(1, recordScore));
    }
    for (const read of record.firstReads) {
      addWeighted(firstReads, read, recordScore);
    }
  }

  const filteredSkills = rankValues(selectedSkills, maxRecommendations)
    .filter((skill) => availableSkills ? availableSkills.has(skill) : true);
  const unavailableSkills = rankValues(selectedSkills, maxRecommendations)
    .filter((skill) => availableSkills ? !availableSkills.has(skill) : false);
  const filteredTools = rankValues(selectedTools, maxRecommendations)
    .filter((tool) => availableTools ? availableTools.has(tool) : true);
  const unavailableTools = rankValues(selectedTools, maxRecommendations)
    .filter((tool) => availableTools ? !availableTools.has(tool) : false);
  const filteredAvoidTools = rankValues(avoidTools, maxRecommendations)
    .filter((tool) => availableTools ? availableTools.has(tool) : true);

  if (unavailableSkills.length > 0) {
    warnings.push(`Ignored unavailable skill recommendation(s): ${unavailableSkills.join(", ")}`);
  }
  if (unavailableTools.length > 0) {
    warnings.push(`Ignored unavailable tool recommendation(s): ${unavailableTools.join(", ")}`);
  }
  if (ignoredExpiredRecords > 0) {
    warnings.push(`Ignored ${ignoredExpiredRecords} expired execution-context record(s).`);
  }
  if (matchedRecords === 0) {
    warnings.push("No matching execution-context records found; use normal discovery and record the outcome afterward.");
  }

  return {
    schemaVersion: "1.0.0",
    generatedAt,
    taskFingerprint,
    confidence: confidenceFromScore(bestScore, matchedRecords),
    selectedSkills: filteredSkills,
    selectedTools: filteredTools,
    avoidTools: filteredAvoidTools,
    firstReads: rankValues(firstReads, maxRecommendations),
    matchedRecords,
    ignoredExpiredRecords,
    explanations: [
      "Recommendation is based on matching task fingerprints and non-expired execution-context records.",
      "The API accepts task text only to create a fingerprint; raw task text is not returned.",
      "Recommendations are advisory and should be ignored when they conflict with current tool availability or task risk.",
    ],
    warnings,
  };
}

function sameFingerprint(left: ExecutionContextTaskFingerprint, right: ExecutionContextTaskFingerprint): boolean {
  return left.method === right.method && left.hash === right.hash;
}

function scoreRecord(record: ExecutionContextRecord): number {
  const outcomeScore = record.outcome.state === "success"
    ? 4
    : record.outcome.state === "partial"
    ? 2
    : record.outcome.state === "failed"
    ? -2
    : 0;
  const confidenceScore = record.confidence === "high" ? 2 : record.confidence === "medium" ? 1 : 0;
  return Math.max(0, outcomeScore + confidenceScore);
}

function addWeighted(target: Map<string, WeightedValue>, value: string, score: number): void {
  if (score <= 0) {
    return;
  }
  const current = target.get(value) ?? { value, score: 0 };
  current.score += score;
  target.set(value, current);
}

function rankValues(values: Map<string, WeightedValue>, maxRecommendations: number): string[] {
  return [...values.values()]
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
    .slice(0, Math.max(0, maxRecommendations))
    .map((entry) => entry.value);
}

function confidenceFromScore(bestScore: number, matchedRecords: number): "low" | "medium" | "high" {
  if (matchedRecords >= 2 && bestScore >= 6) {
    return "high";
  }
  if (matchedRecords >= 1 && bestScore >= 3) {
    return "medium";
  }
  return "low";
}
