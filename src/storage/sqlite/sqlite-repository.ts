import { DatabaseSync } from "node:sqlite";

import type {
  MemoryEvent,
  MemoryRecord,
  MemoryRecordLink,
  MemorySearchQuery,
  MemorySpace,
  ScopeRecord,
} from "../../core/types.js";
import { rankRecordsForRetrieval } from "../../memory/retrieval.js";
import type { MemoryRepository, SpaceReport } from "../repository.js";
import {
  applySqliteConnectionPolicy,
  createSqliteDatabaseOptions,
  type SqliteConnectionPolicy,
  type SqliteRuntimeSettings,
} from "./connection.js";
import { applySqliteMigrations, getSqliteSchemaVersion } from "./migrations.js";

export interface SqliteRepositoryOptions {
  filename?: string;
  bootstrap?: boolean;
  connection?: Partial<SqliteConnectionPolicy>;
}

interface ScopeRow {
  id: string;
  space_id: string;
  type: ScopeRecord["type"];
}

interface MemoryRecordRow {
  id: string;
  space_id: string;
  tier: MemoryRecord["tier"];
  kind: MemoryRecord["kind"];
  content: string;
  summary: string | null;
  compact_content: string | null;
  compact_source: MemoryRecord["compactSource"] | null;
  scope_id: string;
  scope_type: ScopeRecord["type"];
  visibility: MemoryRecord["visibility"];
  status: MemoryRecord["status"];
  tags_json: string;
  importance: number;
  confidence: number;
  freshness: number;
  source_event_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface MemoryEventRow {
  id: string;
  space_id: string;
  scope_id: string;
  scope_type: ScopeRecord["type"];
  actor_type: MemoryEvent["actorType"];
  actor_id: string;
  event_type: MemoryEvent["type"];
  summary: string;
  payload_json: string | null;
  created_at: string;
}

interface MemoryRecordLinkRow {
  id: string;
  space_id: string;
  from_record_id: string;
  to_record_id: string;
  relation_type: MemoryRecordLink["type"];
  created_at: string;
}

export class SqliteMemoryRepository implements MemoryRepository {
  readonly db: DatabaseSync;
  readonly runtimeSettings: SqliteRuntimeSettings;
  private schemaVersion: number;

  constructor(options: SqliteRepositoryOptions = {}) {
    this.db = new DatabaseSync(
      options.filename ?? ":memory:",
      createSqliteDatabaseOptions(options.connection),
    );
    this.runtimeSettings = applySqliteConnectionPolicy(this.db, options.connection);
    this.schemaVersion = getSqliteSchemaVersion(this.db);

    if (options.bootstrap ?? true) {
      this.bootstrap();
    }
  }

  bootstrap(): void {
    this.schemaVersion = applySqliteMigrations(this.db);
  }

  async createSpace(space: MemorySpace): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO memory_spaces (id, name, description, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        space.id,
        space.name,
        space.description ?? null,
        serializeJson(space.settings),
        space.createdAt,
        space.updatedAt,
      );
  }

  async upsertScope(scope: ScopeRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO scopes (id, space_id, type, external_id, label, parent_scope_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          external_id = excluded.external_id,
          label = excluded.label,
          parent_scope_id = excluded.parent_scope_id,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        scope.id,
        scope.spaceId,
        scope.type,
        scope.externalId ?? null,
        scope.label ?? null,
        scope.parentScopeId ?? null,
        scope.createdAt,
        scope.updatedAt,
      );
  }

