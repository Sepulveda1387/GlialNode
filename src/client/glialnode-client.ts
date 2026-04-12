import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

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
  defaultChannel?: string;
}

export interface SigningKeyRecord {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  updatedAt: string;
}

export interface SigningKeySummary {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedSignerRecord {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  publicKeyPem: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  replacedBy?: string;
}

export interface TrustedSignerSummary {
  name: string;
  algorithm: "ed25519";
  signer?: string;
  keyId: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  replacedBy?: string;
}

export interface PresetBundle {
  metadata: PresetBundleMetadata;
  exportedAt: string;
  preset: SpacePresetDefinition;
  history: SpacePresetDefinition[];
  channels: PresetChannelState;
}

export interface PresetBundleMetadata {
  bundleFormatVersion: number;
  glialnodeVersion: string;
  nodeEngine: string;
  origin?: string;
  signer?: string;
  checksumAlgorithm: "sha256";
  checksum: string;
  signatureAlgorithm?: "ed25519";
  signerKeyId?: string;
  signerPublicKey?: string;
  signature?: string;
}

export interface PresetBundleValidation {
  metadata: PresetBundleMetadata;
  warnings: string[];
  trustWarnings: string[];
  trusted: boolean;
  report: {
    trustProfile: PresetBundleTrustProfileName;
    effectivePolicy: PresetBundleTrustPolicy;
    signerKeyId?: string;
    matchedTrustedSignerNames: string[];
    revokedTrustedSignerNames: string[];
    signed: boolean;
  };
}

export interface PresetBundleTrustPolicy {
  requireSigner?: boolean;
  requireSignature?: boolean;
  allowedOrigins?: string[];
  allowedSigners?: string[];
  allowedSignerKeyIds?: string[];
  trustedSignerNames?: string[];
}

export type PresetBundleTrustProfileName = "permissive" | "signed" | "anchored";

const PRESET_BUNDLE_FORMAT_VERSION = 1;
const GLIALNODE_VERSION = "0.1.0";
const GLIALNODE_NODE_ENGINE = ">=24";

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
    const channelPreset = input.presetLocalName && (input.presetChannel || this.listPresetChannels(
      input.presetLocalName,
      input.presetDirectory,
    ).defaultChannel)
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

