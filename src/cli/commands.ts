import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createId } from "../core/ids.js";
import type {
  ActorType,
  CreateMemoryRecordInput,
  EventType,
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySpace,
  MemoryKind,
  RecordStatus,
  MemoryTier,
  MemoryVisibility,
  ScopeRecord,
  ScopeType,
} from "../core/types.js";
import type { CompactionPolicy } from "../core/config.js";
import {
  applyCompactionPlan,
  createCompactionEvents,
  createCompactionSummaryLinks,
  createCompactionSummaryRecord,
  planCompaction,
  summarizeCompactionPlan,
} from "../memory/compaction.js";
import { promoteRecord } from "../memory/promotion.js";
import {
  applyRetentionPlan,
  createRetentionEvents,
  createRetentionSummaryLinks,
  createRetentionSummaryRecord,
  planRetention,
  summarizeRetentionPlan,
} from "../memory/retention.js";
import { createMemoryRecord, updateRecordStatus } from "../memory/service.js";
import { SqliteMemoryRepository } from "../storage/index.js";
import type { ParsedArgs } from "./args.js";

export interface CommandResult {
  lines: string[];
}

export interface CommandContext {
  repository: SqliteMemoryRepository;
}

export function createRepository(databasePath: string): SqliteMemoryRepository {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return new SqliteMemoryRepository({ filename: resolvedPath });
}

export async function runCommand(parsed: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const [resource = "status", action = "show"] = parsed.positional;

  if (resource === "status") {
    return runStatusCommand(context);
  }

  if (resource === "space") {
    return runSpaceCommand(action, parsed, context);
  }

  if (resource === "scope") {
    return runScopeCommand(action, parsed, context);
  }

  if (resource === "memory") {
    return runMemoryCommand(action, parsed, context);
  }

  if (resource === "event") {
    return runEventCommand(action, parsed, context);
  }

  if (resource === "link") {
    return runLinkCommand(action, parsed, context);
  }

  if (resource === "export") {
    return runExportCommand(parsed, context);
  }

  if (resource === "import") {
    return runImportCommand(parsed, context);
  }

  return {
    lines: [
      "Unknown command.",
      usageText(),
    ],
  };
}

export function usageText(): string {
  return [
    "Usage:",
    "  glialnode status",
    "  glialnode space create --name <name> [--description <text>] [--db <path>]",
    "  glialnode space list [--db <path>]",
    "  glialnode space show --id <id> [--db <path>]",
    "  glialnode space report --id <id> [--recent-events 10] [--db <path>]",
    "  glialnode space maintain --id <id> [--apply] [--db <path>]",
    "  glialnode space configure --id <id> [--settings <json>] [--short-promote-importance-min 0.95] [--short-promote-confidence-min 0.95] [--mid-promote-importance-min 0.9] [--mid-promote-confidence-min 0.85] [--mid-promote-freshness-min 0.6] [--archive-importance-max 0.3] [--archive-confidence-max 0.4] [--archive-freshness-max 0.3] [--retention-short-days 7] [--retention-mid-days 30] [--retention-long-days 90] [--db <path>]",
    "  glialnode scope add --space-id <id> --type <type> [--label <text>] [--external-id <id>] [--parent-scope-id <id>] [--db <path>]",
    "  glialnode scope list --space-id <id> [--db <path>]",
    "  glialnode memory add --space-id <id> --scope-id <id> --scope-type <type> --tier <tier> --kind <kind> --content <text> [--summary <text>] [--tags a,b] [--visibility <visibility>] [--importance 0.7] [--confidence 0.8] [--freshness 0.6] [--db <path>]",
    "  glialnode memory search --space-id <id> [--text <query>] [--scope-id <id>] [--tier <tier>] [--kind <kind>] [--visibility <visibility>] [--status <status>] [--limit 10] [--db <path>]",
    "  glialnode memory list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode memory compact --space-id <id> [--apply] [--db <path>]",
    "  glialnode memory retain --space-id <id> [--apply] [--db <path>]",
    "  glialnode event add --space-id <id> --scope-id <id> --scope-type <type> --actor-type <type> --actor-id <id> --event-type <type> --summary <text> [--payload <json>] [--db <path>]",
    "  glialnode event list --space-id <id> [--limit 10] [--db <path>]",
    "  glialnode link add --space-id <id> --from-record-id <id> --to-record-id <id> --type <relation> [--db <path>]",
    "  glialnode link list --space-id <id> [--record-id <id>] [--limit 10] [--db <path>]",
    "  glialnode export --space-id <id> [--output <path>] [--db <path>]",
    "  glialnode import --input <path> [--db <path>]",
    "  glialnode memory promote --record-id <id> [--db <path>]",
    "  glialnode memory archive --record-id <id> [--db <path>]",
    "  glialnode memory show --record-id <id> [--db <path>]",
  ].join("\n");
}

