import type { MemoryRecord } from "../core/types.js";

function recencyWeight(timestamp: string, now: Date): number {
  const updatedTime = new Date(timestamp).getTime();
  const nowTime = now.getTime();
  const deltaHours = Math.max((nowTime - updatedTime) / (1000 * 60 * 60), 0);

  return 1 / (1 + deltaHours / 24);
}

export function scoreRecordForRetrieval(record: MemoryRecord, now: Date = new Date()): number {
  return (
    record.importance * 0.35 +
    record.confidence * 0.25 +
    record.freshness * 0.2 +
    recencyWeight(record.updatedAt, now) * 0.2
  );
}

export function rankRecordsForRetrieval(
  records: MemoryRecord[],
  now: Date = new Date(),
): MemoryRecord[] {
  return [...records].sort(
    (left, right) => scoreRecordForRetrieval(right, now) - scoreRecordForRetrieval(left, now),
  );
}
