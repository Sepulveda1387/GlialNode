import type { MemoryRecord, MemoryRecordLink } from "../core/types.js";

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
]);

function recencyWeight(timestamp: string, now: Date): number {
  const updatedTime = new Date(timestamp).getTime();
  const nowTime = now.getTime();
  const deltaHours = Math.max((nowTime - updatedTime) / (1000 * 60 * 60), 0);

  return 1 / (1 + deltaHours / 24);
}

export function scoreRecordForRetrieval(
  record: MemoryRecord,
  now: Date = new Date(),
  queryText?: string,
): number {
  const statusWeight =
    record.status === "active" ? 1 : record.status === "superseded" ? 0.45 : 0.2;
  const structuralScore =
    record.importance * 0.35 +
    record.confidence * 0.25 +
    record.freshness * 0.2 +
    recencyWeight(record.updatedAt, now) * 0.2;
  const queryScore = queryText ? scoreQueryAlignment(record, queryText) : 0;
  const distilledBonus = scoreDistilledPreference(record, queryText);
  const kindBonus = scoreKindPreference(record, queryText);

  return (structuralScore + queryScore + distilledBonus + kindBonus) * statusWeight;
}

export function rankRecordsForRetrieval(
  records: MemoryRecord[],
  queryText?: string,
  now: Date = new Date(),
): MemoryRecord[] {
  return [...records].sort(
    (left, right) =>
      scoreRecordForRetrieval(right, now, queryText) - scoreRecordForRetrieval(left, now, queryText),
  );
}

export interface RecallPack {
  primary: MemoryRecord;
  supporting: MemoryRecord[];
  links: MemoryRecordLink[];
}

export interface RecallCitation {
  recordId: string;
  role: "primary" | "supporting";
  relation?: MemoryRecordLink["type"];
  reason: string;
  excerpt: string;
}

export interface RecallTrace {
  queryText?: string;
  summary: string;
  citations: RecallCitation[];
}

export interface MemoryBundleEntry {
  recordId: string;
  role: "primary" | "supporting";
  tier: MemoryRecord["tier"];
  kind: MemoryRecord["kind"];
  status: MemoryRecord["status"];
  summary?: string;
  content: string;
  compactContent?: string;
  tags: string[];
  annotations: MemoryBundleAnnotation[];
}

export type MemoryBundleAnnotation =
  | "actionable"
  | "contested"
  | "stale"
  | "distilled"
  | "superseded"
  | "expired"
  | "high_confidence";

export interface MemoryBundle {
  trace: RecallTrace;
  primary: MemoryBundleEntry;
  supporting: MemoryBundleEntry[];
  links: MemoryRecordLink[];
  hints: MemoryBundleHint[];
}

export type MemoryBundleHint =
  | "actionable_primary"
  | "contains_contested_memory"
  | "contains_stale_memory"
  | "contains_distilled_memory"
  | "contains_superseded_memory";

export type MemoryBundleProfile = "balanced" | "planner" | "executor" | "reviewer";

export interface BuildMemoryBundleOptions {
  queryText?: string;
  profile?: MemoryBundleProfile;
  maxSupporting?: number;
  maxContentChars?: number;
  preferCompact?: boolean;
}

export interface BuildRecallPackOptions {
  queryText?: string;
  supportLimit?: number;
  includeSameScopeDistilled?: boolean;
}