async function runStatusCommand(context: CommandContext): Promise<CommandResult> {
  const spaces = await context.repository.listSpaces();
  const runtime = context.repository.getRuntimeSettings();

  return {
    lines: [
      `spaces=${spaces.length}`,
      "status=ready",
      `journalMode=${runtime.journalMode.toLowerCase()}`,
      `synchronous=${runtime.synchronous.toLowerCase()}`,
      `busyTimeoutMs=${runtime.busyTimeoutMs}`,
      `foreignKeys=${runtime.foreignKeys ? "on" : "off"}`,
      `defensive=${runtime.defensive === null ? "unsupported" : runtime.defensive ? "on" : "off"}`,
    ],
  };
}

async function runSpaceCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "create") {
    const name = requireFlag(parsed.flags, "name");
    const timestamp = new Date().toISOString();
    const id = createId("space");

    await context.repository.createSpace({
      id,
      name,
      description: parsed.flags.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      lines: [
        "Space created.",
        `id=${id}`,
        `name=${name}`,
      ],
    };
  }

  if (action === "list") {
    const spaces = await context.repository.listSpaces();

    return {
      lines: [
        `spaces=${spaces.length}`,
        ...spaces.map((space) => `${space.id} ${space.name}`),
      ],
    };
  }

  if (action === "show") {
    const spaceId = requireFlag(parsed.flags, "id");
    const space = await requireSpace(context.repository, spaceId);

    return {
      lines: [
        `id=${space.id}`,
        `name=${space.name}`,
        `description=${space.description ?? ""}`,
        `settings=${JSON.stringify(space.settings ?? {})}`,
      ],
    };
  }

  if (action === "configure") {
    const spaceId = requireFlag(parsed.flags, "id");
    const space = await requireSpace(context.repository, spaceId);
    const settingsFromJson = parsed.flags.settings ? parseSettingsFlag(parsed.flags.settings) : {};
    const settingsFromFlags = mergeSpaceSettings(
      undefined,
      parseCompactionFlags(parsed.flags),
      parseRetentionFlags(parsed.flags),
    );
    const mergedSettings = mergeSpaceSettings(space.settings, settingsFromJson, settingsFromFlags);

    await context.repository.createSpace({
      ...space,
      settings: mergedSettings,
      updatedAt: new Date().toISOString(),
    });

    return {
      lines: [
        "Space configured.",
        `id=${space.id}`,
        `settings=${JSON.stringify(mergedSettings)}`,
      ],
    };
  }

  if (action === "report") {
    const spaceId = requireFlag(parsed.flags, "id");
    await requireSpace(context.repository, spaceId);
    const report = await context.repository.getSpaceReport(
      spaceId,
      parsed.flags["recent-events"] ? Number(parsed.flags["recent-events"]) : 10,
    );

    return {
      lines: [
        `spaceId=${report.spaceId}`,
        `records=${report.recordCount}`,
        `events=${report.eventCount}`,
        `links=${report.linkCount}`,
        `tiers=${formatCounts(report.recordsByTier)}`,
        `statuses=${formatCounts(report.recordsByStatus)}`,
        `kinds=${formatCounts(report.recordsByKind)}`,
        `recentLifecycleEvents=${report.recentLifecycleEvents.length}`,
        ...report.recentLifecycleEvents.map(
          (event) => `${event.id} ${event.type} ${truncate(event.summary, 100)}`,
        ),
      ],
    };
  }

  if (action === "maintain") {
    const spaceId = requireFlag(parsed.flags, "id");
    const shouldApply = parsed.flags.apply === "true";
    const space = await requireSpace(context.repository, spaceId);

    const initialRecords = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const compactionPlan = planCompaction(initialRecords, space.settings?.compaction);
    const simulatedCompactionRecords = shouldApply
      ? initialRecords
      : mergeUpdatedRecords(initialRecords, applyCompactionPlan(compactionPlan));

    let compactionUpdates: MemoryRecord[] = [];
    if (shouldApply) {
      compactionUpdates = applyCompactionPlan(compactionPlan);
      for (const record of compactionUpdates) {
        await context.repository.writeRecord(record);
      }
      for (const event of createCompactionEvents(compactionPlan)) {
        await context.repository.appendEvent(event);
      }
      const summaryRecord = createCompactionSummaryRecord(compactionPlan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createCompactionSummaryLinks(summaryRecord, compactionPlan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    const retentionInputRecords = shouldApply
      ? await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER)
      : simulatedCompactionRecords;
    const retentionPlan = planRetention(retentionInputRecords, space.settings?.retentionDays);

    if (shouldApply) {
      const retentionUpdates = applyRetentionPlan(retentionPlan);
      for (const record of retentionUpdates) {
        await context.repository.writeRecord(record);
      }
      for (const event of createRetentionEvents(retentionPlan)) {
        await context.repository.appendEvent(event);
      }
      const summaryRecord = createRetentionSummaryRecord(retentionPlan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, retentionPlan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Maintenance applied." : "Maintenance dry run.",
        "phase=compaction",
        ...summarizeCompactionPlan(compactionPlan),
        "phase=retention",
        ...summarizeRetentionPlan(retentionPlan),
      ],
    };
  }

  return {
    lines: ["Unknown space command.", usageText()],
  };
}

async function runScopeCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const type = requireScopeType(parsed.flags["type"]);
    const timestamp = new Date().toISOString();
    const id = createId("scope");

    await context.repository.upsertScope({
      id,
      spaceId,
      type,
      externalId: parsed.flags["external-id"],
      label: parsed.flags.label,
      parentScopeId: parsed.flags["parent-scope-id"],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      lines: [
        "Scope added.",
        `id=${id}`,
        `spaceId=${spaceId}`,
        `type=${type}`,
      ],
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const scopes = await context.repository.listScopes(spaceId);

    return {
      lines: [
        `scopes=${scopes.length}`,
        ...scopes.map((scope) => `${scope.id} ${scope.type}${scope.label ? ` ${scope.label}` : ""}`),
      ],
    };
  }

  return {
    lines: ["Unknown scope command.", usageText()],
  };
}

async function runMemoryCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const input = createMemoryInput(parsed);
    const record = createMemoryRecord(input);

    await context.repository.writeRecord(record);

    return {
      lines: [
        "Memory record added.",
        `id=${record.id}`,
        `tier=${record.tier}`,
        `kind=${record.kind}`,
      ],
    };
  }

  if (action === "search") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const records = await context.repository.searchRecords({
      spaceId,
      text: parsed.flags.text,
      scopeIds: parsed.flags["scope-id"] ? [parsed.flags["scope-id"]] : undefined,
      tiers: parsed.flags.tier ? [requireTier(parsed.flags.tier)] : undefined,
      kinds: parsed.flags.kind ? [requireKind(parsed.flags.kind)] : undefined,
      visibility: parsed.flags.visibility ? [requireVisibility(parsed.flags.visibility)] : undefined,
      statuses: parsed.flags.status ? [requireStatus(parsed.flags.status)] : undefined,
      limit: parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    });

    return {
      lines: [
        `records=${records.length}`,
        ...records.map(
          (record) =>
            `${record.id} ${record.tier} ${record.kind} ${truncate(record.summary ?? record.content, 80)}`,
        ),
      ],
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const records = await context.repository.listRecords(
      spaceId,
      parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    );

    return {
      lines: [
        `records=${records.length}`,
        ...records.map(
          (record) =>
            `${record.id} ${record.tier} ${record.kind} ${record.status} ${truncate(record.summary ?? record.content, 80)}`,
        ),
      ],
    };
  }

  if (action === "promote") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const promoted = promoteRecord(record);

    await context.repository.writeRecord(promoted);

    return {
      lines: [
        "Memory record promoted.",
        `id=${promoted.id}`,
        `tier=${promoted.tier}`,
      ],
    };
  }

  if (action === "archive") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const archived = updateRecordStatus(record, "archived");

    await context.repository.writeRecord(archived);

    return {
      lines: [
        "Memory record archived.",
        `id=${archived.id}`,
        `status=${archived.status}`,
      ],
    };
  }

  if (action === "show") {
    const recordId = requireFlag(parsed.flags, "record-id");
    const record = await requireRecord(context.repository, recordId);
    const links = await context.repository.listLinksForRecord(recordId);

    return {
      lines: [
        `id=${record.id}`,
        `spaceId=${record.spaceId}`,
        `scopeId=${record.scope.id}`,
        `scopeType=${record.scope.type}`,
        `tier=${record.tier}`,
        `kind=${record.kind}`,
        `status=${record.status}`,
        `visibility=${record.visibility}`,
        `tags=${record.tags.join(",")}`,
        `summary=${record.summary ?? ""}`,
        `content=${record.content}`,
        `links=${links.length}`,
        ...links.map((link) => `${link.id} ${link.type} ${link.fromRecordId} -> ${link.toRecordId}`),
      ],
    };
  }

  if (action === "compact") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planCompaction(records, space.settings?.compaction);
    const shouldApply = parsed.flags.apply === "true";

    if (shouldApply) {
      const updates = applyCompactionPlan(plan);

      for (const record of updates) {
        await context.repository.writeRecord(record);
      }

      const events = createCompactionEvents(plan);
      for (const event of events) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createCompactionSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);

        for (const link of createCompactionSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Compaction applied." : "Compaction dry run.",
        ...summarizeCompactionPlan(plan),
      ],
    };
  }

  if (action === "retain") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const space = await requireSpace(context.repository, spaceId);
    const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
    const plan = planRetention(records, space.settings?.retentionDays);
    const shouldApply = parsed.flags.apply === "true";

    if (shouldApply) {
      const updates = applyRetentionPlan(plan);
      for (const record of updates) {
        await context.repository.writeRecord(record);
      }

      for (const event of createRetentionEvents(plan)) {
        await context.repository.appendEvent(event);
      }

      const summaryRecord = createRetentionSummaryRecord(plan);
      if (summaryRecord) {
        await context.repository.writeRecord(summaryRecord);
        for (const link of createRetentionSummaryLinks(summaryRecord, plan)) {
          await context.repository.linkRecords(link);
        }
      }
    }

    return {
      lines: [
        shouldApply ? "Retention applied." : "Retention dry run.",
        ...summarizeRetentionPlan(plan),
      ],
    };
  }

  return {
    lines: ["Unknown memory command.", usageText()],
  };
}

