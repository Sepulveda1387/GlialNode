import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type {
  CompactionPolicy,
  ConflictPolicy,
  DecayPolicy,
  RoutingPolicy,
  ReinforcementPolicy,
  RetentionPolicy,
} from "../core/config.js";
import { createId } from "../core/ids.js";
import {
  diffSpacePresetDefinitions,
  getSpacePreset,
  getSpacePresetDefinition,
  listSpacePresetDefinitions,
  parseSpacePresetDefinition,
  stringifySpacePresetDefinition,
  type SpacePresetDiff,
  type SpacePresetDefinition,
  type SpacePresetName,
} from "../core/presets.js";
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
import { createConflictEvents, createConflictLinks, detectConflicts } from "../memory/conflicts.js";
import {
  applyDecayPlan,
  createDecayEvents,
  createDecaySummaryLinks,
  createDecaySummaryRecord,
  planDecay,
} from "../memory/decay.js";
import { promoteRecord } from "../memory/promotion.js";
import {
  applyReinforcementPlan,
  createReinforcementEvents,
  createReinforcementSummaryLinks,
  createReinforcementSummaryRecord,
  planReinforcement,
} from "../memory/reinforcement.js";
import {
  buildMemoryBundle,
  buildRecallPack,
  buildRecallTrace,
  type MemoryBundle,
  type MemoryBundleConsumer,
  type MemoryBundleProfile,
  type RecallPack,
  type RecallTrace,
} from "../memory/retrieval.js";
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
  presetDirectory?: string;
  sqlite?: Partial<SqliteConnectionPolicy>;
}

export interface CreateSpaceInput {
  name: string;
  description?: string;
  preset?: SpacePresetName;
  presetLocalName?: string;
  presetChannel?: string;
  presetDirectory?: string;
  presetDefinition?: SpacePresetDefinition;
  settings?: MemorySpaceSettings;
}

export interface ConfigureSpaceInput {
  spaceId: string;
  preset?: SpacePresetName;
  presetLocalName?: string;
  presetChannel?: string;
  presetDirectory?: string;
  presetDefinition?: SpacePresetDefinition;
  settings?: MemorySpaceSettings;
  compaction?: Partial<CompactionPolicy>;
  conflict?: Partial<ConflictPolicy>;
  decay?: Partial<DecayPolicy>;
  routing?: Partial<RoutingPolicy>;
  reinforcement?: Partial<ReinforcementPolicy>;
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
  decayPlan: ReturnType<typeof planDecay>;
  retentionPlan: ReturnType<typeof planRetention>;
  applied: boolean;
}

export interface ReinforceRecordOptions {
  reason?: string;
  strength?: number;
  now?: Date;
}

export interface SearchReinforcementOptions extends ReinforceRecordOptions {
  enabled?: boolean;
  limit?: number;
}

export interface RecallOptions {
  reinforce?: SearchReinforcementOptions;
  primaryLimit?: number;
  supportLimit?: number;
  includeSameScopeDistilled?: boolean;
  bundleProfile?: MemoryBundleProfile;
  bundleConsumer?: MemoryBundleConsumer;
  bundleMaxSupporting?: number;
  bundleMaxContentChars?: number;
  bundlePreferCompact?: boolean;
}

export interface PresetChannelState {
  name: string;
  channels: Record<string, string>;
}

export class GlialNodeClient {
  private readonly repository: MemoryRepository;
  private readonly closeRepository: (() => void) | null;
  private readonly presetDirectory: string;

