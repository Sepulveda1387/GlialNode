import type { MemoryRecord, MemoryTier } from "../core/types.js";
import { ValidationError } from "../core/errors.js";

const tierOrder: MemoryTier[] = ["short", "mid", "long"];

export function promoteTier(currentTier: MemoryTier): MemoryTier {
  const index = tierOrder.indexOf(currentTier);

  if (index === -1 || index === tierOrder.length - 1) {
    return currentTier;
  }

  return tierOrder[index + 1];
}

export function moveRecordToTier(record: MemoryRecord, targetTier: MemoryTier): MemoryRecord {
  const currentIndex = tierOrder.indexOf(record.tier);
  const targetIndex = tierOrder.indexOf(targetTier);

  if (targetIndex < currentIndex) {
    throw new ValidationError("Records cannot be demoted with moveRecordToTier.");
  }

  return {
    ...record,
    tier: targetTier,
    updatedAt: new Date().toISOString(),
  };
}

export function promoteRecord(record: MemoryRecord): MemoryRecord {
  return moveRecordToTier(record, promoteTier(record.tier));
}