async function runEventCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const timestamp = new Date().toISOString();
    const event = {
      id: createId("evt"),
      spaceId: requireFlag(parsed.flags, "space-id"),
      scope: {
        id: requireFlag(parsed.flags, "scope-id"),
        type: requireScopeType(parsed.flags["scope-type"]),
      },
      actorType: requireActorType(parsed.flags["actor-type"]),
      actorId: requireFlag(parsed.flags, "actor-id"),
      type: requireEventType(parsed.flags["event-type"]),
      summary: requireFlag(parsed.flags, "summary"),
      payload: parsed.flags.payload ? parseJsonFlag(parsed.flags.payload) : undefined,
      createdAt: timestamp,
    };

    await context.repository.appendEvent(event);

    return {
      lines: [
        "Event added.",
        `id=${event.id}`,
        `type=${event.type}`,
      ],
    };
  }

  if (action === "list") {
    const spaceId = requireFlag(parsed.flags, "space-id");
    const events = await context.repository.listEvents(
      spaceId,
      parsed.flags.limit ? Number(parsed.flags.limit) : 10,
    );

    return {
      lines: [
        `events=${events.length}`,
        ...events.map(
          (event) =>
            `${event.id} ${event.type} ${event.actorType}:${event.actorId} ${truncate(event.summary, 80)}`,
        ),
      ],
    };
  }

  return {
    lines: ["Unknown event command.", usageText()],
  };
}

