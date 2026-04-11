import { createId } from "../core/ids.js";
import { defaultCompactionPolicy, type CompactionPolicy } from "../core/config.js";
import type { MemoryEvent, MemoryRecord, MemoryRecordLink } from "../core/types.js";
import { refreshCompactMemoryRecord, shouldRefreshCompactMemory } from "./compact.js";
import { promoteRecord } from "./promotion.js";
import { createMemoryRecord, updateRecordStatus } from "./service.js";

export type CompactionActionType = "promote" | "archive" | "refresh";

export interface CompactionAction {
  type: CompactionActionType;
  reason: string;
  before: MemoryRecord;
  after: MemoryRecord;
}

export interface CompactionPlan {
  promoted: CompactionAction[];
  archived: CompactionAction[];
  refreshed: CompactionAction[];
}

export function planCompaction(
  records: MemoryRecord[],
  policy: Partial<CompactionPolicy> = {},
): CompactionPlan {
  const resolvedPolicy: CompactionPolicy = {
    ...defaultCompactionPolicy,
    ...policy,
  };
  const promoted: CompactionAction[] = [];
  const archived: CompactionAction[] = [];
  const refreshed: CompactionAction[] = [];

  for (const record of records) {
    if (record.status !== "active") {
      continue;
    }

    if (shouldPromote(record, resolvedPolicy)) {
      promoted.push({
        type: "promote",
        reason: promotionReason(record),
        before: record,
        after: promoteRecord(record),
      });
      continue;
    }

    if (shouldArchive(record, resolvedPolicy)) {
      archived.push({
        type: "archive",
        reason: "low-importance-and-stale",
        before: record,
        after: updateRecordStatus(record, "archived"),
      });
      continue;
    }

    if (shouldRefreshCompactMemory(record)) {
      refreshed.push({
        type: "refresh",
        reason: "compact-memory-refresh",
        before: record,
        after: refreshCompactMemoryRecord(record),
      });
    }
  }

  return { promoted, archived, refreshed };
}

export function summarizeCompactionPlan(plan: CompactionPlan): string[] {
  const lines: string[] = [
    `promotions=${plan.promoted.length}`,
    `archives=${plan.archived.length}`,
    `refreshed=${plan.refreshed.length}`,
  ];

  for (const action of plan.promoted) {
    lines.push(
      `promote ${action.before.id} ${action.before.tier}->${action.after.tier} ${action.reason}`,
    );
  }

  for (const action of plan.archived) {
    lines.push(
      `archive ${action.before.id} ${action.before.tier} ${action.reason}`,
    );
  }

  for (const action of plan.refreshed) {
    lines.push(`refresh ${action.before.id} ${action.reason}`);
  }

  return lines;
}

function shouldPromote(record: MemoryRecord, policy: CompactionPolicy): boolean {
  if (record.tier === "long") {
    return false;
  }

  if (
    record.tier === "short" &&
    record.importance >= policy.shortPromoteImportanceMin &&
    record.confidence >= policy.shortPromoteConfidenceMin
  ) {
    return true;
  }

  if (
    record.tier === "mid" &&
    isDurableKind(record.kind) &&
    record.importance >= policy.midPromoteImportanceMin &&
    record.confidence >= policy.midPromoteConfidenceMin &&
    record.freshness >= policy.midPromoteFreshnessMin
  ) {
    return true;
  }

  return false;
}

function promotionReason(record: MemoryRecord): string {
  if (record.tier === "short") {
    return "high-signal-short-term";
  }

  return "durable-mid-term";
}

function shouldArchive(record: MemoryRecord, policy: CompactionPolicy): boolean {
  return (
    record.tier !== "long" &&
    record.importance < policy.archiveImportanceMax &&
    record.confidence < policy.archiveConfidenceMax &&
    record.freshness < policy.archiveFreshnessMax
  );
}

function isDurableKind(kind: MemoryRecord["kind"]): boolean {
  return kind === "decision" || kind === "preference" || kind === "fact" || kind === "summary";
}

export function applyCompactionPlan(plan: CompactionPlan): MemoryRecord[] {
  return [
    ...plan.promoted.map((action) => action.after),
    ...plan.archived.map((action) => action.after),
    ...plan.refreshed.map((action) => action.after),
  ];
}

export function createCompactionEvents(plan: CompactionPlan): MemoryEvent[] {
  const actions = [...plan.promoted, ...plan.archived, ...plan.refreshed];

  return actions.map((action) => ({
    id: createId("evt"),
    spaceId: action.after.spaceId,
    scope: action.after.scope,
    actorType: "system",
    actorId: "glialnode-compact",
    type:
      action.type === "promote"
        ? "memory_promoted"
        : action.type === "archive"
          ? "memory_archived"
          : "memory_written",
    summary:
      action.type === "promote"
        ? `Compaction promoted ${action.before.id} from ${action.before.tier} to ${action.after.tier}.`
        : action.type === "archive"
          ? `Compaction archived ${action.before.id}.`
          : `Compaction refreshed compact memory for ${action.before.id}.`,
    payload: {
      reason: action.reason,
      recordId: action.before.id,
      previousTier: action.before.tier,
      nextTier: action.after.tier,
      previousStatus: action.before.status,
      nextStatus: action.after.status,
    },
    createdAt: action.after.updatedAt,
  }));
}

export function createCompactionSummaryRecord(plan: CompactionPlan): MemoryRecord | null {
  const actions = [...plan.promoted, ...plan.archived, ...plan.refreshed];

  if (actions.length === 0) {
    return null;
  }

  const anchor = actions[0].after;
  const promotedIds = plan.promoted.map((action) => action.before.id);
  const archivedIds = plan.archived.map((action) => action.before.id);
  const refreshedIds = plan.refreshed.map((action) => action.before.id);
  const summaryParts = [
    `promoted ${promotedIds.length} record(s)`,
    `archived ${archivedIds.length} record(s)`,
    `refreshed ${refreshedIds.length} compact encoding(s)`,
  ];

  return createMemoryRecord({
    spaceId: anchor.spaceId,
    tier: "mid",
    kind: "summary",
    content: `Compaction run: ${summaryParts.join(", ")}.`,
    summary: "Compaction summary",
    scope: anchor.scope,
    visibility: "space",
    tags: ["compaction", "system"],
    importance: 0.65,
    confidence: 1,
    freshness: 0.7,
  });
}

export function createCompactionSummaryLinks(summaryRecord: MemoryRecord, plan: CompactionPlan): MemoryRecordLink[] {
  const actions = [...plan.promoted, ...plan.archived, ...plan.refreshed];

  return actions.map((action) => ({
    id: createId("link"),
    spaceId: summaryRecord.spaceId,
    fromRecordId: summaryRecord.id,
    toRecordId: action.after.id,
    type: "references",
    createdAt: summaryRecord.createdAt,
  }));
}
