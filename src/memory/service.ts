import { createId } from "../core/ids.js";
import type { CreateMemoryRecordInput, MemoryRecord, RecordStatus } from "../core/types.js";
import { ValidationError } from "../core/errors.js";

export function createMemoryRecord(input: CreateMemoryRecordInput): MemoryRecord {
  const timestamp = new Date().toISOString();

  if (!input.content.trim()) {
    throw new ValidationError("Memory content cannot be empty.");
  }

  return {
    id: createId("mem"),
    spaceId: input.spaceId,
    tier: input.tier,
    kind: input.kind,
    content: input.content,
    summary: input.summary,
    scope: input.scope,
    visibility: input.visibility ?? "space",
    status: input.status ?? "active",
    tags: input.tags ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.5,
    freshness: input.freshness ?? 0.5,
    sourceEventId: input.sourceEventId,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt,
  };
}

export function updateRecordStatus(record: MemoryRecord, status: RecordStatus): MemoryRecord {
  return {
    ...record,
    status,
    updatedAt: new Date().toISOString(),
  };
}
