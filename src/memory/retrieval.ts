import { defaultRoutingPolicy, type RoutingPolicy } from "../core/config.js";
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
  | "provenance"
  | "superseded"
  | "expired"
  | "high_confidence";

export interface MemoryBundle {
  trace: RecallTrace;
  primary: MemoryBundleEntry;
  supporting: MemoryBundleEntry[];
  links: MemoryRecordLink[];
  hints: MemoryBundleHint[];
  route: MemoryBundleRoute;
}

export interface ReplyContextFormatOptions {
  includeTraceSummary?: boolean;
  includeCitationReasons?: boolean;
  includeRoute?: boolean;
  maxSupportingCitations?: number;
}

export type MemoryBundleHint =
  | "actionable_primary"
  | "contains_contested_memory"
  | "contains_stale_memory"
  | "contains_distilled_memory"
  | "contains_provenance_memory"
  | "contains_superseded_memory";

export type MemoryBundleProfile = "balanced" | "planner" | "executor" | "reviewer";
export type MemoryBundleConsumer = MemoryBundleProfile | "auto";

export interface MemoryBundleRoute {
  requestedConsumer: MemoryBundleConsumer;
  resolvedConsumer: MemoryBundleProfile;
  profileUsed: MemoryBundleProfile;
  source: "default" | "explicit" | "auto";
  emphasis: "general" | "planning" | "execution" | "review";
  reason: string;
  warnings: MemoryBundleHint[];
}

export interface BuildMemoryBundleOptions {
  queryText?: string;
  profile?: MemoryBundleProfile;
  consumer?: MemoryBundleConsumer;
  routingPolicy?: Partial<RoutingPolicy>;
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
  const routingPolicy = resolveRoutingPolicy(options.routingPolicy);
  const hints = buildBundleHints(pack.primary, pack.supporting, pack.links, routingPolicy);
  const route = resolveBundleRoute(pack.primary, pack.supporting, hints, options, routingPolicy);
  const resolved = resolveBundlePolicy(route.profileUsed, options);
  const supporting = rankSupportingForBundle(pack.supporting, route.profileUsed).slice(0, Math.max(resolved.maxSupporting, 0));
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
    primary: toBundleEntry(pack.primary, "primary", { ...resolved, routingPolicy }),
    supporting: supporting.map((record) => toBundleEntry(record, "supporting", { ...resolved, routingPolicy })),
    links: pack.links.filter((link) => relatedIds.has(link.fromRecordId) && relatedIds.has(link.toRecordId)),
    hints: buildBundleHints(pack.primary, supporting, pack.links),
    route,
  };
}

