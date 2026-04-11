import type { MemoryRecord, MemoryTier } from "../core/types.js";

export function groupByTier(records: MemoryRecord[]): Record<MemoryTier, MemoryRecord[]> {
  return {
    short: records.filter((record) => record.tier === "short"),
    mid: records.filter((record) => record.tier === "mid"),
    long: records.filter((record) => record.tier === "long"),
  };
}

export * from "./compact.js";
export * from "./compaction.js";
export * from "./promotion.js";
export * from "./retention.js";
export * from "./retrieval.js";
export * from "./service.js";
