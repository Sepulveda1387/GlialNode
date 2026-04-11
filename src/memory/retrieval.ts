import type { MemoryRecord } from "../core/types.js";

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
