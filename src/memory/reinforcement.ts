import { defaultReinforcementPolicy, type ReinforcementPolicy } from "../core/config.js";
import { createId } from "../core/ids.js";
import type { MemoryEvent, MemoryRecord, MemoryRecordLink } from "../core/types.js";
import { refreshCompactMemoryRecord } from "./compact.js";
import { createMemoryRecord } from "./service.js";

export interface ReinforcementAction {
  reason: string;
  strength: number;
  before: MemoryRecord;
  after: MemoryRecord;
  confidenceDelta: number;
  freshnessDelta: number;
}

export interface ReinforcementPlan {
  reinforced: ReinforcementAction[];
}

export interface ReinforcementOptions {
  recordIds?: string[];
  reason?: string;
  strength?: number;
  now?: Date;
}

export function planReinforcement(
  records: MemoryRecord[],
  policy: Partial<ReinforcementPolicy> = {},
  options: ReinforcementOptions = {},
): ReinforcementPlan {
  const resolvedPolicy: ReinforcementPolicy = {
    ...defaultReinforcementPolicy,
    ...policy,
  };

  if (!resolvedPolicy.enabled) {
    return { reinforced: [] };
  }

  const targetIds = options.recordIds ? new Set(options.recordIds) : null;
  const strength = clampStrength(options.strength ?? 1);
  const now = options.now ?? new Date();
  const reason = options.reason?.trim() || "explicit-reinforcement";

  const reinforced = records
    .filter((record) => (targetIds ? targetIds.has(record.id) : true))
    .filter(isReinforcementEligible)
    .flatMap((record) => {
      const nextConfidence = clampCeiling(
        record.confidence + resolvedPolicy.confidenceBoost * strength,
        resolvedPolicy.maxConfidence,
      );
      const nextFreshness = clampCeiling(
        record.freshness + resolvedPolicy.freshnessBoost * strength,
        resolvedPolicy.maxFreshness,
      );

      if (nextConfidence === record.confidence && nextFreshness === record.freshness) {
        return [];
      }

      const reinforcedRecord = refreshCompactMemoryRecord(
        {
          ...record,
          confidence: nextConfidence,
          freshness: nextFreshness,
          updatedAt: now.toISOString(),
        },
        false,
      );

      return [{
        reason,
        strength,
        before: record,
        after: reinforcedRecord,
        confidenceDelta: nextConfidence - record.confidence,
        freshnessDelta: nextFreshness - record.freshness,
      }];
    });

  return { reinforced };
}

export function summarizeReinforcementPlan(plan: ReinforcementPlan): string[] {
  return [
    `reinforced=${plan.reinforced.length}`,
    ...plan.reinforced.map((action) =>
      `reinforce ${action.before.id} x${action.strength.toFixed(2)} cf+${action.confidenceDelta.toFixed(2)} fr+${action.freshnessDelta.toFixed(2)} ${action.reason}`,
    ),
  ];
}

export function applyReinforcementPlan(plan: ReinforcementPlan): MemoryRecord[] {
  return plan.reinforced.map((action) => action.after);
}

export function createReinforcementEvents(plan: ReinforcementPlan): MemoryEvent[] {
  return plan.reinforced.map((action) => ({
    id: createId("evt"),
    spaceId: action.after.spaceId,
    scope: action.after.scope,
    actorType: "system",
    actorId: "glialnode-reinforcement",
    type: "memory_reinforced",
    summary: `Reinforcement strengthened ${action.before.id} with reason ${action.reason}.`,
    payload: {
      recordId: action.before.id,
      reason: action.reason,
      strength: action.strength,
      previousConfidence: action.before.confidence,
      nextConfidence: action.after.confidence,
      previousFreshness: action.before.freshness,
      nextFreshness: action.after.freshness,
    },
    createdAt: action.after.updatedAt,
  }));
}

export function createReinforcementSummaryRecord(plan: ReinforcementPlan): MemoryRecord | null {
  if (plan.reinforced.length === 0) {
    return null;
  }

  const anchor = plan.reinforced[0]!.after;
  return createMemoryRecord({
    spaceId: anchor.spaceId,
    tier: "mid",
    kind: "summary",
    content: `Reinforcement strengthened ${plan.reinforced.length} memory record(s).`,
    summary: "Reinforcement summary",
    scope: anchor.scope,
    visibility: "space",
    tags: ["reinforcement", "system"],
    importance: 0.58,
    confidence: 1,
    freshness: 0.72,
  });
}

export function createReinforcementSummaryLinks(
  summaryRecord: MemoryRecord,
  plan: ReinforcementPlan,
): MemoryRecordLink[] {
  return plan.reinforced.map((action) => ({
    id: createId("link"),
    spaceId: summaryRecord.spaceId,
    fromRecordId: summaryRecord.id,
    toRecordId: action.after.id,
    type: "references",
    createdAt: summaryRecord.createdAt,
  }));
}

function isReinforcementEligible(record: MemoryRecord): boolean {
  return record.status === "active" || record.status === "superseded";
}

function clampStrength(value: number): number {
  if (Number.isNaN(value) || value <= 0) {
    return 1;
  }

  return Number(value.toFixed(4));
}

function clampCeiling(value: number, ceiling: number): number {
  return Math.min(ceiling, Number(value.toFixed(4)));
}