async function runLinkCommand(
  action: string,
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  if (action === "add") {
    const link: MemoryRecordLink = {
      id: createId("link"),
      spaceId: requireFlag(parsed.flags, "space-id"),
      fromRecordId: requireFlag(parsed.flags, "from-record-id"),
      toRecordId: requireFlag(parsed.flags, "to-record-id"),
      type: requireLinkType(parsed.flags.type),
      createdAt: new Date().toISOString(),
    };

    await context.repository.linkRecords(link);

    return {
      lines: ["Link added.", `id=${link.id}`, `type=${link.type}`],
    };
  }

  if (action === "list") {
    const recordId = parsed.flags["record-id"];
    const links = recordId
      ? await context.repository.listLinksForRecord(recordId)
      : await context.repository.listLinks(
          requireFlag(parsed.flags, "space-id"),
          parsed.flags.limit ? Number(parsed.flags.limit) : 10,
        );

    return {
      lines: [
        `links=${links.length}`,
        ...links.map((link) => `${link.id} ${link.type} ${link.fromRecordId} -> ${link.toRecordId}`),
      ],
    };
  }

  return {
    lines: ["Unknown link command.", usageText()],
  };
}

async function runExportCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const spaceId = requireFlag(parsed.flags, "space-id");
  const spaces = await context.repository.listSpaces();
  const space = spaces.find((entry) => entry.id === spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  const scopes = await context.repository.listScopes(spaceId);
  const events = await context.repository.listEvents(spaceId, Number.MAX_SAFE_INTEGER);
  const records = await context.repository.listRecords(spaceId, Number.MAX_SAFE_INTEGER);
  const links = await context.repository.listLinks(spaceId, Number.MAX_SAFE_INTEGER);

  const output = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      space,
      scopes,
      events,
      records,
      links,
    },
    null,
    2,
  );

  if (parsed.flags.output) {
    const outputPath = resolve(parsed.flags.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output, "utf8");

    return {
      lines: [
        "Export written.",
        `output=${outputPath}`,
      ],
    };
  }

  return {
    lines: output.split(/\r?\n/),
  };
}