  async appendEvent(event: MemoryEvent): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO memory_events (
          id, space_id, scope_id, actor_type, actor_id, event_type, summary, payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        event.spaceId,
        event.scope.id,
        event.actorType,
        event.actorId,
        event.type,
        event.summary,
        serializeJson(event.payload),
        event.createdAt,
      );
  }

  async listEvents(spaceId: string, limit = 50): Promise<MemoryEvent[]> {
    const rows = this.db
      .prepare(
        `
        SELECT
          me.id,
          me.space_id,
          me.scope_id,
          s.type AS scope_type,
          me.actor_type,
          me.actor_id,
          me.event_type,
          me.summary,
          me.payload_json,
          me.created_at
        FROM memory_events me
        INNER JOIN scopes s ON s.id = me.scope_id
        WHERE me.space_id = ?
        ORDER BY me.created_at DESC
        LIMIT ?
        `,
      )
      .all(spaceId, limit) as unknown as MemoryEventRow[];

    return rows.map(mapMemoryEventRow);
  }

  async writeRecord(record: MemoryRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO memory_records (
          id, space_id, scope_id, tier, kind, content, summary, compact_content, compact_source, visibility, status, tags_json,
          importance, confidence, freshness, source_event_id, expires_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tier = excluded.tier,
          kind = excluded.kind,
          content = excluded.content,
          summary = excluded.summary,
          compact_content = excluded.compact_content,
          compact_source = excluded.compact_source,
          visibility = excluded.visibility,
          status = excluded.status,
          tags_json = excluded.tags_json,
          importance = excluded.importance,
          confidence = excluded.confidence,
          freshness = excluded.freshness,
          source_event_id = excluded.source_event_id,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        record.id,
        record.spaceId,
        record.scope.id,
        record.tier,
        record.kind,
        record.content,
        record.summary ?? null,
        record.compactContent ?? null,
        record.compactSource ?? "generated",
        record.visibility,
        record.status,
        JSON.stringify(record.tags),
        record.importance,
        record.confidence,
        record.freshness,
        record.sourceEventId ?? null,
        record.expiresAt ?? null,
        record.createdAt,
        record.updatedAt,
      );
  }

  async linkRecords(link: MemoryRecordLink): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO memory_record_links (id, space_id, from_record_id, to_record_id, relation_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          relation_type = excluded.relation_type,
          created_at = excluded.created_at
        `,
      )
      .run(
        link.id,
        link.spaceId,
        link.fromRecordId,
        link.toRecordId,
        link.type,
        link.createdAt,
      );
  }

  async listLinks(spaceId: string, limit = 50): Promise<MemoryRecordLink[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, space_id, from_record_id, to_record_id, relation_type, created_at
        FROM memory_record_links
        WHERE space_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        `,
      )
      .all(spaceId, limit) as unknown as MemoryRecordLinkRow[];

    return rows.map(mapMemoryRecordLinkRow);
  }

  async listLinksForRecord(recordId: string): Promise<MemoryRecordLink[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, space_id, from_record_id, to_record_id, relation_type, created_at
        FROM memory_record_links
        WHERE from_record_id = ? OR to_record_id = ?
        ORDER BY created_at DESC
        `,
      )
      .all(recordId, recordId) as unknown as MemoryRecordLinkRow[];

    return rows.map(mapMemoryRecordLinkRow);
  }

  async listRecords(spaceId: string, limit = 50): Promise<MemoryRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT
          mr.id,
          mr.space_id,
          mr.tier,
          mr.kind,
          mr.content,
          mr.summary,
          mr.compact_content,
          mr.compact_source,
          mr.visibility,
          mr.status,
          mr.tags_json,
          mr.importance,
          mr.confidence,
          mr.freshness,
          mr.source_event_id,
          mr.created_at,
          mr.updated_at,
          mr.expires_at,
          mr.scope_id,
          s.type AS scope_type
        FROM memory_records mr
        INNER JOIN scopes s ON s.id = mr.scope_id
        WHERE mr.space_id = ?
        ORDER BY mr.updated_at DESC
        LIMIT ?
        `,
      )
      .all(spaceId, limit) as unknown as MemoryRecordRow[];

    return rows.map(mapMemoryRecordRow);
  }

  async getRecord(recordId: string): Promise<MemoryRecord | null> {
    const row = this.db
      .prepare(
        `
        SELECT
          mr.id,
          mr.space_id,
          mr.tier,
          mr.kind,
          mr.content,
          mr.summary,
          mr.compact_content,
          mr.compact_source,
          mr.visibility,
          mr.status,
          mr.tags_json,
          mr.importance,
          mr.confidence,
          mr.freshness,
          mr.source_event_id,
          mr.created_at,
          mr.updated_at,
          mr.expires_at,
          mr.scope_id,
          s.type AS scope_type
        FROM memory_records mr
        INNER JOIN scopes s ON s.id = mr.scope_id
        WHERE mr.id = ?
        LIMIT 1
        `,
      )
      .get(recordId) as unknown as MemoryRecordRow | undefined;

    return row ? mapMemoryRecordRow(row) : null;
  }

  async searchRecords(query: MemorySearchQuery): Promise<MemoryRecord[]> {
    const clauses: string[] = ["mr.space_id = ?"];
    const params: Array<string | number> = [query.spaceId];
    const statuses = query.statuses?.length ? query.statuses : ["active"];

    if (query.scopeIds?.length) {
      clauses.push(`mr.scope_id IN (${placeholders(query.scopeIds.length)})`);
      params.push(...query.scopeIds);
    }

    if (query.tiers?.length) {
      clauses.push(`mr.tier IN (${placeholders(query.tiers.length)})`);
      params.push(...query.tiers);
    }

    if (query.kinds?.length) {
      clauses.push(`mr.kind IN (${placeholders(query.kinds.length)})`);
      params.push(...query.kinds);
    }

    if (query.visibility?.length) {
      clauses.push(`mr.visibility IN (${placeholders(query.visibility.length)})`);
      params.push(...query.visibility);
    }

    clauses.push(`mr.status IN (${placeholders(statuses.length)})`);
    params.push(...statuses);

    let sql = `
      SELECT
        mr.id,
        mr.space_id,
        mr.tier,
        mr.kind,
        mr.content,
        mr.summary,
        mr.compact_content,
        mr.compact_source,
        mr.visibility,
        mr.status,
        mr.tags_json,
        mr.importance,
        mr.confidence,
        mr.freshness,
        mr.source_event_id,
        mr.created_at,
        mr.updated_at,
        mr.expires_at,
        mr.scope_id,
        s.type AS scope_type
      FROM memory_records mr
      INNER JOIN scopes s ON s.id = mr.scope_id
    `;

    if (query.text?.trim()) {
      sql += `
        INNER JOIN memory_records_fts fts ON fts.record_id = mr.id
      `;
      clauses.push("memory_records_fts MATCH ?");
      params.push(query.text.trim());
    }

    sql += `
      WHERE ${clauses.join(" AND ")}
      LIMIT ?
    `;

    params.push(query.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as unknown as MemoryRecordRow[];
    return rankRecordsForRetrieval(rows.map(mapMemoryRecordRow));
  }

  async getSpaceReport(spaceId: string, recentEventLimit = 10): Promise<SpaceReport> {
    const recordCount = getCount(
      this.db.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE space_id = ?").get(spaceId),
    );
    const eventCount = getCount(
      this.db.prepare("SELECT COUNT(*) AS count FROM memory_events WHERE space_id = ?").get(spaceId),
    );
    const linkCount = getCount(
      this.db.prepare("SELECT COUNT(*) AS count FROM memory_record_links WHERE space_id = ?").get(spaceId),
    );

    const recordsByTier = mapCountRows(
      this.db
        .prepare(
          `
          SELECT tier AS label, COUNT(*) AS count
          FROM memory_records
          WHERE space_id = ?
          GROUP BY tier
          `,
        )
        .all(spaceId) as Array<{ label: string; count: number }>,
    );

    const recordsByStatus = mapCountRows(
      this.db
        .prepare(
          `
          SELECT status AS label, COUNT(*) AS count
          FROM memory_records
          WHERE space_id = ?
          GROUP BY status
          `,
        )
        .all(spaceId) as Array<{ label: string; count: number }>,
    );

    const recordsByKind = mapCountRows(
      this.db
        .prepare(
          `
          SELECT kind AS label, COUNT(*) AS count
          FROM memory_records
          WHERE space_id = ?
          GROUP BY kind
          `,
        )
        .all(spaceId) as Array<{ label: string; count: number }>,
    );

    const recentLifecycleEvents = await this.listEventsByType(
      spaceId,
      ["memory_promoted", "memory_archived", "memory_expired", "memory_superseded"],
      recentEventLimit,
    );

    return {
      spaceId,
      recordCount,
      eventCount,
      linkCount,
      recordsByTier,
      recordsByStatus,
      recordsByKind,
      recentLifecycleEvents,
    };
  }

  async listSpaces(): Promise<MemorySpace[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, name, description, settings_json, created_at, updated_at
        FROM memory_spaces
        ORDER BY updated_at DESC
        `,
      )
      .all() as Array<{
      id: string;
      name: string;
      description: string | null;
      settings_json: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      settings: parseJson(row.settings_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getSpace(spaceId: string): Promise<MemorySpace | null> {
    const row = this.db
      .prepare(
        `
        SELECT id, name, description, settings_json, created_at, updated_at
        FROM memory_spaces
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(spaceId) as
      | {
          id: string;
          name: string;
          description: string | null;
          settings_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      settings: parseJson(row.settings_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listScopes(spaceId: string): Promise<ScopeRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, space_id, type, external_id, label, parent_scope_id, created_at, updated_at
        FROM scopes
        WHERE space_id = ?
        ORDER BY updated_at DESC
        `,
      )
      .all(spaceId) as Array<{
      id: string;
      space_id: string;
      type: ScopeRecord["type"];
      external_id: string | null;
      label: string | null;
      parent_scope_id: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      spaceId: row.space_id,
      type: row.type,
      externalId: row.external_id ?? undefined,
      label: row.label ?? undefined,
      parentScopeId: row.parent_scope_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  close(): void {
    this.db.close();
  }

  getRuntimeSettings(): SqliteRuntimeSettings {
    return this.runtimeSettings;
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  private async listEventsByType(
    spaceId: string,
    eventTypes: MemoryEvent["type"][],
    limit: number,
  ): Promise<MemoryEvent[]> {
    const rows = this.db
      .prepare(
        `
        SELECT
          me.id,
          me.space_id,
          me.scope_id,
          s.type AS scope_type,
          me.actor_type,
          me.actor_id,
          me.event_type,
          me.summary,
          me.payload_json,
          me.created_at
        FROM memory_events me
        INNER JOIN scopes s ON s.id = me.scope_id
        WHERE me.space_id = ?
          AND me.event_type IN (${placeholders(eventTypes.length)})
        ORDER BY me.created_at DESC
        LIMIT ?
        `,
      )
      .all(spaceId, ...eventTypes, limit) as unknown as MemoryEventRow[];

    return rows.map(mapMemoryEventRow);
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function getCount(row: unknown): number {
  return Number((row as { count: number }).count ?? 0);
}

function mapCountRows(rows: Array<{ label: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.label, row.count]));
}

function serializeJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined {
  return value ? (JSON.parse(value) as T) : undefined;
}

function mapMemoryRecordRow(row: MemoryRecordRow): MemoryRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    tier: row.tier,
    kind: row.kind,
    content: row.content,
    summary: row.summary ?? undefined,
    compactContent: row.compact_content ?? undefined,
    compactSource: row.compact_source ?? undefined,
    scope: {
      id: row.scope_id,
      type: row.scope_type,
    },
    visibility: row.visibility,
    status: row.status,
    tags: parseJson<string[]>(row.tags_json) ?? [],
    importance: row.importance,
    confidence: row.confidence,
    freshness: row.freshness,
    sourceEventId: row.source_event_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function mapMemoryEventRow(row: MemoryEventRow): MemoryEvent {
  return {
    id: row.id,
    spaceId: row.space_id,
    scope: {
      id: row.scope_id,
      type: row.scope_type,
    },
    actorType: row.actor_type,
    actorId: row.actor_id,
    type: row.event_type,
    summary: row.summary,
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: row.created_at,
  };
}

function mapMemoryRecordLinkRow(row: MemoryRecordLinkRow): MemoryRecordLink {
  return {
    id: row.id,
    spaceId: row.space_id,
    fromRecordId: row.from_record_id,
    toRecordId: row.to_record_id,
    type: row.relation_type,
    createdAt: row.created_at,
  };
}
