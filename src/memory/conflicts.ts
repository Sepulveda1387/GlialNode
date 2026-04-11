import { defaultConflictPolicy, type ConflictPolicy } from "../core/config.js";
import { createId } from "../core/ids.js";
import type { MemoryEvent, MemoryRecord, MemoryRecordLink } from "../core/types.js";
import { refreshCompactMemoryRecord } from "./compact.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "if", "in",
  "into", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "we", "with",
]);

const NEGATION_WORDS = new Set([
  "avoid", "disable", "disallow", "dont", "don't", "exclude", "forbid", "never",
  "no", "not", "reject", "remove", "without",
]);

const OPPOSING_PAIRS: Array<[string, string]> = [
  ["enable", "disable"],
  ["allow", "disallow"],
  ["prefer", "avoid"],
  ["keep", "remove"],
  ["include", "exclude"],
  ["use", "reject"],
];

export interface ConflictAction {
  reason: string;
  incomingRecord: MemoryRecord;
  conflictingRecord: MemoryRecord;
  updatedConflictingRecord: MemoryRecord;
}

export function detectConflicts(
  incomingRecord: MemoryRecord,
  existingRecords: MemoryRecord[],
  policy: Partial<ConflictPolicy> = {},
): ConflictAction[] {
  const resolvedPolicy: ConflictPolicy = {
    ...defaultConflictPolicy,
    ...policy,
  };

  if (!resolvedPolicy.enabled || !isConflictEligible(incomingRecord)) {
    return [];
  }

  const incomingTokens = extractSignalTokens(incomingRecord);

  return existingRecords
    .filter((record) => record.id !== incomingRecord.id)
    .filter((record) => record.spaceId === incomingRecord.spaceId)
    .filter((record) => record.scope.id === incomingRecord.scope.id && record.scope.type === incomingRecord.scope.type)
    .filter((record) => record.status === "active" || record.status === "superseded")
    .filter(isConflictEligible)
    .flatMap((record) => {
      const overlap = countOverlap(incomingTokens, extractSignalTokens(record));
      if (overlap < resolvedPolicy.minTokenOverlap) {
        return [];
      }

      if (!isContradictory(incomingRecord, record)) {
        return [];
      }

      return [{
        reason: "contradictory-durable-memory",
        incomingRecord,
        conflictingRecord: record,
        updatedConflictingRecord: refreshCompactMemoryRecord({
          ...record,
          confidence: Math.max(0, record.confidence - resolvedPolicy.confidencePenalty),
          updatedAt: incomingRecord.createdAt,
        }, false),
      }];
    });
}

export function createConflictLinks(actions: ConflictAction[]): MemoryRecordLink[] {
  return actions.map((action) => ({
    id: createId("link"),
    spaceId: action.incomingRecord.spaceId,
    fromRecordId: action.incomingRecord.id,
    toRecordId: action.conflictingRecord.id,
    type: "contradicts",
    createdAt: action.incomingRecord.createdAt,
  }));
}

export function createConflictEvents(actions: ConflictAction[]): MemoryEvent[] {
  return actions.map((action) => ({
    id: createId("evt"),
    spaceId: action.incomingRecord.spaceId,
    scope: action.incomingRecord.scope,
    actorType: "system",
    actorId: "glialnode-conflict",
    type: "memory_conflicted",
    summary: `Memory ${action.incomingRecord.id} contradicts ${action.conflictingRecord.id}.`,
    payload: {
      incomingRecordId: action.incomingRecord.id,
      conflictingRecordId: action.conflictingRecord.id,
      previousConfidence: action.conflictingRecord.confidence,
      nextConfidence: action.updatedConflictingRecord.confidence,
      reason: action.reason,
    },
    createdAt: action.incomingRecord.createdAt,
  }));
}

function isConflictEligible(record: MemoryRecord): boolean {
  return record.kind === "decision" || record.kind === "fact" || record.kind === "preference";
}

function extractSignalTokens(record: MemoryRecord): Set<string> {
  return new Set(
    `${record.summary ?? ""} ${record.content} ${record.tags.join(" ")}`
      .toLowerCase()
      .split(/[^a-z0-9']+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function isContradictory(left: MemoryRecord, right: MemoryRecord): boolean {
  const leftTokens = extractSignalTokens(left);
  const rightTokens = extractSignalTokens(right);

  if (containsNegation(leftTokens) !== containsNegation(rightTokens)) {
    return true;
  }

  for (const [positive, negative] of OPPOSING_PAIRS) {
    const leftPositive = leftTokens.has(positive);
    const leftNegative = leftTokens.has(negative);
    const rightPositive = rightTokens.has(positive);
    const rightNegative = rightTokens.has(negative);

    if ((leftPositive && rightNegative) || (leftNegative && rightPositive)) {
      return true;
    }
  }

  return false;
}

function containsNegation(tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (NEGATION_WORDS.has(token)) {
      return true;
    }
  }
  return false;
}