async function runImportCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<CommandResult> {
  const inputPath = resolve(requireFlag(parsed.flags, "input"));
  const imported = JSON.parse(readTextFile(inputPath)) as SpaceExport;

  await context.repository.createSpace(imported.space);

  for (const scope of imported.scopes) {
    await context.repository.upsertScope(scope);
  }

  for (const event of imported.events) {
    await context.repository.appendEvent(event);
  }

  for (const record of imported.records) {
    await context.repository.writeRecord(record);
  }

  for (const link of imported.links ?? []) {
    await context.repository.linkRecords(link);
  }

  return {
    lines: [
      "Import completed.",
      `spaceId=${imported.space.id}`,
      `scopes=${imported.scopes.length}`,
      `events=${imported.events.length}`,
      `records=${imported.records.length}`,
      `links=${imported.links?.length ?? 0}`,
    ],
  };
}

function createMemoryInput(parsed: ParsedArgs): CreateMemoryRecordInput {
  return {
    spaceId: requireFlag(parsed.flags, "space-id"),
    tier: requireTier(parsed.flags.tier),
    kind: requireKind(parsed.flags.kind),
    content: requireFlag(parsed.flags, "content"),
    summary: parsed.flags.summary,
    scope: {
      id: requireFlag(parsed.flags, "scope-id"),
      type: requireScopeType(parsed.flags["scope-type"]),
    },
    visibility: parsed.flags.visibility
      ? requireVisibility(parsed.flags.visibility)
      : undefined,
    tags: parsed.flags.tags ? parsed.flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
    importance: parsed.flags.importance ? Number(parsed.flags.importance) : undefined,
    confidence: parsed.flags.confidence ? Number(parsed.flags.confidence) : undefined,
    freshness: parsed.flags.freshness ? Number(parsed.flags.freshness) : undefined,
  };
}