  constructor(options: GlialNodeClientOptions = {}) {
    if (options.repository) {
      this.repository = options.repository;
      this.closeRepository = null;
      this.presetDirectory = resolve(options.presetDirectory ?? ".glialnode/presets");
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
    this.presetDirectory = resolve(options.presetDirectory ?? join(dirname(filename), "presets"));
  }

  async createSpace(input: CreateSpaceInput): Promise<MemorySpace> {
    const timestamp = new Date().toISOString();
    const channelPreset =
      input.presetLocalName && input.presetChannel
        ? this.resolvePresetChannel(input.presetLocalName, {
            channel: input.presetChannel,
            directory: input.presetDirectory,
          })
        : undefined;
    const settings = mergeSpaceSettings(
      input.preset ? getSpacePreset(input.preset) : undefined,
      channelPreset?.settings,
      input.presetDefinition?.settings,
      input.settings,
    );
    const space: MemorySpace = {
      id: createId("space"),
      name: input.name,
      description: input.description,
      settings,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.createSpace(space);
    return space;
  }

  async listSpaces(): Promise<MemorySpace[]> {
    return this.repository.listSpaces();
  }

  listPresets(): SpacePresetDefinition[] {
    return listSpacePresetDefinitions();
  }

  getPreset(name: SpacePresetName): SpacePresetDefinition {
    return getSpacePresetDefinition(name);
  }

  diffPresets(left: SpacePresetDefinition, right: SpacePresetDefinition): SpacePresetDiff {
    return diffSpacePresetDefinitions(left, right);
  }

  exportPreset(name: SpacePresetName, outputPath: string): SpacePresetDefinition {
    const preset = {
      ...getSpacePresetDefinition(name),
      updatedAt: new Date().toISOString(),
    };
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, stringifySpacePresetDefinition(preset), "utf8");
    return preset;
  }

  loadPreset(inputPath: string): SpacePresetDefinition {
    return parseSpacePresetDefinition(readFileSync(resolve(inputPath), "utf8"));
  }

  registerPreset(
    inputPath: string,
    options: { name?: string; directory?: string; author?: string; version?: string } = {},
  ): SpacePresetDefinition {
    const preset = this.loadPreset(inputPath);
    const now = new Date().toISOString();
    const registered: SpacePresetDefinition = {
      ...preset,
      name: options.name ?? preset.name,
      version: options.version ?? preset.version ?? "1.0.0",
      author: options.author ?? preset.author,
      source: inputPath,
      createdAt: preset.createdAt ?? now,
      updatedAt: now,
    };
    const directory = resolve(options.directory ?? this.presetDirectory);
    mkdirSync(directory, { recursive: true });
    writePresetFiles(directory, registered);
    return registered;
  }

  listRegisteredPresets(directory?: string): SpacePresetDefinition[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    if (!existsSync(resolvedDirectory)) {
      return [];
    }

    return readdirSync(resolvedDirectory)
      .filter((entry) => entry.toLowerCase().endsWith(".json"))
      .map((entry) => this.loadPreset(join(resolvedDirectory, entry)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getRegisteredPreset(name: string, directory?: string): SpacePresetDefinition {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const candidatePath = join(resolvedDirectory, `${toPresetFileName(name)}.json`);
    if (existsSync(candidatePath)) {
      return this.loadPreset(candidatePath);
    }

    const preset = this.listRegisteredPresets(resolvedDirectory).find((entry) => entry.name === name);
    if (!preset) {
      throw new Error(`Unknown registered preset: ${name}`);
    }

    return preset;
  }

  listRegisteredPresetHistory(name: string, directory?: string): SpacePresetDefinition[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listRegisteredPresetHistoryFromDirectory(name, resolvedDirectory, (inputPath) => this.loadPreset(inputPath));
  }

  rollbackRegisteredPreset(
    name: string,
    options: { version: string; directory?: string; author?: string },
  ): SpacePresetDefinition {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const target = requirePresetHistoryVersion(
      this.listRegisteredPresetHistory(name, resolvedDirectory),
      name,
      options.version,
    );
    const now = new Date().toISOString();
    const rolledBack: SpacePresetDefinition = {
      ...target,
      name,
      author: options.author ?? target.author,
      source: `rollback:${options.version}`,
      updatedAt: now,
    };

    mkdirSync(resolvedDirectory, { recursive: true });
    writePresetFiles(resolvedDirectory, rolledBack);
    return rolledBack;
  }

  listPresetChannels(name: string, directory?: string): PresetChannelState {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return readPresetChannels(resolvedDirectory, name);
  }

  promotePresetChannel(
    name: string,
    options: { channel: string; version: string; directory?: string },
  ): PresetChannelState {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    requirePresetHistoryVersion(this.listRegisteredPresetHistory(name, resolvedDirectory), name, options.version);
    const current = readPresetChannels(resolvedDirectory, name);
    const next: PresetChannelState = {
      name,
      channels: {
        ...current.channels,
        [options.channel]: options.version,
      },
    };
    writePresetChannels(resolvedDirectory, next);
    return next;
  }

  resolvePresetChannel(
    name: string,
    options: { channel: string; directory?: string },
  ): SpacePresetDefinition {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const state = readPresetChannels(resolvedDirectory, name);
    const version = state.channels[options.channel];
    if (!version) {
      throw new Error(`Unknown preset channel for ${name}: ${options.channel}`);
    }

    return requirePresetHistoryVersion(
      this.listRegisteredPresetHistory(name, resolvedDirectory),
      name,
      version,
    );
  }

  async getSpace(spaceId: string): Promise<MemorySpace> {
    return requireSpace(this.repository, spaceId);
  }

  async configureSpace(input: ConfigureSpaceInput): Promise<MemorySpace> {
    const space = await requireSpace(this.repository, input.spaceId);
    const channelPreset =
      input.presetLocalName && input.presetChannel
        ? this.resolvePresetChannel(input.presetLocalName, {
            channel: input.presetChannel,
            directory: input.presetDirectory,
          })
        : undefined;
    const settings = mergeSpaceSettings(
      space.settings,
      input.preset ? getSpacePreset(input.preset) : undefined,
      channelPreset?.settings,
      input.presetDefinition?.settings,
      input.settings,
      mergeSpaceSettings(
        undefined,
        input.compaction ? { compaction: input.compaction } : undefined,
        input.retentionDays ? { retentionDays: input.retentionDays } : undefined,
        input.conflict ? { conflict: input.conflict } : undefined,
        input.decay ? { decay: input.decay } : undefined,
        input.routing ? { routing: input.routing } : undefined,
        input.reinforcement ? { reinforcement: input.reinforcement } : undefined,
      ),
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
    const space = await requireSpace(this.repository, input.spaceId);
    const record = createMemoryRecord(input);
    await this.repository.writeRecord(record);

    const existingRecords = await this.repository.listRecords(input.spaceId, Number.MAX_SAFE_INTEGER);
    const conflicts = detectConflicts(record, existingRecords, space.settings?.conflict);

    for (const action of conflicts) {
      await this.repository.writeRecord(action.updatedConflictingRecord);
    }

    for (const link of createConflictLinks(conflicts)) {
      await this.repository.linkRecords(link);
    }

    for (const event of createConflictEvents(conflicts)) {
      await this.repository.appendEvent(event);
    }

    return record;
  }

  async getRecord(recordId: string): Promise<MemoryRecord> {
    return requireRecord(this.repository, recordId);
  }

  async listRecords(spaceId: string, limit = 50): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, spaceId);
    return this.repository.listRecords(spaceId, limit);
  }

  async searchRecords(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: { reinforce?: SearchReinforcementOptions } = {},
  ): Promise<MemoryRecord[]> {
    await requireSpace(this.repository, query.spaceId);
    const results = await this.repository.searchRecords(query);

    if (options.reinforce?.enabled) {
      const limit = options.reinforce.limit ?? results.length;
      const recordIds = results.slice(0, Math.max(limit, 0)).map((record) => record.id);

      if (recordIds.length > 0) {
        await this.reinforceRecords(recordIds, {
          reason: options.reinforce.reason ?? "successful-retrieval",
          strength: options.reinforce.strength,
          now: options.reinforce.now,
        });
      }
    }

    return results;
  }

  async recallRecords(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<RecallPack[]> {
    await requireSpace(this.repository, query.spaceId);
    const results = await this.searchRecords(query, {
      reinforce: options.reinforce,
    });
    const primaryRecords = results.slice(0, Math.max(options.primaryLimit ?? results.length, 0));

    if (primaryRecords.length === 0) {
      return [];
    }

    const allRecords = await this.repository.listRecords(query.spaceId, Number.MAX_SAFE_INTEGER);
    const packs: RecallPack[] = [];

    for (const primary of primaryRecords) {
      const links = await this.repository.listLinksForRecord(primary.id);
      packs.push(
        buildRecallPack(primary, allRecords, links, {
          queryText: query.text,
          supportLimit: options.supportLimit,
          includeSameScopeDistilled: options.includeSameScopeDistilled,
        }),
      );
    }

    return packs;
  }

  async traceRecall(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<RecallTrace[]> {
    const packs = await this.recallRecords(query, options);
    return packs.map((pack) => buildRecallTrace(pack, query.text));
  }

  async bundleRecall(
    query: Parameters<MemoryRepository["searchRecords"]>[0],
    options: RecallOptions = {},
  ): Promise<MemoryBundle[]> {
    const space = await requireSpace(this.repository, query.spaceId);
    const packs = await this.recallRecords(query, options);
    return packs.map((pack) => buildMemoryBundle(pack, {
      queryText: query.text,
      profile: options.bundleProfile,
      consumer: options.bundleConsumer,
      routingPolicy: space.settings?.routing,
      maxSupporting: options.bundleMaxSupporting,
      maxContentChars: options.bundleMaxContentChars,
      preferCompact: options.bundlePreferCompact,
    }));
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

  async decaySpace(spaceId: string, options: { apply?: boolean; now?: Date } = {}): Promise<ReturnType<typeof planDecay>> {
    const space = await requireSpace(this.repository, spaceId);
    const records = await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planDecay(records, space.settings?.decay, options.now);

    if (options.apply) {
      for (const record of applyDecayPlan(plan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createDecayEvents(plan)) {
        await this.repository.appendEvent(event);
      }

      const summaryRecord = createDecaySummaryRecord(plan);
      if (summaryRecord) {
        await this.repository.writeRecord(summaryRecord);
        for (const link of createDecaySummaryLinks(summaryRecord, plan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    return plan;
  }

  async reinforceRecord(recordId: string, options: ReinforceRecordOptions = {}): Promise<ReturnType<typeof planReinforcement>> {
    return this.reinforceRecords([recordId], options);
  }

  async reinforceRecords(
    recordIds: string[],
    options: ReinforceRecordOptions = {},
  ): Promise<ReturnType<typeof planReinforcement>> {
    const uniqueRecordIds = [...new Set(recordIds)];

    if (uniqueRecordIds.length === 0) {
      return { reinforced: [] };
    }

    const firstRecord = await requireRecord(this.repository, uniqueRecordIds[0]!);
    for (const recordId of uniqueRecordIds.slice(1)) {
      const record = await requireRecord(this.repository, recordId);
      if (record.spaceId !== firstRecord.spaceId) {
        throw new Error("Reinforcement targets must belong to the same space.");
      }
    }

    const space = await requireSpace(this.repository, firstRecord.spaceId);
    const records = await this.repository.listRecords(firstRecord.spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planReinforcement(records, space.settings?.reinforcement, {
      recordIds: uniqueRecordIds,
      reason: options.reason,
      strength: options.strength,
      now: options.now,
    });

    await persistReinforcementPlan(this.repository, plan);
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

    const decayInputRecords = options.apply
      ? await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : postCompactionRecords;
    const decayPlan = planDecay(decayInputRecords, space.settings?.decay);

    if (options.apply) {
      for (const record of applyDecayPlan(decayPlan)) {
        await this.repository.writeRecord(record);
      }

      for (const event of createDecayEvents(decayPlan)) {
        await this.repository.appendEvent(event);
      }

      const decaySummary = createDecaySummaryRecord(decayPlan);
      if (decaySummary) {
        await this.repository.writeRecord(decaySummary);
        for (const link of createDecaySummaryLinks(decaySummary, decayPlan)) {
          await this.repository.linkRecords(link);
        }
      }
    }

    const retentionInputRecords = options.apply
      ? await this.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : mergeUpdatedRecords(decayInputRecords, applyDecayPlan(decayPlan));

    const retentionPlan = planRetention(
      retentionInputRecords,
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

    return { compactionPlan, decayPlan, retentionPlan, applied: options.apply === true };
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

function toPresetFileName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || basename(`${Date.now()}`);
}

function toPresetVersionFileName(version: string): string {
  const normalized = version
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "1-0-0";
}

function toPresetHistoryTimestamp(value: string | undefined): string {
  const normalized = (value ?? new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace(/[^0-9a-zA-Z-]/g, "");

  return normalized || basename(`${Date.now()}`);
}

function writePresetFiles(directory: string, preset: SpacePresetDefinition): void {
  const outputPath = join(directory, `${toPresetFileName(preset.name)}.json`);
  writeFileSync(outputPath, stringifySpacePresetDefinition(preset), "utf8");

  const historyDirectory = join(directory, ".versions", toPresetFileName(preset.name));
  mkdirSync(historyDirectory, { recursive: true });
  const historyPath = join(
    historyDirectory,
    `${toPresetHistoryTimestamp(preset.updatedAt)}--${toPresetVersionFileName(preset.version ?? "1.0.0")}.json`,
  );
  writeFileSync(historyPath, stringifySpacePresetDefinition(preset), "utf8");
}

function listRegisteredPresetHistoryFromDirectory(
  name: string,
  directory: string,
  loadPreset: (inputPath: string) => SpacePresetDefinition,
): SpacePresetDefinition[] {
  const historyDirectory = join(directory, ".versions", toPresetFileName(name));
  if (!existsSync(historyDirectory)) {
    return [];
  }

  return readdirSync(historyDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => loadPreset(join(historyDirectory, entry)))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function requirePresetHistoryVersion(
  history: SpacePresetDefinition[],
  name: string,
  version: string,
): SpacePresetDefinition {
  const match = history.find((preset) => preset.version === version);
  if (!match) {
    throw new Error(`Unknown preset version for ${name}: ${version}`);
  }

  return match;
}

function readPresetChannels(directory: string, name: string): PresetChannelState {
  const channelsPath = join(directory, ".channels", `${toPresetFileName(name)}.json`);
  if (!existsSync(channelsPath)) {
    return {
      name,
      channels: {},
    };
  }

  const parsed = JSON.parse(readFileSync(channelsPath, "utf8")) as Partial<PresetChannelState>;
  return {
    name,
    channels: parsed.channels && typeof parsed.channels === "object" ? { ...parsed.channels } : {},
  };
}

function writePresetChannels(directory: string, state: PresetChannelState): void {
  const channelsDirectory = join(directory, ".channels");
  mkdirSync(channelsDirectory, { recursive: true });
  const channelsPath = join(channelsDirectory, `${toPresetFileName(state.name)}.json`);
  writeFileSync(channelsPath, JSON.stringify(state, null, 2), "utf8");
}

function mergeSpaceSettings(
  ...settings: Array<MemorySpaceSettings | undefined>
): MemorySpaceSettings {
  const [existing, ...rest] = settings;

  return {
    ...(existing ?? {}),
    ...Object.assign({}, ...rest.map((entry) => entry ?? {})),
    retentionDays: {
      ...(existing?.retentionDays ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.retentionDays ?? {})),
    },
    compaction: {
      ...(existing?.compaction ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.compaction ?? {})),
    },
    conflict: {
      ...(existing?.conflict ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.conflict ?? {})),
    },
    decay: {
      ...(existing?.decay ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.decay ?? {})),
    },
    reinforcement: {
      ...(existing?.reinforcement ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.reinforcement ?? {})),
    },
    routing: {
      ...(existing?.routing ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.routing ?? {})),
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

async function persistReinforcementPlan(
  repository: MemoryRepository,
  plan: ReturnType<typeof planReinforcement>,
): Promise<void> {
  for (const updatedRecord of applyReinforcementPlan(plan)) {
    await repository.writeRecord(updatedRecord);
  }

  for (const event of createReinforcementEvents(plan)) {
    await repository.appendEvent(event);
  }

  const summaryRecord = createReinforcementSummaryRecord(plan);
  if (summaryRecord) {
    await repository.writeRecord(summaryRecord);
    for (const link of createReinforcementSummaryLinks(summaryRecord, plan)) {
      await repository.linkRecords(link);
    }
  }
}