export function buildRecallPack(
  primary: MemoryRecord,
  records: MemoryRecord[],
  links: MemoryRecordLink[],
  options: BuildRecallPackOptions = {},
): RecallPack {
  const supportLimit = options.supportLimit ?? 3;
  const allRecordsById = new Map(records.map((record) => [record.id, record]));
  const linkedRecordIds = new Set<string>();

  for (const link of links) {
    if (link.fromRecordId === primary.id && link.toRecordId !== primary.id) {
      linkedRecordIds.add(link.toRecordId);
    }

    if (link.toRecordId === primary.id && link.fromRecordId !== primary.id) {
      linkedRecordIds.add(link.fromRecordId);
    }
  }

  const linkedSupporting = [...linkedRecordIds]
    .map((recordId) => allRecordsById.get(recordId))
    .filter((record): record is MemoryRecord => record !== undefined)
    .filter((record) => record.status === "active" || record.status === "superseded");

  const sameScopeCandidates = records.filter((record) =>
    record.id !== primary.id &&
    !linkedRecordIds.has(record.id) &&
    record.scope.id === primary.scope.id &&
    record.scope.type === primary.scope.type &&
    record.status === "active" &&
    isContextuallyRelated(primary, record, options.queryText),
  );

  const additionalSupporting = options.includeSameScopeDistilled === false
    ? sameScopeCandidates.filter((record) => record.kind !== "summary")
    : sameScopeCandidates;

  const supporting = rankRecordsForRetrieval(
    [...linkedSupporting, ...additionalSupporting],
    options.queryText,
  ).slice(0, Math.max(supportLimit, 0));

  return {
    primary,
    supporting,
    links: links.filter((link) => {
      const relatedIds = new Set([primary.id, ...supporting.map((record) => record.id)]);
      return relatedIds.has(link.fromRecordId) && relatedIds.has(link.toRecordId);
    }),
  };
}

export function buildRecallTrace(pack: RecallPack, queryText?: string): RecallTrace {
  const citations: RecallCitation[] = [
    {
      recordId: pack.primary.id,
      role: "primary",
      reason: describePrimaryReason(pack.primary, queryText),
      excerpt: pack.primary.summary ?? pack.primary.content,
    },
    ...pack.supporting.map((record) => {
      const relation = findRelation(pack.primary.id, record.id, pack.links);
      return {
        recordId: record.id,
        role: "supporting" as const,
        relation,
        reason: describeSupportingReason(record, relation, queryText),
        excerpt: record.summary ?? record.content,
      };
    }),
  ];

  const primarySummary = pack.primary.summary ?? truncateText(pack.primary.content, 80);
  const supportCount = pack.supporting.length;

  return {
    queryText,
    summary:
      supportCount === 0
        ? `Recalled ${primarySummary} as the strongest direct match.`
        : `Recalled ${primarySummary} with ${supportCount} supporting memory item(s).`,
    citations,
  };
}

export function buildMemoryBundle(pack: RecallPack, options: BuildMemoryBundleOptions = {}): MemoryBundle {
  const resolved = resolveBundlePolicy(options.profile, options);
  const supporting = pack.supporting.slice(0, Math.max(resolved.maxSupporting, 0));
  const relatedIds = new Set([pack.primary.id, ...supporting.map((record) => record.id)]);

  return {
    trace: buildRecallTrace(
      {
        ...pack,
        supporting,
        links: pack.links.filter((link) => relatedIds.has(link.fromRecordId) && relatedIds.has(link.toRecordId)),
      },
      resolved.queryText,
    ),
    primary: toBundleEntry(pack.primary, "primary", resolved),
    supporting: supporting.map((record) => toBundleEntry(record, "supporting", resolved)),
    links: pack.links.filter((link) => relatedIds.has(link.fromRecordId) && relatedIds.has(link.toRecordId)),
    hints: buildBundleHints(pack.primary, supporting, pack.links),
  };
}

function isContextuallyRelated(primary: MemoryRecord, candidate: MemoryRecord, queryText?: string): boolean {
  const primaryTags = new Set(primary.tags.map((tag) => tag.toLowerCase()));
  const candidateTags = new Set(candidate.tags.map((tag) => tag.toLowerCase()));

  for (const tag of primaryTags) {
    if (candidateTags.has(tag)) {
      return true;
    }
  }

  const primaryTokens = new Set(tokenize([primary.summary ?? "", primary.content, primary.compactContent ?? ""].join(" ")));
  const candidateTokens = new Set(tokenize([candidate.summary ?? "", candidate.content, candidate.compactContent ?? ""].join(" ")));
  if (overlapRatio(primaryTokens, candidateTokens) >= 0.2) {
    return true;
  }

  if (!queryText) {
    return false;
  }

  const queryTokens = new Set(tokenize(queryText));
  return overlapRatio(queryTokens, candidateTokens) >= 0.2;
}