function requireFlag(flags: Record<string, string>, key: string): string {
  const value = flags[key];

  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }

  return value;
}

function requireScopeType(value: string | undefined): ScopeType {
  const allowed: ScopeType[] = [
    "memory_space",
    "orchestrator",
    "agent",
    "subagent",
    "session",
    "task",
    "project",
  ];

  if (!value || !allowed.includes(value as ScopeType)) {
    throw new Error(`Invalid scope type: ${value ?? "undefined"}`);
  }

  return value as ScopeType;
}

function requireTier(value: string | undefined): MemoryTier {
  const allowed: MemoryTier[] = ["short", "mid", "long"];

  if (!value || !allowed.includes(value as MemoryTier)) {
    throw new Error(`Invalid memory tier: ${value ?? "undefined"}`);
  }

  return value as MemoryTier;
}

function requireKind(value: string | undefined): MemoryKind {
  const allowed: MemoryKind[] = [
    "fact",
    "decision",
    "preference",
    "task",
    "summary",
    "blocker",
    "artifact",
    "attempt",
    "error",
  ];

  if (!value || !allowed.includes(value as MemoryKind)) {
    throw new Error(`Invalid memory kind: ${value ?? "undefined"}`);
  }

  return value as MemoryKind;
}

function requireVisibility(value: string | undefined): MemoryVisibility {
  const allowed: MemoryVisibility[] = ["private", "shared", "space"];

  if (!value || !allowed.includes(value as MemoryVisibility)) {
    throw new Error(`Invalid memory visibility: ${value ?? "undefined"}`);
  }

  return value as MemoryVisibility;
}

function requireStatus(value: string | undefined): RecordStatus {
  const allowed: RecordStatus[] = ["active", "archived", "superseded", "expired"];

  if (!value || !allowed.includes(value as RecordStatus)) {
    throw new Error(`Invalid memory status: ${value ?? "undefined"}`);
  }

  return value as RecordStatus;
}

function requireActorType(value: string | undefined): ActorType {
  const allowed: ActorType[] = ["user", "system", "orchestrator", "agent", "subagent", "tool"];

  if (!value || !allowed.includes(value as ActorType)) {
    throw new Error(`Invalid actor type: ${value ?? "undefined"}`);
  }

  return value as ActorType;
}

function requireEventType(value: string | undefined): EventType {
  const allowed: EventType[] = [
    "request_received",
    "decision_made",
    "task_started",
    "task_completed",
    "tool_called",
    "tool_succeeded",
    "tool_failed",
    "memory_written",
    "memory_promoted",
    "memory_archived",
    "memory_expired",
  ];

  if (!value || !allowed.includes(value as EventType)) {
    throw new Error(`Invalid event type: ${value ?? "undefined"}`);
  }

  return value as EventType;
}

function requireLinkType(value: string | undefined): MemoryRecordLink["type"] {
  const allowed: MemoryRecordLink["type"][] = [
    "derived_from",
    "supports",
    "contradicts",
    "supersedes",
    "references",
  ];

  if (!value || !allowed.includes(value as MemoryRecordLink["type"])) {
    throw new Error(`Invalid link type: ${value ?? "undefined"}`);
  }

  return value as MemoryRecordLink["type"];
}