  generateSigningKey(
    name: string,
    options: { directory?: string; signer?: string; overwrite?: boolean } = {},
  ): SigningKeySummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const existingPath = getSigningKeyPath(directory, name);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Signing key already exists: ${name}`);
    }

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const timestamp = new Date().toISOString();
    const record: SigningKeyRecord = {
      name,
      algorithm: "ed25519",
      signer: options.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      privateKeyPem,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeSigningKeyRecord(directory, record);
    return toSigningKeySummary(record);
  }

  listSigningKeys(directory?: string): SigningKeySummary[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listSigningKeyRecords(resolvedDirectory).map((record) => toSigningKeySummary(record));
  }

  getSigningKey(name: string, directory?: string): SigningKeyRecord {
    return readSigningKeyRecord(resolve(directory ?? this.presetDirectory), name);
  }

  exportSigningPublicKey(name: string, outputPath: string, directory?: string): SigningKeySummary {
    const record = this.getSigningKey(name, directory);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, record.publicKeyPem, "utf8");
    return toSigningKeySummary(record);
  }

  trustSigningKey(
    name: string,
    options: { trustName?: string; directory?: string; signer?: string; overwrite?: boolean } = {},
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const key = this.getSigningKey(name, directory);
    const trustName = options.trustName ?? name;
    const existingPath = getTrustedSignerPath(directory, trustName);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Trusted signer already exists: ${trustName}`);
    }

    const timestamp = new Date().toISOString();
    const record: TrustedSignerRecord = {
      name: trustName,
      algorithm: "ed25519",
      signer: options.signer ?? key.signer,
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      source: `signing-key:${name}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);
    return toTrustedSignerSummary(record);
  }

  registerTrustedSignerFromPublicKey(
    inputPath: string,
    options: { name: string; directory?: string; signer?: string; source?: string; overwrite?: boolean },
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const existingPath = getTrustedSignerPath(directory, options.name);
    if (!options.overwrite && existsSync(existingPath)) {
      throw new Error(`Trusted signer already exists: ${options.name}`);
    }

    const publicKeyPem = readFileSync(resolve(inputPath), "utf8");
    const timestamp = new Date().toISOString();
    const record: TrustedSignerRecord = {
      name: options.name,
      algorithm: "ed25519",
      signer: options.signer,
      keyId: computeSignerKeyId(publicKeyPem),
      publicKeyPem,
      source: options.source ?? inputPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeTrustedSignerRecord(directory, record);
    return toTrustedSignerSummary(record);
  }

  listTrustedSigners(directory?: string): TrustedSignerSummary[] {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    return listTrustedSignerRecords(resolvedDirectory).map((record) => toTrustedSignerSummary(record));
  }

  listPresetBundleTrustProfiles(): PresetBundleTrustProfileName[] {
    return ["permissive", "signed", "anchored"];
  }

  getTrustedSigner(name: string, directory?: string): TrustedSignerRecord {
    return readTrustedSignerRecord(resolve(directory ?? this.presetDirectory), name);
  }

  revokeTrustedSigner(
    name: string,
    options: { directory?: string; replacedBy?: string } = {},
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const record = this.getTrustedSigner(name, directory);
    const revoked: TrustedSignerRecord = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
      replacedBy: options.replacedBy ?? record.replacedBy,
      updatedAt: new Date().toISOString(),
    };
    writeTrustedSignerRecord(directory, revoked);
    return toTrustedSignerSummary(revoked);
  }

  rotateTrustedSigner(
    currentName: string,
    inputPath: string,
    options: { nextName: string; directory?: string; signer?: string; source?: string; overwrite?: boolean },
  ): TrustedSignerSummary {
    const directory = resolve(options.directory ?? this.presetDirectory);
    const next = this.registerTrustedSignerFromPublicKey(inputPath, {
      name: options.nextName,
      directory,
      signer: options.signer,
      source: options.source,
      overwrite: options.overwrite,
    });
    this.revokeTrustedSigner(currentName, {
      directory,
      replacedBy: next.name,
    });
    return next;
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

  setDefaultPresetChannel(
    name: string,
    options: { channel: string; directory?: string },
  ): PresetChannelState {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const current = readPresetChannels(resolvedDirectory, name);
    if (!current.channels[options.channel]) {
      throw new Error(`Unknown preset channel for ${name}: ${options.channel}`);
    }

    const next: PresetChannelState = {
      ...current,
      defaultChannel: options.channel,
    };
    writePresetChannels(resolvedDirectory, next);
    return next;
  }

  exportPresetChannels(name: string, outputPath: string, directory?: string): PresetChannelState {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const state = readPresetChannels(resolvedDirectory, name);
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(state, null, 2), "utf8");
    return state;
  }

  importPresetChannels(inputPath: string, options: { directory?: string; name?: string } = {}): PresetChannelState {
    const parsed = parsePresetChannelState(readFileSync(resolve(inputPath), "utf8"));
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const state: PresetChannelState = {
      ...parsed,
      name: options.name ?? parsed.name,
    };
    writePresetChannels(resolvedDirectory, state);
    return state;
  }

  exportPresetBundle(
    name: string,
    outputPath: string,
    directory?: string,
    trust?: {
      origin?: string;
      signer?: string;
      signingKeyName?: string;
      signingPrivateKeyPem?: string;
      signingPublicKeyPem?: string;
    },
  ): PresetBundle {
    const resolvedDirectory = resolve(directory ?? this.presetDirectory);
    const resolvedSigningKey = trust?.signingKeyName
      ? this.getSigningKey(trust.signingKeyName, resolvedDirectory)
      : undefined;
    const signerPublicKeyPem = trust?.signingPrivateKeyPem
      ? (trust.signingPublicKeyPem ?? createPublicKey(createPrivateKey(trust.signingPrivateKeyPem)).export({
          type: "spki",
          format: "pem",
        }).toString())
      : resolvedSigningKey?.publicKeyPem
      ? resolvedSigningKey.publicKeyPem
      : undefined;
    const bundle: PresetBundle = {
      metadata: {
        bundleFormatVersion: PRESET_BUNDLE_FORMAT_VERSION,
        glialnodeVersion: GLIALNODE_VERSION,
        nodeEngine: GLIALNODE_NODE_ENGINE,
        origin: trust?.origin,
        signer: trust?.signer ?? resolvedSigningKey?.signer,
        checksumAlgorithm: "sha256",
        checksum: "",
        signatureAlgorithm: signerPublicKeyPem ? "ed25519" : undefined,
        signerKeyId: signerPublicKeyPem ? computeSignerKeyId(signerPublicKeyPem) : undefined,
        signerPublicKey: signerPublicKeyPem,
        signature: undefined,
      },
      exportedAt: new Date().toISOString(),
      preset: this.getRegisteredPreset(name, resolvedDirectory),
      history: this.listRegisteredPresetHistory(name, resolvedDirectory),
      channels: this.listPresetChannels(name, resolvedDirectory),
    };
    bundle.metadata.checksum = computePresetBundleChecksum(bundle);
    const signingPrivateKeyPem = trust?.signingPrivateKeyPem ?? resolvedSigningKey?.privateKeyPem;
    if (signingPrivateKeyPem) {
      bundle.metadata.signature = computePresetBundleSignature(bundle, signingPrivateKeyPem);
    }
    const resolvedOutputPath = resolve(outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, JSON.stringify(bundle, null, 2), "utf8");
    return bundle;
  }

  importPresetBundle(
    inputPath: string,
    options: {
      directory?: string;
      name?: string;
      trustPolicy?: PresetBundleTrustPolicy;
      trustProfile?: PresetBundleTrustProfileName;
    } = {},
  ): PresetBundle {
    const bundle = parsePresetBundle(readFileSync(resolve(inputPath), "utf8"));
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    validatePresetBundle(
      bundle,
      resolvePresetBundleTrustPolicy(options.trustPolicy, resolvedDirectory, options.trustProfile),
      options.trustProfile ?? "permissive",
    );
    const nextName = options.name ?? bundle.preset.name;
    const history = bundle.history.map((preset) => ({
      ...preset,
      name: nextName,
    }));
    for (const preset of history) {
      writePresetHistoryFile(resolvedDirectory, preset);
    }

    const activePreset: SpacePresetDefinition = {
      ...bundle.preset,
      name: nextName,
    };
    writePresetFiles(resolvedDirectory, activePreset);

    const channels: PresetChannelState = {
      ...bundle.channels,
      name: nextName,
    };
    writePresetChannels(resolvedDirectory, channels);

    return {
      ...bundle,
      preset: activePreset,
      history,
      channels,
    };
  }

  validatePresetBundle(
    inputPath: string,
    trustPolicy?: PresetBundleTrustPolicy,
    trustProfile?: PresetBundleTrustProfileName,
  ): PresetBundleValidation {
    const resolvedDirectory = resolve(this.presetDirectory);
    const bundle = parsePresetBundle(readFileSync(resolve(inputPath), "utf8"));
    return validatePresetBundle(
      bundle,
      resolvePresetBundleTrustPolicy(trustPolicy, resolvedDirectory, trustProfile),
      trustProfile ?? "permissive",
    );
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
      defaultChannel: current.defaultChannel,
    };
    writePresetChannels(resolvedDirectory, next);
    return next;
  }

  resolvePresetChannel(
    name: string,
    options: { channel?: string; directory?: string },
  ): SpacePresetDefinition {
    const resolvedDirectory = resolve(options.directory ?? this.presetDirectory);
    const state = readPresetChannels(resolvedDirectory, name);
    const channel = options.channel ?? state.defaultChannel;
    if (!channel) {
      throw new Error(`No preset channel selected for ${name}.`);
    }
    const version = state.channels[channel];
    if (!version) {
      throw new Error(`Unknown preset channel for ${name}: ${channel}`);
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
    const channelPreset = input.presetLocalName && (input.presetChannel || this.listPresetChannels(
      input.presetLocalName,
      input.presetDirectory,
    ).defaultChannel)
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

  writePresetHistoryFile(directory, preset);
}

function writePresetHistoryFile(directory: string, preset: SpacePresetDefinition): void {
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

  const parsed = parsePresetChannelState(readFileSync(channelsPath, "utf8"));
  return {
    ...parsed,
    name,
  };
}

function writePresetChannels(directory: string, state: PresetChannelState): void {
  const channelsDirectory = join(directory, ".channels");
  mkdirSync(channelsDirectory, { recursive: true });
  const channelsPath = join(channelsDirectory, `${toPresetFileName(state.name)}.json`);
  writeFileSync(channelsPath, JSON.stringify(state, null, 2), "utf8");
}

function getSigningKeysDirectory(directory: string): string {
  return join(directory, ".keys");
}

function getSigningKeyPath(directory: string, name: string): string {
  return join(getSigningKeysDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeSigningKeyRecord(directory: string, record: SigningKeyRecord): void {
  const keysDirectory = getSigningKeysDirectory(directory);
  mkdirSync(keysDirectory, { recursive: true });
  writeFileSync(getSigningKeyPath(directory, record.name), JSON.stringify(record, null, 2), "utf8");
}

function readSigningKeyRecord(directory: string, name: string): SigningKeyRecord {
  const recordPath = getSigningKeyPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown signing key: ${name}`);
  }

  return parseSigningKeyRecord(readFileSync(recordPath, "utf8"));
}

