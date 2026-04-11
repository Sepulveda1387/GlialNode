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