function parseJsonFlag(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function parseSettingsFlag(value: string): MemorySpace["settings"] {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings must be a JSON object.");
  }

  return parsed as MemorySpace["settings"];
}

function parseCompactionFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const compactionEntries: Array<[keyof CompactionPolicy, number | undefined]> = [
    ["shortPromoteImportanceMin", parseOptionalNumber(flags["short-promote-importance-min"])],
    ["shortPromoteConfidenceMin", parseOptionalNumber(flags["short-promote-confidence-min"])],
    ["midPromoteImportanceMin", parseOptionalNumber(flags["mid-promote-importance-min"])],
    ["midPromoteConfidenceMin", parseOptionalNumber(flags["mid-promote-confidence-min"])],
    ["midPromoteFreshnessMin", parseOptionalNumber(flags["mid-promote-freshness-min"])],
    ["archiveImportanceMax", parseOptionalNumber(flags["archive-importance-max"])],
    ["archiveConfidenceMax", parseOptionalNumber(flags["archive-confidence-max"])],
    ["archiveFreshnessMax", parseOptionalNumber(flags["archive-freshness-max"])],
  ];

  const compaction = Object.fromEntries(
    compactionEntries.filter(([, value]) => value !== undefined),
  ) as Partial<CompactionPolicy>;

  if (Object.keys(compaction).length === 0) {
    return {};
  }

  return { compaction };
}

function parseRetentionFlags(flags: Record<string, string>): MemorySpace["settings"] {
  const retentionDays = {
    short: parseOptionalNumber(flags["retention-short-days"]),
    mid: parseOptionalNumber(flags["retention-mid-days"]),
    long: parseOptionalNumber(flags["retention-long-days"]),
  };

  const filtered = Object.fromEntries(
    Object.entries(retentionDays).filter(([, value]) => value !== undefined),
  ) as NonNullable<MemorySpace["settings"]>["retentionDays"];

  if (Object.keys(filtered as object).length === 0) {
    return {};
  }

  return { retentionDays: filtered };
}

function mergeSpaceSettings(
  existing: MemorySpace["settings"] | undefined,
  fromJson: MemorySpace["settings"] | undefined,
  fromFlags: MemorySpace["settings"] | undefined,
): MemorySpace["settings"] {
  return {
    ...(existing ?? {}),
    ...(fromJson ?? {}),
    ...(fromFlags ?? {}),
    retentionDays: {
      ...(existing?.retentionDays ?? {}),
      ...(fromJson?.retentionDays ?? {}),
      ...(fromFlags?.retentionDays ?? {}),
    },
    compaction: {
      ...(existing?.compaction ?? {}),
      ...(fromJson?.compaction ?? {}),
      ...(fromFlags?.compaction ?? {}),
    },
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return parsed;
}

async function requireRecord(
  repository: SqliteMemoryRepository,
  recordId: string,
): Promise<MemoryRecord> {
  const record = await repository.getRecord(recordId);

  if (!record) {
    throw new Error(`Unknown record: ${recordId}`);
  }

  return record;
}

async function requireSpace(
  repository: SqliteMemoryRepository,
  spaceId: string,
): Promise<MemorySpace> {
  const space = await repository.getSpace(spaceId);

  if (!space) {
    throw new Error(`Unknown space: ${spaceId}`);
  }

  return space;
}

function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}

interface SpaceExport {
  space: MemorySpace;
  scopes: ScopeRecord[];
  events: MemoryEvent[];
  records: MemoryRecord[];
  links?: MemoryRecordLink[];
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}

function formatCounts(values: Record<string, number>): string {
  const entries = Object.entries(values);

  if (entries.length === 0) {
    return "{}";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");
}

function mergeUpdatedRecords(
  existing: MemoryRecord[],
  updates: MemoryRecord[],
): MemoryRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));

  for (const update of updates) {
    byId.set(update.id, update);
  }

  return [...byId.values()];
}
