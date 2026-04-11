import type {
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySearchQuery,
  MemorySpace,
  ScopeRecord,
} from "../core/types.js";

export interface SpaceReport {
  spaceId: string;
  recordCount: number;
  eventCount: number;
  linkCount: number;
  recordsByTier: Record<string, number>;
  recordsByStatus: Record<string, number>;
  recordsByKind: Record<string, number>;
  recentLifecycleEvents: MemoryEvent[];
}

export interface MemoryRepository {
  createSpace(space: MemorySpace): Promise<void>;
  listSpaces(): Promise<MemorySpace[]>;
  upsertScope(scope: ScopeRecord): Promise<void>;
  listScopes(spaceId: string): Promise<ScopeRecord[]>;
  appendEvent(event: MemoryEvent): Promise<void>;
  listEvents(spaceId: string, limit?: number): Promise<MemoryEvent[]>;
  writeRecord(record: MemoryRecord): Promise<void>;
  getRecord(recordId: string): Promise<MemoryRecord | null>;
  listRecords(spaceId: string, limit?: number): Promise<MemoryRecord[]>;
  linkRecords(link: MemoryRecordLink): Promise<void>;
  listLinks(spaceId: string, limit?: number): Promise<MemoryRecordLink[]>;
  listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]>;
  searchRecords(query: MemorySearchQuery): Promise<MemoryRecord[]>;
  getSpaceReport(spaceId: string, recentEventLimit?: number): Promise<SpaceReport>;
}
