import type {
  CompactContentSource,
  CreateMemoryRecordInput,
  MemoryRecord,
  MemoryScope,
} from "../core/types.js";

const kindCodes: Record<MemoryRecord["kind"], string> = {
  fact: "fct",
  decision: "dec",
  preference: "prf",
  task: "tsk",
  summary: "sum",
  blocker: "blk",
  artifact: "art",
  attempt: "att",
  error: "err",
};

const tierCodes: Record<MemoryRecord["tier"], string> = {
  short: "s",
  mid: "m",
  long: "l",
};

const scopeCodes: Record<MemoryScope["type"], string> = {
  memory_space: "ms",
  orchestrator: "orc",
  agent: "agt",
  subagent: "sub",
  session: "ses",
  task: "tsk",
  project: "prj",
};

const statusCodes: Record<MemoryRecord["status"], string> = {
  active: "act",
  archived: "arc",
  superseded: "sup",
  expired: "exp",
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

export function buildCompactMemoryText(input: Pick<
  CreateMemoryRecordInput,
  "tier" | "kind" | "content" | "summary" | "scope" | "tags" | "importance" | "confidence" | "freshness" | "status"
>): string {
  const summaryTokens = summarizeTokens(input.summary ?? input.content, 8);
  const contentTokens = summarizeTokens(input.content, 12);
  const tags = sanitizeTags(input.tags ?? []);

  const parts = [
    `tr=${tierCodes[input.tier]}`,
    `k=${kindCodes[input.kind]}`,
    `sc=${scopeCodes[input.scope.type]}:${normalizeId(input.scope.id)}`,
    `st=${statusCodes[input.status ?? "active"]}`,
  ];

  if (summaryTokens.length > 0) {
    parts.push(`sm=${summaryTokens.join("_")}`);
  }

  if (contentTokens.length > 0) {
    parts.push(`ct=${contentTokens.join("_")}`);
  }

  if (tags.length > 0) {
    parts.push(`tg=${tags.join(",")}`);
  }

  if (input.importance !== undefined) {
    parts.push(`im=${formatScore(input.importance)}`);
  }

  if (input.confidence !== undefined) {
    parts.push(`cf=${formatScore(input.confidence)}`);
  }

  if (input.freshness !== undefined) {
    parts.push(`fr=${formatScore(input.freshness)}`);
  }

  return parts.join(";");
}

export function ensureCompactMemoryText(record: CreateMemoryRecordInput): string {
  const compactContent = record.compactContent?.trim();
  if (compactContent) {
    return compactContent;
  }

  return buildCompactMemoryText(record);
}

export function resolveCompactContentSource(
  input: Pick<CreateMemoryRecordInput, "compactContent" | "compactSource">,
): CompactContentSource {
  if (input.compactSource) {
    return input.compactSource;
  }

  return input.compactContent?.trim() ? "manual" : "generated";
}

export function refreshCompactMemoryRecord(record: MemoryRecord, updateTimestamp = true): MemoryRecord {
  if (record.compactSource === "manual") {
    return record;
  }

  const nextCompactContent = buildCompactMemoryText({
    tier: record.tier,
    kind: record.kind,
    content: record.content,
    summary: record.summary,
    scope: record.scope,
    tags: record.tags,
    importance: record.importance,
    confidence: record.confidence,
    freshness: record.freshness,
    status: record.status,
  });

  if (nextCompactContent === record.compactContent && record.compactSource === "generated") {
    return record;
  }

  return {
    ...record,
    compactContent: nextCompactContent,
    compactSource: "generated",
    updatedAt: updateTimestamp ? new Date().toISOString() : record.updatedAt,
  };
}

export function shouldRefreshCompactMemory(record: MemoryRecord): boolean {
  if (record.compactSource === "manual") {
    return false;
  }

  const expected = buildCompactMemoryText({
    tier: record.tier,
    kind: record.kind,
    content: record.content,
    summary: record.summary,
    scope: record.scope,
    tags: record.tags,
    importance: record.importance,
    confidence: record.confidence,
    freshness: record.freshness,
    status: record.status,
  });

  return expected !== (record.compactContent ?? "");
}

function summarizeTokens(text: string, limit: number): string[] {
  const tokens = tokenize(text);
  const unique: string[] = [];

  for (const token of tokens) {
    if (!unique.includes(token)) {
      unique.push(token);
    }

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !stopWords.has(token));
}

function sanitizeTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