function listSigningKeyRecords(directory: string): SigningKeyRecord[] {
  const keysDirectory = getSigningKeysDirectory(directory);
  if (!existsSync(keysDirectory)) {
    return [];
  }

  return readdirSync(keysDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseSigningKeyRecord(readFileSync(join(keysDirectory, entry), "utf8")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseSigningKeyRecord(value: string): SigningKeyRecord {
  const parsed = JSON.parse(value) as Partial<SigningKeyRecord>;
  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid signing key record: missing name.");
  }
  if (parsed.algorithm !== "ed25519") {
    throw new Error(`Invalid signing key algorithm: ${String(parsed.algorithm ?? "undefined")}`);
  }
  if (typeof parsed.publicKeyPem !== "string" || typeof parsed.privateKeyPem !== "string") {
    throw new Error("Invalid signing key record: missing PEM material.");
  }

  const keyId = typeof parsed.keyId === "string" && parsed.keyId
    ? parsed.keyId
    : computeSignerKeyId(parsed.publicKeyPem);
  const timestamp = new Date().toISOString();

  return {
    name: parsed.name,
    algorithm: "ed25519",
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    keyId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
  };
}

function toSigningKeySummary(record: SigningKeyRecord): SigningKeySummary {
  return {
    name: record.name,
    algorithm: record.algorithm,
    signer: record.signer,
    keyId: record.keyId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function getTrustedSignersDirectory(directory: string): string {
  return join(directory, ".trusted");
}

function getTrustedSignerPath(directory: string, name: string): string {
  return join(getTrustedSignersDirectory(directory), `${toPresetFileName(name)}.json`);
}

function writeTrustedSignerRecord(directory: string, record: TrustedSignerRecord): void {
  const trustDirectory = getTrustedSignersDirectory(directory);
  mkdirSync(trustDirectory, { recursive: true });
  writeFileSync(getTrustedSignerPath(directory, record.name), JSON.stringify(record, null, 2), "utf8");
}

function readTrustedSignerRecord(directory: string, name: string): TrustedSignerRecord {
  const recordPath = getTrustedSignerPath(directory, name);
  if (!existsSync(recordPath)) {
    throw new Error(`Unknown trusted signer: ${name}`);
  }

  return parseTrustedSignerRecord(readFileSync(recordPath, "utf8"));
}

function listTrustedSignerRecords(directory: string): TrustedSignerRecord[] {
  const trustDirectory = getTrustedSignersDirectory(directory);
  if (!existsSync(trustDirectory)) {
    return [];
  }

  return readdirSync(trustDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => parseTrustedSignerRecord(readFileSync(join(trustDirectory, entry), "utf8")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTrustedSignerRecord(value: string): TrustedSignerRecord {
  const parsed = JSON.parse(value) as Partial<TrustedSignerRecord>;
  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Invalid trusted signer record: missing name.");
  }
  if (parsed.algorithm !== "ed25519") {
    throw new Error(`Invalid trusted signer algorithm: ${String(parsed.algorithm ?? "undefined")}`);
  }
  if (typeof parsed.publicKeyPem !== "string" || !parsed.publicKeyPem) {
    throw new Error("Invalid trusted signer record: missing public key.");
  }

  const timestamp = new Date().toISOString();
  return {
    name: parsed.name,
    algorithm: "ed25519",
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    keyId: typeof parsed.keyId === "string" && parsed.keyId ? parsed.keyId : computeSignerKeyId(parsed.publicKeyPem),
    publicKeyPem: parsed.publicKeyPem,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
    revokedAt: typeof parsed.revokedAt === "string" ? parsed.revokedAt : undefined,
    replacedBy: typeof parsed.replacedBy === "string" ? parsed.replacedBy : undefined,
  };
}

function toTrustedSignerSummary(record: TrustedSignerRecord): TrustedSignerSummary {
  return {
    name: record.name,
    algorithm: record.algorithm,
    signer: record.signer,
    keyId: record.keyId,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
    replacedBy: record.replacedBy,
  };
}

function parsePresetChannelState(value: string): PresetChannelState {
  const parsed = JSON.parse(value) as Partial<PresetChannelState>;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "preset",
    channels: parsed.channels && typeof parsed.channels === "object" ? { ...parsed.channels } : {},
    defaultChannel: typeof parsed.defaultChannel === "string" ? parsed.defaultChannel : undefined,
  };
}

function parsePresetBundle(value: string): PresetBundle {
  const parsed = JSON.parse(value) as Partial<PresetBundle>;
  return {
    metadata: parsePresetBundleMetadata(JSON.stringify(parsed.metadata ?? {})),
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    preset: parseSpacePresetDefinition(JSON.stringify(parsed.preset ?? {})),
    history: Array.isArray(parsed.history)
      ? parsed.history.map((entry) => parseSpacePresetDefinition(JSON.stringify(entry)))
      : [],
    channels: parsePresetChannelState(JSON.stringify(parsed.channels ?? {})),
  };
}

function parsePresetBundleMetadata(value: string): PresetBundleMetadata {
  const parsed = JSON.parse(value) as Partial<PresetBundleMetadata>;
  return {
    bundleFormatVersion: typeof parsed.bundleFormatVersion === "number" ? parsed.bundleFormatVersion : PRESET_BUNDLE_FORMAT_VERSION,
    glialnodeVersion: typeof parsed.glialnodeVersion === "string" ? parsed.glialnodeVersion : GLIALNODE_VERSION,
    nodeEngine: typeof parsed.nodeEngine === "string" ? parsed.nodeEngine : GLIALNODE_NODE_ENGINE,
    origin: typeof parsed.origin === "string" ? parsed.origin : undefined,
    signer: typeof parsed.signer === "string" ? parsed.signer : undefined,
    checksumAlgorithm: parsed.checksumAlgorithm === "sha256" ? "sha256" : "sha256",
    checksum: typeof parsed.checksum === "string" ? parsed.checksum : "",
    signatureAlgorithm: parsed.signatureAlgorithm === "ed25519" ? "ed25519" : undefined,
    signerKeyId: typeof parsed.signerKeyId === "string" ? parsed.signerKeyId : undefined,
    signerPublicKey: typeof parsed.signerPublicKey === "string" ? parsed.signerPublicKey : undefined,
    signature: typeof parsed.signature === "string" ? parsed.signature : undefined,
  };
}

function validatePresetBundle(
  bundle: PresetBundle,
  trustPolicy: PresetBundleTrustPolicy = {},
  trustProfile: PresetBundleTrustProfileName = "permissive",
): PresetBundleValidation {
  if (bundle.metadata.bundleFormatVersion !== PRESET_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported preset bundle format: ${bundle.metadata.bundleFormatVersion}. Expected ${PRESET_BUNDLE_FORMAT_VERSION}.`,
    );
  }

  const warnings: string[] = [];
  const trustWarnings: string[] = [];
  const matchedTrustedSignerNames: string[] = [];
  const revokedTrustedSignerNames: string[] = [];
  if (bundle.metadata.glialnodeVersion !== GLIALNODE_VERSION) {
    warnings.push(
      `Bundle was exported by GlialNode ${bundle.metadata.glialnodeVersion}; current runtime is ${GLIALNODE_VERSION}.`,
    );
  }

  if (bundle.metadata.nodeEngine !== GLIALNODE_NODE_ENGINE) {
    warnings.push(
      `Bundle targets Node ${bundle.metadata.nodeEngine}; current package requires ${GLIALNODE_NODE_ENGINE}.`,
    );
  }

  const expectedChecksum = computePresetBundleChecksum(bundle);
  if (bundle.metadata.checksum !== expectedChecksum) {
    throw new Error("Preset bundle checksum verification failed.");
  }

  if (trustPolicy.requireSigner && !bundle.metadata.signer) {
    trustWarnings.push("Preset bundle is unsigned.");
  }

  if (trustPolicy.requireSignature && !bundle.metadata.signature) {
    trustWarnings.push("Preset bundle is unsigned by key.");
  }

  if (trustPolicy.allowedOrigins?.length) {
    if (!bundle.metadata.origin) {
      trustWarnings.push("Preset bundle origin is missing.");
    } else if (!trustPolicy.allowedOrigins.includes(bundle.metadata.origin)) {
      trustWarnings.push(`Preset bundle origin is not allowed: ${bundle.metadata.origin}`);
    }
  }

  if (trustPolicy.allowedSigners?.length) {
    if (!bundle.metadata.signer) {
      trustWarnings.push("Preset bundle signer is missing.");
    } else if (!trustPolicy.allowedSigners.includes(bundle.metadata.signer)) {
      trustWarnings.push(`Preset bundle signer is not allowed: ${bundle.metadata.signer}`);
    }
  }

  if (bundle.metadata.signature) {
    if (bundle.metadata.signatureAlgorithm !== "ed25519") {
      throw new Error(`Unsupported preset bundle signature algorithm: ${bundle.metadata.signatureAlgorithm ?? "unknown"}.`);
    }

    if (!bundle.metadata.signerPublicKey) {
      throw new Error("Preset bundle signature is missing signer public key.");
    }

    const signerKeyId = computeSignerKeyId(bundle.metadata.signerPublicKey);
    if (bundle.metadata.signerKeyId && bundle.metadata.signerKeyId !== signerKeyId) {
      throw new Error("Preset bundle signer key id verification failed.");
    }

    const verified = verifyPresetBundleSignature(bundle);
    if (!verified) {
      throw new Error("Preset bundle signature verification failed.");
    }

    if (trustPolicy.allowedSignerKeyIds?.length && !trustPolicy.allowedSignerKeyIds.includes(signerKeyId)) {
      trustWarnings.push(`Preset bundle signer key id is not allowed: ${signerKeyId}`);
    }

    if (trustPolicy.trustedSignerNames?.length && trustPolicy.allowedSignerKeyIds?.includes(signerKeyId)) {
      matchedTrustedSignerNames.push(...trustPolicy.trustedSignerNames);
    }
  } else if (trustPolicy.allowedSignerKeyIds?.length) {
    trustWarnings.push("Preset bundle signer key id is missing.");
  }

  if (trustWarnings.length > 0) {
    throw new Error(`Preset bundle trust validation failed: ${trustWarnings.join("; ")}`);
  }

  return {
    metadata: bundle.metadata,
    warnings,
    trustWarnings,
    trusted: true,
    report: {
      trustProfile,
      effectivePolicy: trustPolicy,
      signerKeyId: bundle.metadata.signerKeyId
        ?? (bundle.metadata.signerPublicKey ? computeSignerKeyId(bundle.metadata.signerPublicKey) : undefined),
      matchedTrustedSignerNames,
      revokedTrustedSignerNames,
      signed: Boolean(bundle.metadata.signature),
    },
  };
}

function resolvePresetBundleTrustPolicy(
  trustPolicy: PresetBundleTrustPolicy | undefined,
  directory: string,
  trustProfile: PresetBundleTrustProfileName = "permissive",
): PresetBundleTrustPolicy {
  const profilePolicy = getPresetBundleTrustProfile(trustProfile);
  const basePolicy: PresetBundleTrustPolicy = {
    ...profilePolicy,
    ...trustPolicy,
    allowedOrigins: mergeStringArrays(profilePolicy.allowedOrigins, trustPolicy?.allowedOrigins),
    allowedSigners: mergeStringArrays(profilePolicy.allowedSigners, trustPolicy?.allowedSigners),
    allowedSignerKeyIds: mergeStringArrays(profilePolicy.allowedSignerKeyIds, trustPolicy?.allowedSignerKeyIds),
    trustedSignerNames: mergeStringArrays(profilePolicy.trustedSignerNames, trustPolicy?.trustedSignerNames),
  };

  if (!basePolicy.trustedSignerNames?.length) {
    if (trustProfile === "anchored" && !basePolicy.allowedSignerKeyIds?.length) {
      throw new Error("Trust profile 'anchored' requires trusted signers or allowed signer key ids.");
    }
    return basePolicy;
  }

  const trustedKeyIds = basePolicy.trustedSignerNames
    .map((name) => {
      const record = readTrustedSignerRecord(directory, name);
      if (record.revokedAt) {
        throw new Error(`Trusted signer is revoked: ${name}`);
      }
      return record.keyId;
    });
  const allowedSignerKeyIds = [
    ...(basePolicy.allowedSignerKeyIds ?? []),
    ...trustedKeyIds,
  ];

  return {
    ...basePolicy,
    allowedSignerKeyIds: Array.from(new Set(allowedSignerKeyIds)),
  };
}

function getPresetBundleTrustProfile(profile: PresetBundleTrustProfileName): PresetBundleTrustPolicy {
  switch (profile) {
    case "permissive":
      return {};
    case "signed":
      return {
        requireSigner: true,
        requireSignature: true,
      };
    case "anchored":
      return {
        requireSigner: true,
        requireSignature: true,
      };
    default:
      return {};
  }
}

function mergeStringArrays(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function computePresetBundleChecksum(bundle: PresetBundle): string {
  const checksumPayload = {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      checksum: "",
      signature: undefined,
    },
  };

  return createHash("sha256")
    .update(stableStringify(checksumPayload))
    .digest("hex");
}

function computePresetBundleSignature(bundle: PresetBundle, privateKeyPem: string): string {
  const payload = createPresetBundleSignaturePayload(bundle);
  return sign(null, payload, createPrivateKey(privateKeyPem)).toString("base64");
}

function verifyPresetBundleSignature(bundle: PresetBundle): boolean {
  if (!bundle.metadata.signature || !bundle.metadata.signerPublicKey) {
    return false;
  }

  const payload = createPresetBundleSignaturePayload(bundle);
  return verify(
    null,
    payload,
    createPublicKey(bundle.metadata.signerPublicKey),
    Buffer.from(bundle.metadata.signature, "base64"),
  );
}

function createPresetBundleSignaturePayload(bundle: PresetBundle): Buffer {
  return Buffer.from(stableStringify({
    ...bundle,
    metadata: {
      ...bundle.metadata,
      signature: undefined,
    },
  }));
}

function computeSignerKeyId(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]);
    return Object.fromEntries(entries);
  }

  return value;
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
    provenance: {
      ...(existing?.provenance ?? {}),
      ...Object.assign({}, ...rest.map((entry) => entry?.provenance ?? {})),
      trustedSignerNames: mergeStringArrays(
        existing?.provenance?.trustedSignerNames,
        ([] as string[]).concat(...rest.map((entry) => entry?.provenance?.trustedSignerNames ?? [])),
      ),
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
