import type { MemoryEvent, MemoryRecord, MemoryRecordLink } from "../core/types.js";

export interface LearningLoopPolicy {
  enabled: boolean;
  minSuccessfulUses: number;
  maxSuggestions: number;
  reinforcementStrength: number;
  contradictionConfidenceGap: number;
}

export const defaultLearningLoopPolicy: LearningLoopPolicy = {
  enabled: true,
  minSuccessfulUses: 2,
  maxSuggestions: 10,
  reinforcementStrength: 1,
  contradictionConfidenceGap: 0.2,
};

export type LearningLoopSuggestionType =
  | "reinforce_repeated_success"
  | "calibrate_confidence"
  | "review_contradiction";

export interface LearningLoopSuggestion {
  type: LearningLoopSuggestionType;
  priority: "low" | "medium" | "high";
  recordId: string;
  relatedRecordId?: string;
  recommendedAction: "reinforce" | "review" | "supersede_lower_confidence";
  reason: string;
  evidence: {
    successfulUses?: number;
    eventIds?: string[];
    linkIds?: string[];
    confidenceGap?: number;
  };
  proposed?: {
    reinforcementStrength?: number;
  };
}

export interface LearningLoopPlan {
  generatedAt: string;
  policy: LearningLoopPolicy;
  summary: {
    recordsReviewed: number;
    reinforcementCandidates: number;
    contradictionCandidates: number;
    suggestions: number;
  };
  suggestions: LearningLoopSuggestion[];
}

export interface LearningLoopOptions {
  policy?: Partial<LearningLoopPolicy>;
  now?: Date;
}

interface SuccessfulUseEvidence {
  count: number;
  eventIds: string[];
}

export function planLearningLoop(
  records: MemoryRecord[],
  events: MemoryEvent[],
  links: MemoryRecordLink[],
  options: LearningLoopOptions = {},
): LearningLoopPlan {
  const policy = resolveLearningLoopPolicy(options.policy);
  if (!policy.enabled) {
    return emptyLearningLoopPlan(records.length, policy, options.now);
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const successfulUsesByRecordId = collectSuccessfulUseEvidence(events);
  const suggestions = [
    ...buildReinforcementSuggestions(records, successfulUsesByRecordId, policy),
    ...buildContradictionSuggestions(recordsById, links, policy),
  ]
    .sort(compareLearningSuggestions)
    .slice(0, Math.max(policy.maxSuggestions, 0));

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    policy,
    summary: {
      recordsReviewed: records.length,
      reinforcementCandidates: suggestions.filter((suggestion) =>
        suggestion.type === "reinforce_repeated_success" || suggestion.type === "calibrate_confidence",
      ).length,
      contradictionCandidates: suggestions.filter((suggestion) => suggestion.type === "review_contradiction").length,
      suggestions: suggestions.length,
    },
    suggestions,
  };
}

function resolveLearningLoopPolicy(policy: Partial<LearningLoopPolicy> | undefined): LearningLoopPolicy {
  const resolved = {
    ...defaultLearningLoopPolicy,
    ...definedLearningLoopPolicy(policy),
  };

  return {
    enabled: resolved.enabled,
    minSuccessfulUses: Math.max(1, Math.floor(resolved.minSuccessfulUses)),
    maxSuggestions: Math.max(0, Math.floor(resolved.maxSuggestions)),
    reinforcementStrength: clampPositive(resolved.reinforcementStrength, 1),
    contradictionConfidenceGap: clampPositive(resolved.contradictionConfidenceGap, 0.2),
  };
}

function definedLearningLoopPolicy(
  policy: Partial<LearningLoopPolicy> | undefined,
): Partial<LearningLoopPolicy> {
  if (!policy) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(policy).filter(([, value]) => value !== undefined),
  ) as Partial<LearningLoopPolicy>;
}

function emptyLearningLoopPlan(
  recordsReviewed: number,
  policy: LearningLoopPolicy,
  now: Date | undefined,
): LearningLoopPlan {
  return {
    generatedAt: (now ?? new Date()).toISOString(),
    policy,
    summary: {
      recordsReviewed,
      reinforcementCandidates: 0,
      contradictionCandidates: 0,
      suggestions: 0,
    },
    suggestions: [],
  };
}

