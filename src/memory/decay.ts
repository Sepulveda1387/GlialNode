import { defaultDecayPolicy, type DecayPolicy } from "../core/config.js";
import { createId } from "../core/ids.js";
import type { MemoryEvent, MemoryRecord, MemoryRecordLink } from "../core/types.js";
import { refreshCompactMemoryRecord } from "./compact.js";
import { createMemoryRecord } from "./service.js";

export interface DecayAction {
  reason: string;
  before: MemoryRecord;
  after: MemoryRecord;
  ageDays: number;
  confidenceDelta: number;
  freshnessDelta: number;
}

export interface DecayPlan {
  decayed: DecayAction[];
}

export function planDecay(
  records: MemoryRecord[],
  policy: Partial<DecayPolicy> = {},
  now: Date = new Date(),
): DecayPlan {
  const resolvedPolicy: DecayPolicy = {
    ...defaultDecayPolicy,
    ...policy,
  };

  if (!resolvedPolicy.enabled) {
    return { decayed: [] };
  }

  const decayed = records
    .filter(isDecayEligible)
    .flatMap((record) => {
      const ageDays = getAgeDays(record.updatedAt, now);

      if (ageDays < resolvedPolicy.minAgeDays) {
        return [];
      }

      const elapsedDecayDays = ageDays - resolvedPolicy.minAgeDays;
      const nextConfidence = clampFloor(
        record.confidence - elapsedDecayDays * resolvedPolicy.confidenceDecayPerDay,
        resolvedPolicy.minConfidence,
      );
      const nextFreshness = clampFloor(
        record.freshness - elapsedDecayDays * resolvedPolicy.freshnessDecayPerDay,
        resolvedPolicy.minFreshness,
      );

      if (nextConfidence === record.confidence && nextFreshness === record.freshness) {
        return [];
      }

      const decayedRecord = refreshCompactMemoryRecord(
        {
          ...record,
          confidence: nextConfidence,
          freshness: nextFreshness,
          updatedAt: now.toISOString(),
        },
        false,
      );

      return [{
        reason: "stale-durable-memory",
        before: record,
        after: decayedRecord,
        ageDays,
        confidenceDelta: record.confidence - nextConfidence,
        freshnessDelta: record.freshness - nextFreshness,
      }];
    });

  return { decayed };
}

export function summarizeDecayPlan(plan: DecayPlan): string[] {
  return [
    `decayed=${plan.decayed.length}`,
    ...plan.decayed.map((action) =>
      `decay ${action.before.id} ${action.ageDays.toFixed(1)}d cf-${action.confidenceDelta.toFixed(2)} fr-${action.freshnessDelta.toFixed(2)} ${action.reason}`,
    ),
  ];
}

export function applyDecayPlan(plan: DecayPlan): MemoryRecord[] {
  return plan.decayed.map((action) => action.after);
}

export function createDecayEvents(plan: DecayPlan): MemoryEvent[] {
  return plan.decayed.map((action) => ({
    id: createId("evt"),
    spaceId: action.after.spaceId,
    scope: action.after.scope,
    actorType: "system",
    actorId: "glialnode-decay",
    type: "memory_decayed",
    summary: `Decay lowered trust in ${action.before.id} after ${action.ageDays.toFixed(1)} day(s).`,
    payload: {
      recordId: action.before.id,
      ageDays: action.ageDays,
      previousConfidence: action.before.confidence,
      nextConfidence: action.after.confidence,
      previousFreshness: action.before.freshness,
      nextFreshness: action.after.freshness,
      reason: action.reason,
    },
    createdAt: action.after.updatedAt,
  }));
}

export function createDecaySummaryRecord(plan: DecayPlan): MemoryRecord | null {
  if (plan.decayed.length === 0) {
    return null;
  }

  const anchor = plan.decayed[0]!.after;
  return createMemoryRecord({
    spaceId: anchor.spaceId,
    tier: "mid",
    kind: "summary",
    content: `Decay sweep lowered trust on ${plan.decayed.length} stale durable record(s).`,
    summary: "Decay summary",
    scope: anchor.scope,
    visibility: "space",
    tags: ["decay", "system"],
    importance: 0.6,
    confidence: 1,
    freshness: 0.65,
  });
}

export function createDecaySummaryLinks(summaryRecord: MemoryRecord, plan: DecayPlan): MemoryRecordLink[] {
  return plan.decayed.map((action) => ({
    id: createId("link"),
    spaceId: summaryRecord.spaceId,
    fromRecordId: summaryRecord.id,
    toRecordId: action.after.id,
    type: "references",
    createdAt: summaryRecord.createdAt,
  }));
}

function isDecayEligible(record: MemoryRecord): boolean {
  if (record.status !== "active" && record.status !== "superseded") {
    return false;
  }

  if (record.kind !== "decision" && record.kind !== "fact" && record.kind !== "preference" && record.kind !== "summary") {
    return false;
  }

  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return !lowerTags.has("system");
}

function getAgeDays(timestamp: string, now: Date): number {
  const updatedTime = new Date(timestamp).getTime();
  return Math.max((now.getTime() - updatedTime) / (1000 * 60 * 60 * 24), 0);
}

function clampFloor(value: number, floor: number): number {
  return Math.max(floor, Number(value.toFixed(4)));
}
