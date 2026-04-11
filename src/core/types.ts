export type MemoryTier = "short" | "mid" | "long";

export type ScopeType =
  | "memory_space"
  | "orchestrator"
  | "agent"
  | "subagent"
  | "session"
  | "task"
  | "project";

export type MemoryKind =
  | "fact"
  | "decision"
  | "preference"
  | "task"
  | "summary"
  | "blocker"
  | "artifact"
  | "attempt"
  | "error";

export type MemoryVisibility = "private" | "shared" | "space";

export type RecordStatus = "active" | "archived" | "superseded" | "expired";

export type ActorType =
  | "user"
  | "system"
  | "orchestrator"
  | "agent"
  | "subagent"
  | "tool";

export type EventType =
  | "request_received"
  | "decision_made"
  | "task_started"
  | "task_completed"
  | "tool_called"
  | "tool_succeeded"
  | "tool_failed"
  | "memory_written"
  | "memory_promoted"
  | "memory_archived"
  | "memory_expired";

export type MemoryLinkType =
  | "derived_from"
  | "supports"
  | "contradicts"
  | "supersedes"
  | "references";

export interface MemoryScope {
  type: ScopeType;
  id: string;
}

export interface MemorySpaceSettings {
  retentionDays?: Partial<Record<MemoryTier, number>>;
  maxShortTermRecords?: number;
  compaction?: {
    shortPromoteImportanceMin?: number;
    shortPromoteConfidenceMin?: number;
    midPromoteImportanceMin?: number;
    midPromoteConfidenceMin?: number;
    midPromoteFreshnessMin?: number;
    archiveImportanceMax?: number;
    archiveConfidenceMax?: number;
    archiveFreshnessMax?: number;
  };
}

export interface MemorySpace {
  id: string;
  name: string;
  description?: string;
  settings?: MemorySpaceSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeRecord extends MemoryScope {
  spaceId: string;
  externalId?: string;
  label?: string;
  parentScopeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  spaceId: string;
  tier: MemoryTier;
  kind: MemoryKind;
  content: string;
  summary?: string;
  compactContent?: string;
  scope: MemoryScope;
  visibility: MemoryVisibility;
  status: RecordStatus;
  tags: string[];
  importance: number;
  confidence: number;
  freshness: number;
  sourceEventId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemoryEvent {
  id: string;
  spaceId: string;
  scope: MemoryScope;
  actorType: ActorType;
  actorId: string;
  type: EventType;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryRecordLink {
  id: string;
  spaceId: string;
  fromRecordId: string;
  toRecordId: string;
  type: MemoryLinkType;
  createdAt: string;
}

export interface CreateMemoryRecordInput {
  spaceId: string;
  tier: MemoryTier;
  kind: MemoryKind;
  content: string;
  summary?: string;
  compactContent?: string;
  scope: MemoryScope;
  visibility?: MemoryVisibility;
  status?: RecordStatus;
  tags?: string[];
  importance?: number;
  confidence?: number;
  freshness?: number;
  sourceEventId?: string;
  expiresAt?: string;
}

export interface MemorySearchQuery {
  text?: string;
  spaceId: string;
  scopeIds?: string[];
  tiers?: MemoryTier[];
  kinds?: MemoryKind[];
  visibility?: MemoryVisibility[];
  statuses?: RecordStatus[];
  limit?: number;
}