function collectSuccessfulUseEvidence(events: MemoryEvent[]): Map<string, SuccessfulUseEvidence> {
  const evidence = new Map<string, SuccessfulUseEvidence>();
  for (const event of events) {
    if (event.type !== "memory_reinforced") {
      continue;
    }

    const recordId = typeof event.payload?.recordId === "string"
      ? event.payload.recordId
      : undefined;
    if (!recordId) {
      continue;
    }

    const current = evidence.get(recordId) ?? { count: 0, eventIds: [] };
    current.count += 1;
    current.eventIds.push(event.id);
    evidence.set(recordId, current);
  }
  return evidence;
}

function buildReinforcementSuggestions(
  records: MemoryRecord[],
  successfulUsesByRecordId: Map<string, SuccessfulUseEvidence>,
  policy: LearningLoopPolicy,
): LearningLoopSuggestion[] {
  return records.flatMap((record): LearningLoopSuggestion[] => {
    if (!isActiveLearningCandidate(record)) {
      return [];
    }

    const evidence = successfulUsesByRecordId.get(record.id);
    if (!evidence || evidence.count < policy.minSuccessfulUses) {
      return [];
    }

    const priority = evidence.count >= policy.minSuccessfulUses + 2 ? "high" : "medium";
    if (record.confidence >= 0.95 && record.freshness >= 0.95) {
      return [{
        type: "calibrate_confidence",
        priority,
        recordId: record.id,
        recommendedAction: "review",
        reason: `Record has ${evidence.count} successful reinforcement event(s) and is already near confidence/freshness ceiling.`,
        evidence: {
          successfulUses: evidence.count,
          eventIds: evidence.eventIds,
        },
      }];
    }

    return [{
      type: "reinforce_repeated_success",
      priority,
      recordId: record.id,
      recommendedAction: "reinforce",
      reason: `Record has ${evidence.count} successful reinforcement event(s), meeting the learning-loop threshold.`,
      evidence: {
        successfulUses: evidence.count,
        eventIds: evidence.eventIds,
      },
      proposed: {
        reinforcementStrength: policy.reinforcementStrength,
      },
    }];
  });
}

function buildContradictionSuggestions(
  recordsById: Map<string, MemoryRecord>,
  links: MemoryRecordLink[],
  policy: LearningLoopPolicy,
): LearningLoopSuggestion[] {
  return links
    .filter((link) => link.type === "contradicts")
    .flatMap((link): LearningLoopSuggestion[] => {
      const left = recordsById.get(link.fromRecordId);
      const right = recordsById.get(link.toRecordId);
      if (!left || !right || !isActiveLearningCandidate(left) || !isActiveLearningCandidate(right)) {
        return [];
      }

      const confidenceGap = Math.abs(left.confidence - right.confidence);
      const stronger = left.confidence >= right.confidence ? left : right;
      const weaker = stronger.id === left.id ? right : left;
      const shouldSupersede = confidenceGap >= policy.contradictionConfidenceGap;

      return [{
        type: "review_contradiction",
        priority: shouldSupersede ? "high" : "medium",
        recordId: stronger.id,
        relatedRecordId: weaker.id,
        recommendedAction: shouldSupersede ? "supersede_lower_confidence" : "review",
        reason: shouldSupersede
          ? `Contradictory records have a confidence gap of ${confidenceGap.toFixed(2)}; review whether the lower-confidence memory should be superseded.`
          : "Contradictory records are close in confidence; human review should decide which memory remains current.",
        evidence: {
          linkIds: [link.id],
          confidenceGap,
        },
      }];
    });
}

function compareLearningSuggestions(left: LearningLoopSuggestion, right: LearningLoopSuggestion): number {
  const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftEvidence = (left.evidence.successfulUses ?? 0) + (left.evidence.confidenceGap ?? 0);
  const rightEvidence = (right.evidence.successfulUses ?? 0) + (right.evidence.confidenceGap ?? 0);
  if (rightEvidence !== leftEvidence) {
    return rightEvidence - leftEvidence;
  }

  return left.recordId.localeCompare(right.recordId);
}

function priorityScore(priority: LearningLoopSuggestion["priority"]): number {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function isActiveLearningCandidate(record: MemoryRecord): boolean {
  return record.status === "active" || record.status === "superseded";
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(4)) : fallback;
}
