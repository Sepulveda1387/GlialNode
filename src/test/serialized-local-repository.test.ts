import test from "node:test";
import assert from "node:assert/strict";

import type {
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySearchQuery,
  MemorySpace,
  ScopeRecord,
} from "../core/types.js";
import type { MemoryRepository, SpaceReport } from "../storage/repository.js";
import { SerializedLocalRepository } from "../storage/serialized-local-repository.js";

test("SerializedLocalRepository serializes concurrent write operations through one local queue", async () => {
  const base = createInstrumentedRepository();
  const repository = new SerializedLocalRepository(base);

  const now = new Date().toISOString();
  const space: MemorySpace = {
    id: "space_1",
    name: "Queue Space",
    createdAt: now,
    updatedAt: now,
  };
  const scope: ScopeRecord = {
    id: "scope_1",
    spaceId: "space_1",
    type: "agent",
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    repository.createSpace(space),
    repository.upsertScope(scope),
    repository.appendEvent({
      id: "evt_1",
      spaceId: "space_1",
      scope: { id: scope.id, type: scope.type },
      actorType: "agent",
      actorId: "tester",
      type: "memory_written",
      summary: "write 1",
      createdAt: now,
    }),
    repository.writeRecord({
      id: "record_1",
      spaceId: "space_1",
      tier: "mid",
      kind: "fact",
      content: "Serialized write one",
      scope: { id: scope.id, type: scope.type },
      visibility: "space",
      status: "active",
      tags: [],
      importance: 0.7,
      confidence: 0.8,
      freshness: 0.9,
      createdAt: now,
      updatedAt: now,
    }),
    repository.linkRecords({
      id: "link_1",
      spaceId: "space_1",
      fromRecordId: "record_1",
      toRecordId: "record_1",
      type: "references",
      createdAt: now,
    }),
  ]);

  assert.equal(base.maxActiveWrites, 1);
  assert.equal(base.writeCallCount, 5);
});

function createInstrumentedRepository(): MemoryRepository & {
  maxActiveWrites: number;
  writeCallCount: number;
} {
  const spaces = new Map<string, MemorySpace>();
  const scopes = new Map<string, ScopeRecord>();
  const records = new Map<string, MemoryRecord>();
  const events: MemoryEvent[] = [];
  const links: MemoryRecordLink[] = [];

  let activeWrites = 0;
  let maxActiveWrites = 0;
  let writeCallCount = 0;

  const withWriteDelay = async (fn: () => void): Promise<void> => {
    writeCallCount += 1;
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);

    await sleep(15);
    fn();
    activeWrites -= 1;
  };

  return {
    get maxActiveWrites() {
      return maxActiveWrites;
    },
    get writeCallCount() {
      return writeCallCount;
    },
    async createSpace(space: MemorySpace): Promise<void> {
      await withWriteDelay(() => {
        spaces.set(space.id, space);
      });
    },
    async listSpaces(): Promise<MemorySpace[]> {
      return [...spaces.values()];
    },
    async getSpace(spaceId: string): Promise<MemorySpace | null> {
      return spaces.get(spaceId) ?? null;
    },
    async upsertScope(scope: ScopeRecord): Promise<void> {
      await withWriteDelay(() => {
        scopes.set(scope.id, scope);
      });
    },
    async listScopes(spaceId: string): Promise<ScopeRecord[]> {
      return [...scopes.values()].filter((scope) => scope.spaceId === spaceId);
    },
    async appendEvent(event: MemoryEvent): Promise<void> {
      await withWriteDelay(() => {
        events.push(event);
      });
    },
    async listEvents(spaceId: string, limit = 50): Promise<MemoryEvent[]> {
      return events.filter((event) => event.spaceId === spaceId).slice(0, limit);
    },
    async writeRecord(record: MemoryRecord): Promise<void> {
      await withWriteDelay(() => {
        records.set(record.id, record);
      });
    },
    async getRecord(recordId: string): Promise<MemoryRecord | null> {
      return records.get(recordId) ?? null;
    },
    async listRecords(spaceId: string, limit = 50): Promise<MemoryRecord[]> {
      return [...records.values()].filter((record) => record.spaceId === spaceId).slice(0, limit);
    },
    async linkRecords(link: MemoryRecordLink): Promise<void> {
      await withWriteDelay(() => {
        links.push(link);
      });
    },
    async listLinks(spaceId: string, limit = 50): Promise<MemoryRecordLink[]> {
      return links.filter((link) => link.spaceId === spaceId).slice(0, limit);
    },
    async listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]> {
      return links.filter((link) => link.fromRecordId === recordId || link.toRecordId === recordId);
    },
    async searchRecords(query: MemorySearchQuery): Promise<MemoryRecord[]> {
      return [...records.values()].filter((record) => record.spaceId === query.spaceId).slice(0, query.limit ?? 50);
    },
    async getSpaceReport(spaceId: string): Promise<SpaceReport> {
      return {
        spaceId,
        recordCount: [...records.values()].filter((record) => record.spaceId === spaceId).length,
        eventCount: events.filter((event) => event.spaceId === spaceId).length,
        linkCount: links.filter((link) => link.spaceId === spaceId).length,
        recordsByTier: {},
        recordsByStatus: {},
        recordsByKind: {},
        eventCountsByType: {},
        provenanceSummaryCount: 0,
        maintenance: {},
        recentLifecycleEvents: [],
        recentProvenanceEvents: [],
      };
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
