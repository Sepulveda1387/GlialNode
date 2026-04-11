import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { CompactionPolicy, RetentionPolicy } from "../core/config.js";
import { createId } from "../core/ids.js";
import type {
  ActorType,
  CreateMemoryRecordInput,
  EventType,
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySpace,
  MemorySpaceSettings,
  RecordStatus,
  ScopeRecord,
} from "../core/types.js";
import {
  applyCompactionPlan,
  createCompactionDistillationLinks,
  createCompactionDistilledRecords,
  createCompactionEvents,
  createCompactionSummaryLinks,
  createCompactionSummaryRecord,
  planCompaction,
} from "../memory/compaction.js";
import { promoteRecord } from "../memory/promotion.js";
import {
  applyRetentionPlan,
  createRetentionEvents,
  createRetentionSummaryLinks,
  createRetentionSummaryRecord,
  planRetention,
} from "../memory/retention.js";
import { createMemoryRecord, updateRecordStatus } from "../memory/service.js";
import type { MemoryRepository, SpaceReport } from "../storage/repository.js";
import type { SqliteConnectionPolicy } from "../storage/sqlite/connection.js";
import { SqliteMemoryRepository } from "../storage/sqlite/sqlite-repository.js";

export interface GlialNodeClientOptions {
  filename?: string;
  repository?: MemoryRepository;
  sqlite?: Partial<SqliteConnectionPolicy>;
}

export interface CreateSpaceInput {
  name: string;
  description?: string;
  settings?: MemorySpaceSettings;
}

export interface ConfigureSpaceInput {
  spaceId: string;
  settings?: MemorySpaceSettings;
  compaction?: Partial<CompactionPolicy>;
  retentionDays?: Partial<RetentionPolicy>;
}

export interface AddScopeInput {
  spaceId: string;
  type: ScopeRecord["type"];
  externalId?: string;
  label?: string;
  parentScopeId?: string;
}

export interface AddEventInput {
  spaceId: string;
  scope: MemoryEvent["scope"];
  actorType: ActorType;
  actorId: string;
  type: EventType;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface AddLinkInput {
  spaceId: string;
  fromRecordId: string;
  toRecordId: string;
  type: MemoryRecordLink["type"];
}

export interface SpaceSnapshot {
  exportedAt: string;
  space: MemorySpace;
  scopes: ScopeRecord[];
  events: MemoryEvent[];
  records: MemoryRecord[];
  links: MemoryRecordLink[];
}

export interface MaintenanceResult {
  compactionPlan: ReturnType<typeof planCompaction>;
  retentionPlan: ReturnType<typeof planRetention>;
  applied: boolean;
}

export class GlialNodeClient {
  private readonly repository: MemoryRepository;
  private readonly closeRepository: (() => void) | null;

  constructor(options: GlialNodeClientOptions = {}) {
    if (options.repository) {
      this.repository = options.repository;
      this.closeRepository = null;
      return;
    }

    const filename = resolve(options.filename ?? ".glialnode/glialnode.sqlite");
    mkdirSync(dirname(filename), { recursive: true });
    const repository = new SqliteMemoryRepository({
      filename,
      connection: options.sqlite,
    });
    this.repository = repository;
    this.closeRepository = () => repository.close();
  }

