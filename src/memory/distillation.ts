import type { CompactionPolicy } from "../core/config.js";
import type { MemoryRecord, MemoryVisibility } from "../core/types.js";
import { createMemoryRecord } from "./service.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
]);

export interface DistillationAction {
  reason: string;
  sourceRecords: MemoryRecord[];
  distilledRecord: MemoryRecord;
}

export function planDistillation(
  records: MemoryRecord[],
  policy: CompactionPolicy,
): DistillationAction[] {
  const activeRecords = records.filter(
    (record) => record.status === "active" && isDistillableRecord(record),
  );
  const groups = new Map<string, MemoryRecord[]>();

  for (const record of activeRecords) {
    const key = `${record.spaceId}:${record.scope.type}:${record.scope.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const actions: DistillationAction[] = [];

  for (const scopedRecords of groups.values()) {
    const components = findRelatedComponents(scopedRecords, policy.distillMinTokenOverlap);

    for (const component of components) {
      if (component.length < policy.distillMinClusterSize) {
        continue;
      }

      const candidate = createDistilledRecord(component);
      if (!candidate) {
        continue;
      }

      actions.push({
        reason: "related-memory-cluster",
        sourceRecords: component,
        distilledRecord: candidate,
      });
    }
  }

  return actions;
}

function isDistillableRecord(record: MemoryRecord): boolean {
  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return !lowerTags.has("distilled") && !lowerTags.has("compaction") && !lowerTags.has("retention");
}

function findRelatedComponents(records: MemoryRecord[], minTokenOverlap: number): MemoryRecord[][] {
  const sorted = [...records].sort((left, right) => left.id.localeCompare(right.id));
  const tokenMap = new Map(sorted.map((record) => [record.id, extractSignalTokens(record)]));
  const visited = new Set<string>();
  const components: MemoryRecord[][] = [];

  for (const record of sorted) {
    if (visited.has(record.id)) {
      continue;
    }

    const component: MemoryRecord[] = [];
    const queue = [record];
    visited.add(record.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const other of sorted) {
        if (visited.has(other.id) || other.id === current.id) {
          continue;
        }

        if (areRelated(current, other, tokenMap, minTokenOverlap)) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }

    components.push(component.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)));
  }

  return components;
}

function areRelated(
  left: MemoryRecord,
  right: MemoryRecord,
  tokenMap: Map<string, Set<string>>,
  minTokenOverlap: number,
): boolean {
  const leftTags = new Set(left.tags.map((tag) => tag.toLowerCase()));
  const rightTags = new Set(right.tags.map((tag) => tag.toLowerCase()));

  for (const tag of leftTags) {
    if (rightTags.has(tag)) {
      return true;
    }
  }

  const leftTokens = tokenMap.get(left.id) ?? new Set<string>();
  const rightTokens = tokenMap.get(right.id) ?? new Set<string>();
  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
      if (overlap >= minTokenOverlap) {
        return true;
      }
    }
  }

  return false;
}

function extractSignalTokens(record: MemoryRecord): Set<string> {
  return new Set(
    `${record.summary ?? ""} ${record.content}`
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

function createDistilledRecord(sourceRecords: MemoryRecord[]): MemoryRecord | null {
  if (sourceRecords.length === 0) {
    return null;
  }

  const anchor = sourceRecords[0]!;
  const labels = sourceRecords
    .map((record) => record.summary?.trim() || compactInline(record.content))
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
    .slice(0, 4);

  if (labels.length === 0) {
    return null;
  }

  const keyword = chooseClusterLabel(sourceRecords);
  const tier = chooseDistilledTier(sourceRecords);
  const visibility = chooseVisibility(sourceRecords);
  const tags = [...new Set([...sourceRecords.flatMap((record) => record.tags), "distilled", "compaction"])]
    .slice(0, 8);
  const importance = average(sourceRecords.map((record) => record.importance));
  const confidence = Math.min(1, average(sourceRecords.map((record) => record.confidence)) + 0.1);
  const freshness = average(sourceRecords.map((record) => record.freshness));

  return createMemoryRecord({
    spaceId: anchor.spaceId,
    tier,
    kind: "summary",
    summary: keyword ? `Distilled ${keyword} memory` : "Distilled memory",
    content: `Distilled memory from ${sourceRecords.length} related record(s): ${labels.join("; ")}.`,
    scope: anchor.scope,
    visibility,
    tags,
    importance,
    confidence,
    freshness,
  });
}

function compactInline(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}

function chooseClusterLabel(records: MemoryRecord[]): string | null {
  const tagCounts = new Map<string, number>();
  const tokenCounts = new Map<string, number>();

  for (const record of records) {
    for (const tag of record.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    for (const token of extractSignalTokens(record)) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  const bestTag = [...tagCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];

  if (bestTag) {
    return bestTag;
  }

  return [...tokenCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function chooseDistilledTier(records: MemoryRecord[]): MemoryRecord["tier"] {
  const averageImportance = average(records.map((record) => record.importance));
  const averageConfidence = average(records.map((record) => record.confidence));
  const durable = records.every((record) =>
    record.kind === "decision" ||
    record.kind === "preference" ||
    record.kind === "fact" ||
    record.kind === "summary",
  );

  if (durable && averageImportance >= 0.7 && averageConfidence >= 0.7) {
    return "long";
  }

  return "mid";
}

function chooseVisibility(records: MemoryRecord[]): MemoryVisibility {
  if (records.some((record) => record.visibility === "private")) {
    return "private";
  }

  if (records.some((record) => record.visibility === "shared")) {
    return "shared";
  }

  return "space";
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
