import type { MemoryEvent, MemorySpace } from "../core/types.js";
import type { SpaceReport } from "../storage/repository.js";
import { DASHBOARD_SNAPSHOT_SCHEMA_VERSION } from "./schema.js";

export interface DashboardTrustedSignerInput {
  readonly name: string;
  readonly signer?: string;
  readonly keyId: string;
  readonly source?: string;
  readonly revokedAt?: string;
  readonly replacedBy?: string;
}

export interface DashboardTrustPolicyPackInput {
  readonly name: string;
  readonly baseProfile?: string;
  readonly updatedAt: string;
}

export interface DashboardTrustSpaceInput {
  readonly space: MemorySpace;
  readonly report: SpaceReport;
}

export interface BuildDashboardTrustReportInput {
  readonly generatedAt?: string;
  readonly spaces: readonly DashboardTrustSpaceInput[];
  readonly trustedSigners: readonly DashboardTrustedSignerInput[];
  readonly trustPolicyPacks: readonly DashboardTrustPolicyPackInput[];
  readonly recentEventLimit?: number;
}

export interface DashboardTrustReport {
  readonly schemaVersion: typeof DASHBOARD_SNAPSHOT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly totals: {
    readonly spaces: number;
    readonly spacesWithTrustProfile: number;
    readonly spacesNeedingTrustReview: number;
    readonly provenanceEvents: number;
    readonly provenanceSummaryRecords: number;
    readonly trustedSigners: number;
    readonly activeTrustedSigners: number;
    readonly revokedTrustedSigners: number;
    readonly rotatedTrustedSigners: number;
    readonly trustPolicyPacks: number;
    readonly policyFailureEvents: number;
  };
  readonly signerPosture: {
    readonly active: readonly DashboardTrustedSignerPosture[];
    readonly revoked: readonly DashboardTrustedSignerPosture[];
  };
  readonly spaces: readonly DashboardTrustSpacePosture[];
  readonly recentTrustEvents: readonly DashboardTrustEventSummary[];
  readonly notes: readonly string[];
}

export interface DashboardTrustedSignerPosture {
  readonly name: string;
  readonly signer?: string;
  readonly keyId: string;
  readonly source?: string;
  readonly status: "active" | "revoked";
  readonly revokedAt?: string;
  readonly replacedBy?: string;
}

export interface DashboardTrustSpacePosture {
  readonly spaceId: string;
  readonly name: string;
  readonly trustProfile: "unset" | "permissive" | "signed" | "anchored";
  readonly trustedSignerCount: number;
  readonly allowedOriginCount: number;
  readonly allowedSignerCount: number;
  readonly allowedSignerKeyIdCount: number;
  readonly provenanceEvents: number;
  readonly provenanceSummaryRecords: number;
  readonly policyFailureEvents: number;
  readonly needsTrustReview: boolean;
}

export interface DashboardTrustEventSummary {
  readonly eventId: string;
  readonly spaceId: string;
  readonly type: MemoryEvent["type"];
  readonly createdAt: string;
  readonly trustProfile?: string;
  readonly trusted?: boolean;
  readonly signer?: string;
  readonly origin?: string;
  readonly matchedTrustedSignerNames: readonly string[];
  readonly warningCount: number;
}

export function buildDashboardTrustReport(input: BuildDashboardTrustReportInput): DashboardTrustReport {
  const signerPosture = buildSignerPosture(input.trustedSigners);
  const spaces = input.spaces.map(({ space, report }) => buildSpacePosture(space, report));
  const recentTrustEvents = input.spaces
    .flatMap(({ report }) => report.recentProvenanceEvents.map((event) => summarizeTrustEvent(event)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, input.recentEventLimit ?? 20));

  return {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals: {
      spaces: spaces.length,
      spacesWithTrustProfile: spaces.filter((space) => space.trustProfile !== "unset").length,
      spacesNeedingTrustReview: spaces.filter((space) => space.needsTrustReview).length,
      provenanceEvents: spaces.reduce((total, space) => total + space.provenanceEvents, 0),
      provenanceSummaryRecords: spaces.reduce((total, space) => total + space.provenanceSummaryRecords, 0),
      trustedSigners: input.trustedSigners.length,
      activeTrustedSigners: signerPosture.active.length,
      revokedTrustedSigners: signerPosture.revoked.length,
      rotatedTrustedSigners: signerPosture.revoked.filter((signer) => signer.replacedBy).length,
      trustPolicyPacks: input.trustPolicyPacks.length,
      policyFailureEvents: recentTrustEvents.filter((event) => event.trusted === false || event.warningCount > 0).length,
    },
    signerPosture,
    spaces,
    recentTrustEvents,
    notes: [
      "Trust report is local and metadata-only; it does not expose bundle contents, snapshot contents, or memory text.",
      "Policy failure events are derived from provenance audit payloads where trusted=false or warnings are present.",
      "Unset trust profile means the space has not declared a provenance trust profile.",
    ],
  };
}

function buildSignerPosture(signers: readonly DashboardTrustedSignerInput[]): DashboardTrustReport["signerPosture"] {
  const posture = signers.map((signer) => ({
    name: signer.name,
    signer: signer.signer,
    keyId: signer.keyId,
    source: signer.source,
    status: signer.revokedAt ? "revoked" as const : "active" as const,
    revokedAt: signer.revokedAt,
    replacedBy: signer.replacedBy,
  }));

  return {
    active: posture.filter((signer) => signer.status === "active"),
    revoked: posture.filter((signer) => signer.status === "revoked"),
  };
}

function buildSpacePosture(space: MemorySpace, report: SpaceReport): DashboardTrustSpacePosture {
  const provenance = space.settings?.provenance;
  const trustProfile = provenance?.trustProfile ?? "unset";
  const recentPolicyFailures = report.recentProvenanceEvents
    .map((event) => summarizeTrustEvent(event))
    .filter((event) => event.trusted === false || event.warningCount > 0)
    .length;

  return {
    spaceId: space.id,
    name: space.name,
    trustProfile,
    trustedSignerCount: provenance?.trustedSignerNames?.length ?? 0,
    allowedOriginCount: provenance?.allowedOrigins?.length ?? 0,
    allowedSignerCount: provenance?.allowedSigners?.length ?? 0,
    allowedSignerKeyIdCount: provenance?.allowedSignerKeyIds?.length ?? 0,
    provenanceEvents: report.recentProvenanceEvents.length,
    provenanceSummaryRecords: report.provenanceSummaryCount,
    policyFailureEvents: recentPolicyFailures,
    needsTrustReview: report.recentProvenanceEvents.length > 0 && report.provenanceSummaryCount === 0,
  };
}

function summarizeTrustEvent(event: MemoryEvent): DashboardTrustEventSummary {
  const payload = event.payload ?? {};
  return {
    eventId: event.id,
    spaceId: event.spaceId,
    type: event.type,
    createdAt: event.createdAt,
    trustProfile: readString(payload.trustProfile),
    trusted: typeof payload.trusted === "boolean" ? payload.trusted : undefined,
    signer: readString(payload.signer),
    origin: readString(payload.origin),
    matchedTrustedSignerNames: readStringArray(payload.matchedTrustedSignerNames),
    warningCount: readStringArray(payload.warnings).length,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}
