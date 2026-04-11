import { createId } from "../core/ids.js";
import { defaultRetentionPolicy, type RetentionPolicy } from "../core/config.js";
import type { MemoryEvent, MemoryRecord, MemoryRecordLink, MemoryTier } from "../core/types.js";
import { createMemoryRecord, updateRecordStatus } from "./service.js";

export interface RetentionAction {
  reason: string;
  before: MemoryRecord;
  after: MemoryRecord;
  retentionDays: number;
}

export interface RetentionPlan {
  expired: RetentionAction[];
}

export function planRetention(
  records: MemoryRecord[],
  policy: RetentionPolicy = {},
  now: Date = new Date(),
): RetentionPlan {
  const resolvedPolicy: RetentionPolicy = {
    ...defaultRetentionPolicy,
    ...policy,
  };

  const expired = records
    .filter((record) => record.status === "active")
    .flatMap((record) => {
      const retentionDays = resolvedPolicy[record.tier];

      if (retentionDays === undefined) {
        return [];
      }

      if (!isPastRetention(record, retentionDays, now)) {
        return [];
      }

      return [
        {
          reason: `${record.tier}-retention-window-exceeded`,
          before: record,
          after: expireRecord(record, now),
          retentionDays,
        },
      ];
    });

  return { expired };
}

export function summarizeRetentionPlan(plan: RetentionPlan): string[] {
  return [
    `expired=${plan.expired.length}`,
    ...plan.expired.map(
      (action) =>
        `expire ${action.before.id} ${action.before.tier} ${action.retentionDays}d ${action.reason}`,
    ),
  ];
}

export function applyRetentionPlan(plan: RetentionPlan): MemoryRecord[] {
  return plan.expired.map((action) => action.after);
}

export function createRetentionEvents(plan: RetentionPlan): MemoryEvent[] {
  return plan.expired.map((action) => ({
    id: createId("evt"),
    spaceId: action.after.spaceId,
    scope: action.after.scope,
    actorType: "system",
    actorId: "glialnode-retain",
    type: "memory_expired",
    summary: `Retention expired ${action.before.id} after ${action.retentionDays} day(s).`,
    payload: {
      recordId: action.before.id,
      tier: action.before.tier,
      retentionDays: action.retentionDays,
      previousStatus: action.before.status,
      nextStatus: action.after.status,
      reason: action.reason,
    },
    createdAt: action.after.updatedAt,
  }));
}

export function createRetentionSummaryRecord(plan: RetentionPlan): MemoryRecord | null {
  if (plan.expired.length === 0) {
    return null;
  }

  const anchor = plan.expired[0]!.after;

  return createMemoryRecord({
    spaceId: anchor.spaceId,
    tier: "mid",
    kind: "summary",
    content: `Retention sweep expired ${plan.expired.length} record(s).`,
    summary: "Retention summary",
    scope: anchor.scope,
    visibility: "space",
    tags: ["retention", "system"],
    importance: 0.6,
    confidence: 1,
    freshness: 0.7,
  });
}

export function createRetentionSummaryLinks(
  summaryRecord: MemoryRecord,
  plan: RetentionPlan,
): MemoryRecordLink[] {
  return plan.expired.map((action) => ({
    id: createId("link"),
    spaceId: summaryRecord.spaceId,
    fromRecordId: summaryRecord.id,
    toRecordId: action.after.id,
    type: "references",
    createdAt: summaryRecord.createdAt,
  }));
}

function expireRecord(record: MemoryRecord, now: Date): MemoryRecord {
  const expired = updateRecordStatus(record, "expired");
  const timestamp = now.toISOString();

  return {
    ...expired,
    updatedAt: timestamp,
    expiresAt: timestamp,
  };
}

function isPastRetention(record: MemoryRecord, retentionDays: number, now: Date): boolean {
  const updatedTime = new Date(record.updatedAt).getTime();
  const ageDays = (now.getTime() - updatedTime) / (1000 * 60 * 60 * 24);
  return ageDays >= retentionDays;
}