  async createSpace(input: CreateSpaceInput): Promise<MemorySpace> {
    const timestamp = new Date().toISOString();
    const space: MemorySpace = {
      id: createId("space"),
      name: input.name,
      description: input.description,
      settings: input.settings,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.createSpace(space);
    return space;
  }

  async listSpaces(): Promise<MemorySpace[]> {
    return this.repository.listSpaces();
  }

  async getSpace(spaceId: string): Promise<MemorySpace> {
    return requireSpace(this.repository, spaceId);
  }

  async configureSpace(input: ConfigureSpaceInput): Promise<MemorySpace> {
    const space = await requireSpace(this.repository, input.spaceId);
    const settings = mergeSpaceSettings(
      space.settings,
      input.settings,
      mergeSpaceSettings(undefined, input.compaction ? { compaction: input.compaction } : undefined, input.retentionDays ? { retentionDays: input.retentionDays } : undefined),
    );

    const updatedSpace: MemorySpace = {
      ...space,
      settings,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.createSpace(updatedSpace);
    return updatedSpace;
  }

  async addScope(input: AddScopeInput): Promise<ScopeRecord> {
    await requireSpace(this.repository, input.spaceId);
    const timestamp = new Date().toISOString();
    const scope: ScopeRecord = {
      id: createId("scope"),
      spaceId: input.spaceId,
      type: input.type,
      externalId: input.externalId,
      label: input.label,
      parentScopeId: input.parentScopeId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.upsertScope(scope);
    return scope;
  }

  async listScopes(spaceId: string): Promise<ScopeRecord[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listScopes(spaceId);
  }

  async addRecord(input: CreateMemoryRecordInput): Promise<MemoryRecord> {
    await requireSpace(this.repository, input.spaceId);
    const record = createMemoryRecord(input);
    await this.repository.writeRecord(record);
    return record;
  }

  async getRecord(recordId: string): Promise<MemoryRecord> {
    return requireRecord(this.repository, recordId);
  }

  async listRecords(spaceId: string, limit = 50): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listRecords(spaceId, limit);
  }

  async searchRecords(query: Parameters<MemoryRepository["searchRecords"]>[0]): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, query.spaceId);
    return this.repository.searchRecords(query);
  }

  async promoteRecord(recordId: string): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const promoted = promoteRecord(record);
    await this.repository.writeRecord(promoted);
    return promoted;
  }

