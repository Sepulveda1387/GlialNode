import type {
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySearchQuery,
  MemorySpace,
  ScopeRecord,
} from "../core/types.js";
import type { MemoryRepository, SpaceReport } from "./repository.js";

export class SerializedLocalRepository implements MemoryRepository {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly inner: MemoryRepository) {}

  createSpace(space: MemorySpace): Promise<void> {
    return this.enqueueWrite(() => this.inner.createSpace(space));
  }

  listSpaces(): Promise<MemorySpace[]> {
    return this.inner.listSpaces();
  }

  getSpace(spaceId: string): Promise<MemorySpace | null> {
    return this.inner.getSpace(spaceId);
  }

  upsertScope(scope: ScopeRecord): Promise<void> {
    return this.enqueueWrite(() => this.inner.upsertScope(scope));
  }

  listScopes(spaceId: string): Promise<ScopeRecord[]> {
    return this.inner.listScopes(spaceId);
  }

  appendEvent(event: MemoryEvent): Promise<void> {
    return this.enqueueWrite(() => this.inner.appendEvent(event));
  }

  listEvents(spaceId: string, limit?: number): Promise<MemoryEvent[]> {
    return this.inner.listEvents(spaceId, limit);
  }

  writeRecord(record: MemoryRecord): Promise<void> {
    return this.enqueueWrite(() => this.inner.writeRecord(record));
  }

  getRecord(recordId: string): Promise<MemoryRecord | null> {
    return this.inner.getRecord(recordId);
  }

  listRecords(spaceId: string, limit?: number): Promise<MemoryRecord[]> {
    return this.inner.listRecords(spaceId, limit);
  }

  linkRecords(link: MemoryRecordLink): Promise<void> {
    return this.enqueueWrite(() => this.inner.linkRecords(link));
  }

  listLinks(spaceId: string, limit?: number): Promise<MemoryRecordLink[]> {
    return this.inner.listLinks(spaceId, limit);
  }

  listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]> {
    return this.inner.listLinksForRecord(recordId);
  }

  searchRecords(query: MemorySearchQuery): Promise<MemoryRecord[]> {
    return this.inner.searchRecords(query);
  }

  getSpaceReport(spaceId: string, recentEventLimit?: number): Promise<SpaceReport> {
    return this.inner.getSpaceReport(spaceId, recentEventLimit);
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeTail.then(operation, operation);
    this.writeTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export function createSerializedLocalRepository(repository: MemoryRepository): MemoryRepository {
  if (repository instanceof SerializedLocalRepository) {
    return repository;
  }

  return new SerializedLocalRepository(repository);
}