function describePrimaryReason(record: MemoryRecord, queryText?: string): string {
  const reasons: string[] = [];

  if (queryText && scoreQueryAlignment(record, queryText) > 0) {
    reasons.push("matched the query strongly");
  }

  if (record.tags.some((tag) => tag.toLowerCase() === "distilled")) {
    reasons.push("captures distilled memory for the scope");
  }

  if (record.kind === "decision" || record.kind === "preference") {
    reasons.push("carries a durable decision signal");
  }

  if (reasons.length === 0) {
    reasons.push("ranked highest by memory quality and recency");
  }

  return reasons.join("; ");
}

function describeSupportingReason(
  record: MemoryRecord,
  relation: MemoryRecordLink["type"] | undefined,
  queryText?: string,
): string {
  if (relation) {
    return `linked through ${relation}`;
  }

  if (record.tags.some((tag) => tag.toLowerCase() === "distilled")) {
    return "same-scope distilled context";
  }

  if (queryText && scoreQueryAlignment(record, queryText) > 0) {
    return "same-scope contextual match";
  }

  return "same-scope supporting context";
}

function findRelation(
  primaryId: string,
  relatedId: string,
  links: MemoryRecordLink[],
): MemoryRecordLink["type"] | undefined {
  return links.find(
    (link) =>
      (link.fromRecordId === primaryId && link.toRecordId === relatedId) ||
      (link.toRecordId === primaryId && link.fromRecordId === relatedId),
  )?.type;
}

function truncateText(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}

function toBundleEntry(
  record: MemoryRecord,
  role: "primary" | "supporting",
  options: Required<Pick<BuildMemoryBundleOptions, "maxContentChars" | "preferCompact">>,
): MemoryBundleEntry {
  const content = options.preferCompact && record.compactContent
    ? truncateText(record.compactContent, options.maxContentChars)
    : truncateText(record.content, options.maxContentChars);

  return {
    recordId: record.id,
    role,
    tier: record.tier,
    kind: record.kind,
    status: record.status,
    summary: record.summary,
    content,
    compactContent: record.compactContent,
    tags: record.tags,
    annotations: buildEntryAnnotations(record),
  };
}

function buildEntryAnnotations(record: MemoryRecord): MemoryBundleAnnotation[] {
  const annotations = new Set<MemoryBundleAnnotation>();
  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));

  if (record.kind === "decision" || record.kind === "task" || record.kind === "blocker") {
    annotations.add("actionable");
  }

  if (record.confidence >= 0.8) {
    annotations.add("high_confidence");
  }

  if (record.freshness <= 0.35 || record.confidence <= 0.35) {
    annotations.add("stale");
  }

  if (record.status === "superseded") {
    annotations.add("superseded");
    annotations.add("contested");
  }

  if (record.status === "expired") {
    annotations.add("expired");
    annotations.add("stale");
  }

  if (lowerTags.has("distilled")) {
    annotations.add("distilled");
  }

  return [...annotations];
}

function buildBundleHints(
  primary: MemoryRecord,
  supporting: MemoryRecord[],
  links: MemoryRecordLink[],
): MemoryBundleHint[] {
  const hints = new Set<MemoryBundleHint>();
  const records = [primary, ...supporting];

  if (primary.kind === "decision" || primary.kind === "task" || primary.kind === "blocker") {
    hints.add("actionable_primary");
  }

  if (records.some((record) => record.tags.some((tag) => tag.toLowerCase() === "distilled"))) {
    hints.add("contains_distilled_memory");
  }

  if (records.some((record) => record.status === "superseded") || links.some((link) => link.type === "contradicts")) {
    hints.add("contains_contested_memory");
  }

  if (records.some((record) => record.freshness <= 0.35 || record.confidence <= 0.35 || record.status === "expired")) {
    hints.add("contains_stale_memory");
  }

  if (records.some((record) => record.status === "superseded")) {
    hints.add("contains_superseded_memory");
  }

  return [...hints];
}