export function formatReplyContextBlock(
  bundle: MemoryBundle,
  options: ReplyContextFormatOptions = {},
): string {
  const includeTraceSummary = options.includeTraceSummary ?? true;
  const includeCitationReasons = options.includeCitationReasons ?? true;
  const includeRoute = options.includeRoute ?? true;
  const maxSupportingCitations = Math.max(options.maxSupportingCitations ?? 2, 0);

  const lines = ["[GlialNode Memory]"];

  if (includeRoute) {
    lines.push(`route=${bundle.route.resolvedConsumer}; why=${bundle.route.reason}`);
  }

  if (includeTraceSummary) {
    lines.push(`summary=${bundle.trace.summary}`);
  }

  lines.push(`primary=${bundle.primary.summary ?? bundle.primary.content}`);

  const supporting = bundle.supporting.slice(0, maxSupportingCitations);
  if (supporting.length > 0) {
    lines.push(
      `support=${supporting
        .map((entry) => entry.summary ?? entry.content)
        .join(" | ")}`,
    );
  }

  if (includeCitationReasons) {
    const citationReasons = bundle.trace.citations
      .slice(0, 1 + maxSupportingCitations)
      .map((citation) => `${citation.role}:${citation.reason}`);

    if (citationReasons.length > 0) {
      lines.push(`why=${citationReasons.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

export function formatReplyContextText(
  bundles: MemoryBundle[],
  options: ReplyContextFormatOptions = {},
): string {
  return bundles.map((bundle) => formatReplyContextBlock(bundle, options)).join("\n\n");
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

  if (isProvenanceRecord(record)) {
    reasons.push("captures bundle provenance audit memory");
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

  if (isProvenanceRecord(record)) {
    return "same-scope provenance audit context";
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
  options: Required<Pick<BuildMemoryBundleOptions, "maxContentChars" | "preferCompact">> & { routingPolicy?: Partial<RoutingPolicy> },
): MemoryBundleEntry {
  const routingPolicy = resolveRoutingPolicy(options.routingPolicy);
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
    annotations: buildEntryAnnotations(record, routingPolicy),
  };
}

function buildEntryAnnotations(record: MemoryRecord, routingPolicy: RoutingPolicy = defaultRoutingPolicy): MemoryBundleAnnotation[] {
  const annotations = new Set<MemoryBundleAnnotation>();
  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));

  if (record.kind === "decision" || record.kind === "task" || record.kind === "blocker") {
    annotations.add("actionable");
  }

  if (record.confidence >= 0.8) {
    annotations.add("high_confidence");
  }

  if (record.freshness <= routingPolicy.staleThreshold || record.confidence <= routingPolicy.staleThreshold) {
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

  if (isProvenanceRecord(record)) {
    annotations.add("provenance");
  }

  return [...annotations];
}

function buildBundleHints(
  primary: MemoryRecord,
  supporting: MemoryRecord[],
  links: MemoryRecordLink[],
  routingPolicy: RoutingPolicy = defaultRoutingPolicy,
): MemoryBundleHint[] {
  const hints = new Set<MemoryBundleHint>();
  const records = [primary, ...supporting];

  if (primary.kind === "decision" || primary.kind === "task" || primary.kind === "blocker") {
    hints.add("actionable_primary");
  }

  if (records.some((record) => record.tags.some((tag) => tag.toLowerCase() === "distilled"))) {
    hints.add("contains_distilled_memory");
  }

  if (records.some((record) => isProvenanceRecord(record))) {
    hints.add("contains_provenance_memory");
  }

  if (records.some((record) => record.status === "superseded") || links.some((link) => link.type === "contradicts")) {
    hints.add("contains_contested_memory");
  }

  if (records.some((record) => record.freshness <= routingPolicy.staleThreshold || record.confidence <= routingPolicy.staleThreshold || record.status === "expired")) {
    hints.add("contains_stale_memory");
  }

  if (records.some((record) => record.status === "superseded")) {
    hints.add("contains_superseded_memory");
  }

  return [...hints];
}

function resolveBundleRoute(
  primary: MemoryRecord,
  supporting: MemoryRecord[],
  hints: MemoryBundleHint[],
  options: BuildMemoryBundleOptions,
  routingPolicy: RoutingPolicy,
): MemoryBundleRoute {
  const requestedConsumer = options.consumer ?? (options.profile ?? "balanced");

  if (requestedConsumer !== "auto") {
    return {
      requestedConsumer,
      resolvedConsumer: requestedConsumer,
      profileUsed: options.profile ?? requestedConsumer,
      source: options.profile || options.consumer ? "explicit" : "default",
      emphasis: consumerEmphasis(requestedConsumer),
      reason: routeReasonForConsumer(requestedConsumer, hints),
      warnings: extractRouteWarnings(hints),
    };
  }

  const resolvedConsumer = autoResolveConsumer(primary, supporting, hints, routingPolicy);
  return {
    requestedConsumer,
    resolvedConsumer,
    profileUsed: options.profile ?? resolvedConsumer,
    source: "auto",
    emphasis: consumerEmphasis(resolvedConsumer),
    reason: autoRouteReason(primary, supporting, hints, resolvedConsumer),
    warnings: extractRouteWarnings(hints),
  };
}

function autoResolveConsumer(
  primary: MemoryRecord,
  supporting: MemoryRecord[],
  hints: MemoryBundleHint[],
  routingPolicy: RoutingPolicy = defaultRoutingPolicy,
): MemoryBundleProfile {
  if (
    (routingPolicy.preferReviewerOnContested && hints.includes("contains_contested_memory")) ||
    (routingPolicy.preferReviewerOnStale && hints.includes("contains_stale_memory")) ||
    (routingPolicy.preferReviewerOnProvenance && hints.includes("contains_provenance_memory"))
  ) {
    return "reviewer";
  }

  if (routingPolicy.preferExecutorOnActionable && (primary.kind === "decision" || primary.kind === "task" || primary.kind === "blocker")) {
    return "executor";
  }

  if (
    routingPolicy.preferPlannerOnDistilled && (
      hints.includes("contains_distilled_memory") ||
    [primary, ...supporting].some((record) => record.kind === "summary")
    )
  ) {
    return "planner";
  }

  return "balanced";
}

function consumerEmphasis(consumer: MemoryBundleProfile): MemoryBundleRoute["emphasis"] {
  if (consumer === "planner") {
    return "planning";
  }

  if (consumer === "executor") {
    return "execution";
  }

  if (consumer === "reviewer") {
    return "review";
  }

  return "general";
}

function routeReasonForConsumer(
  consumer: MemoryBundleProfile,
  hints: MemoryBundleHint[],
): string {
  if (consumer === "reviewer" && extractRouteWarnings(hints).length > 0) {
    return "Explicit reviewer routing keeps contested or stale memory visible.";
  }

  if (consumer === "executor") {
    return "Explicit executor routing prioritizes actionable handoff memory.";
  }

  if (consumer === "planner") {
    return "Explicit planner routing preserves broader context for planning.";
  }

  return "Using balanced routing for general downstream consumption.";
}

function autoRouteReason(
  primary: MemoryRecord,
  supporting: MemoryRecord[],
  hints: MemoryBundleHint[],
  consumer: MemoryBundleProfile,
): string {
  if (consumer === "reviewer") {
    if (hints.includes("contains_provenance_memory")) {
      return "Auto-routed to reviewer because the bundle includes provenance audit memory that should stay visible during review.";
    }

    return "Auto-routed to reviewer because the bundle contains stale or contested memory that should be checked before acting.";
  }

  if (consumer === "executor") {
    return "Auto-routed to executor because the primary memory is directly actionable.";
  }

  if (consumer === "planner") {
    return "Auto-routed to planner because distilled or summary memory is leading the handoff.";
  }

  const supportingCount = supporting.length;
  return supportingCount > 0
    ? "Auto-routed to balanced because the bundle mixes direct recall with light supporting context."
    : `Auto-routed to balanced because ${primary.kind} memory did not signal a stronger consumer intent.`;
}

function extractRouteWarnings(hints: MemoryBundleHint[]): MemoryBundleHint[] {
  return hints.filter((hint) =>
    hint === "contains_contested_memory" ||
    hint === "contains_stale_memory" ||
    hint === "contains_superseded_memory" ||
    hint === "contains_provenance_memory",
  );
}

function rankSupportingForBundle(
  supporting: MemoryRecord[],
  profile: MemoryBundleProfile,
): MemoryRecord[] {
  return [...supporting].sort(
    (left, right) => scoreSupportingForProfile(right, profile) - scoreSupportingForProfile(left, profile),
  );
}

function scoreSupportingForProfile(record: MemoryRecord, profile: MemoryBundleProfile): number {
  const annotations = new Set(buildEntryAnnotations(record));
  const baseScore = record.importance * 0.35 + record.confidence * 0.35 + record.freshness * 0.3;

  if (profile === "executor") {
    return baseScore +
      (annotations.has("actionable") ? 0.35 : 0) +
      (annotations.has("high_confidence") ? 0.18 : 0) +
      (annotations.has("stale") ? -0.25 : 0) +
      (annotations.has("contested") ? -0.2 : 0);
  }

  if (profile === "planner") {
    return baseScore +
      (annotations.has("distilled") ? 0.28 : 0) +
      (record.kind === "summary" ? 0.18 : 0) +
      (annotations.has("high_confidence") ? 0.12 : 0);
  }

  if (profile === "reviewer") {
    return baseScore +
      (annotations.has("contested") ? 0.3 : 0) +
      (annotations.has("stale") ? 0.24 : 0) +
      (annotations.has("superseded") ? 0.18 : 0) +
      (annotations.has("provenance") ? 0.14 : 0) +
      (annotations.has("distilled") ? 0.08 : 0);
  }

  return baseScore;
}

function resolveRoutingPolicy(policy: Partial<RoutingPolicy> | undefined): RoutingPolicy {
  return {
    ...defaultRoutingPolicy,
    ...(policy ?? {}),
  };
}

function isProvenanceRecord(record: MemoryRecord): boolean {
  const lowerTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return lowerTags.has("provenance") || (lowerTags.has("bundle") && lowerTags.has("audit"));
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