  async archiveRecord(recordId: string): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const archived = updateRecordStatus(record, "archived");
    await this.repository.writeRecord(archived);
    return archived;
  }

  async updateRecordStatus(recordId: string, status: RecordStatus): Promise<MemoryRecord> {
    const record = await requireRecord(this.repository, recordId);
    const updated = updateRecordStatus(record, status);
    await this.repository.writeRecord(updated);
    return updated;
  }

  async addEvent(input: AddEventInput): Promise<MemoryEvent> {
    await requireSpace(this.repository, input.spaceId);
    const event: MemoryEvent = {
      id: createId("evt"),
      spaceId: input.spaceId,
      scope: input.scope,
      actorType: input.actorType,
      actorId: input.actorId,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };

    await this.repository.appendEvent(event);
    return event;
  }

  async listEvents(spaceId: string, limit = 50): Promise<MemoryEvent[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listEvents(spaceId, limit);
  }

  async addLink(input: AddLinkInput): Promise<MemoryRecordLink> {
    await requireSpace(this.repository, input.spaceId);
    const link: MemoryRecordLink = {
      id: createId("link"),
      spaceId: input.spaceId,
      fromRecordId: input.fromRecordId,
      toRecordId: input.toRecordId,
      type: input.type,
      createdAt: new Date().toISOString(),
    };

    await this.repository.linkRecords(link);
    return link;
  }

  async listLinks(spaceId: string, limit = 50): Promise<MemoryRecordLink[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listLinks(spaceId, limit);
  }

  async listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]> {
    await requireRecord(this.repository, recordId);
    return this.repository.listLinksForRecord(recordId);
  }

  async compactSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<ReturnType<typeof planCompaction>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planCompaction(records, space.settings?.compaction);

    if (options.apply) {
      for (const record of applyCompactionPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const record of createCompactionDistilledRecords(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createCompactionEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      for (const link of createCompactionDistillationLinks(plan)) {
        await this.repository.linkRecords(link);
      }

      const summaryRecord = createCompactionSummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createCompactionSummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async retainSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<ReturnType<typeof planRetention>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planRetention(records, space.settings?.retentionDays);

    if (options.apply) {
      for (const record of applyRetentionPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      const summaryRecord = createRetentionSummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async maintainSpace(spaceId: string, options: { apply?: boolean } = {}): Promise<MaintenanceResult> {
    const space = await requireSpace(this.repository, spaceId);
    const initialRecords = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const compactionPlan = planCompaction(initialRecords, space.settings?.compaction);
    const compactionUpdates = applyCompactionPlan(compactionPlan);
    const postCompactionRecords = mergeUpdatedRecords(initialRecords, compactionUpdates);

    if (options.apply) {
      for (const record of compactionUpdates) {
        await this.repository.writeRecord(record);
      }

      for (const record of createCompactionDistilledRecords(compactionPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createCompactionEvents(compactionPlan)) {
        await this.repository.appendEvent(event);
      }

      for (const link of createCompactionDistillationLinks(compactionPlan)) {
        await this.repository.linkRecords(link);
      }

      const compactionSummary = createCompactionSummaryRecord(compactionPlan);
      if (compactionSummary) {
        await this.repository.writeRecord(compactionSummary);
        for (const link of createCompactionSummaryLinks(compactionSummary, compactionPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    const retentionPlan = planRetention(
      options.apply
        ? await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
        : postCompactionRecords,
      space.settings?.retentionDays,
    );

    if (options.apply) {
      for (const record of applyRetentionPlan(retentionPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(retentionPlan)) {
        await this.repository.appendEvent(event);
      }

      const retentionSummary = createRetentionSummaryRecord(retentionPlan);
      if (retentionSummary) {
        await this.repository.writeRecord(retentionSummary);
        for (const link of createRetentionSummaryLinks(retentionSummary, retentionPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return {
      compactionPlan,
      retentionPlan,
      applied: options.apply === true,
    };
  }

  async getSpaceReport(spaceId: string, recentEventLimit = 10): Promise<SpaceReport> {
    await requireSpace(this.repository, spaceId);
    return this.repository.getSpaceReport(spaceId, recentEventLimit);
  }

  async exportSpace(spaceId: string): Promise<SpaceSnapshot> {
    const space = await requireSpace(this.repository, spaceId);
    const [scopes, events, records, links] = await Promise.all([
      this.repository.listScopes(spaceId),
      this.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER),
      this.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      space,
      scopes,
      events,
      records,
      links,
    };
  }

  async exportSpaceToFile(spaceId: string, outputPath: string): Promise<string> {
    const snapshot = await this.exportSpace(spaceId);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(snapshot, null, 2), "utf8");
    return resolvedOutputPath;
  }

  async importSnapshot(snapshot: SpaceSnapshot): Promise<SpaceSnapshot> {
    await this.repository.createSpace(snapshot.space);

    for (const scope of snapshot.scopes) {
      await this.repository.upsertScope(scope);
    }

    for (const event of snapshot.events) {
      await this.repository.appendEvent(event);
    }

    for (const record of snapshot.records) {
      await this.repository.writeRecord(record);
    }

    for (const link of snapshot.links) {
      await this.repository.linkRecords(link);
    }

    return snapshot;
  }

  async importSnapshotFromFile(inputPath: string): Promise<SpaceSnapshot> {
    const snapshot = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as SpaceSnapshot;
    return this.importSnapshot(snapshot);
  }

  close(): void {
    this.closeRepository?.();
  }
}

function mergeSpaceSettings(
  existing?: MemorySpaceSettings,
  first?: MemorySpaceSettings,
  second?: MemorySpaceSettings,
): MemorySpaceSettings {
  return {
    ...(existing ?? {}),
    ...(first ?? {}),
    ...(second ?? {}),
    retentionDays: {
      ...(existing?.retentionDays ?? {}),
      ...(first?.retentionDays ?? {}),
      ...(second?.retentionDays ?? {}),
    },
    compaction: {
      ...(existing?.compaction ?? {}),
      ...(first?.compaction ?? {}),
      ...(second?.compaction ?? {}),
    },
  };
}

async function requireSpace(repository: MemoryRepository, spaceId: string): Promise<MemorySpace> {
  const space = await repository.getSpace(spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  return space;
}

async function requireRecord(repository: MemoryRepository, recordId: string): Promise<MemoryRecord> {
  const record = await repository.getRecord(recordId);

  if (!record) {
    throw new Error(`Unknown record: ${recordId}`);
  }

  return record;
}

function mergeUpdatedRecords(existing: MemoryRecord[], updates: MemoryRecord[]): MemoryRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));

  for (const update of updates) {
    byId.set(update.id, update);
  }

  return [...byId.values()];
}