function resolveBundlePolicy(
  profile: MemoryBundleProfile | undefined,
  options: BuildMemoryBundleOptions,
): {
  queryText?: string;
  profile: MemoryBundleProfile;
  maxSupporting: number;
  maxContentChars: number;
  preferCompact: boolean;
} {
  const defaultsByProfile: Record<MemoryBundleProfile, Omit<Required<Pick<BuildMemoryBundleOptions, "profile" | "maxSupporting" | "maxContentChars" | "preferCompact">>, "profile">> = {
    balanced: {
      maxSupporting: 3,
      maxContentChars: 240,
      preferCompact: false,
    },
    planner: {
      maxSupporting: 4,
      maxContentChars: 320,
      preferCompact: false,
    },
    executor: {
      maxSupporting: 2,
      maxContentChars: 160,
      preferCompact: true,
    },
    reviewer: {
      maxSupporting: 5,
      maxContentChars: 420,
      preferCompact: false,
    },
  };

  const resolvedProfile = profile ?? "balanced";
  const base = defaultsByProfile[resolvedProfile];

  return {
    queryText: options.queryText,
    profile: resolvedProfile,
    maxSupporting: options.maxSupporting ?? base.maxSupporting,
    maxContentChars: options.maxContentChars ?? base.maxContentChars,
    preferCompact: options.preferCompact ?? base.preferCompact,
  };
}

function scoreQueryAlignment(record: MemoryRecord, queryText: string): number {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) {
    return 0;
  }

  const summaryTokens = new Set(tokenize(record.summary ?? ""));
  const contentTokens = new Set(tokenize(record.content));
  const compactTokens = new Set(tokenize(record.compactContent ?? ""));
  const tagTokens = new Set(record.tags.flatMap((tag) => tokenize(tag)));
  const querySet = new Set(queryTokens);

  const summaryOverlap = overlapRatio(querySet, summaryTokens);
  const contentOverlap = overlapRatio(querySet, contentTokens);
  const compactOverlap = overlapRatio(querySet, compactTokens);
  const tagOverlap = overlapRatio(querySet, tagTokens);

  return (
    summaryOverlap * 0.45 +
    contentOverlap * 0.25 +
    compactOverlap * 0.2 +
    tagOverlap * 0.1
  );
}

function scoreDistilledPreference(record: MemoryRecord, queryText?: string): number {
  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  const isDistilled = lowerTags.has("distilled");

  if (!isDistilled) {
    return 0;
  }

  let bonus = 0.08;

  if (record.tier === "long") {
    bonus += 0.07;
  }

  if (record.kind === "summary") {
    bonus += 0.05;
  }

  if (queryText && (record.summary ?? "").toLowerCase().includes("distilled")) {
    bonus += 0.03;
  }

  return bonus;
}

function scoreKindPreference(record: MemoryRecord, queryText?: string): number {
  if (!queryText) {
    return 0;
  }

  const lowered = queryText.toLowerCase();

  if (/\b(decision|prefer|preference|policy)\b/.test(lowered)) {
    return record.kind === "decision" || record.kind === "preference" ? 0.08 : 0;
  }

  if (/\b(summary|distill|overview)\b/.test(lowered)) {
    return record.kind === "summary" ? 0.08 : 0;
  }

  if (/\b(fact|truth|constraint)\b/.test(lowered)) {
    return record.kind === "fact" ? 0.08 : 0;
  }

  return 0;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token));
}

function overlapRatio(queryTokens: Set<string>, targetTokens: Set<string>): number {
  if (queryTokens.size === 0 || targetTokens.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.size;
}
