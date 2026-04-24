# Executive Dashboard Decision Map

This document defines the first executive dashboard contract for GlialNode. It is intentionally decision-first: every panel must help a CEO, CPO, COO, or technical operator decide whether GlialNode is creating value, improving memory quality, and staying operationally safe.

This is a planning and product contract only. It does not introduce metrics storage, token collection, local HTTP routes, or a UI by itself.

## Principles

- Every dashboard panel must map to a named decision.
- Cost and token values must distinguish measured usage from estimates.
- Dashboard metrics must not store raw prompts, completions, retrieved memory text, secrets, or private tool outputs by default.
- The open-source dashboard stays local-first and metrics-only; hosted team dashboards, auth, roles, billing, and org-wide tenancy belong to the future paid/Supabase path if demand validates it.
- Before implementing `metrics.sqlite`, token usage APIs, aggregate cost reports, or dashboard snapshot APIs, pause and ask the owner to switch `reasoning_level=extra_high`.

## Personas

| Persona | Primary question | Decisions the dashboard must support |
| --- | --- | --- |
| CEO / founder | Is GlialNode creating enough value to keep using or promoting? | Continue investment, publish results, prioritize paid/team backend only if usage signals justify it |
| CPO / product owner | Is memory quality improving user and agent outcomes? | Tune memory policy, prioritize recall quality work, identify confusing or underused workflows |
| COO / operator | Is the system reliable, safe, and maintainable? | Run maintenance, review trust posture, schedule backup/export, investigate operational warnings |
| Technical operator | What changed, what is risky, and what needs attention now? | Inspect records/events, review graph topology, check storage/runtime health, validate release readiness |

## Panel Map

| Panel | Audience | Decision | Current source | Missing source before true KPI |
| --- | --- | --- | --- | --- |
| Value summary | CEO | Is usage producing measurable savings? | Release readiness, memory activity, future token usage reports | Metrics DB, token recording API, cost model |
| Memory health | CPO, COO | Are memories fresh, trusted, and usable? | `space report`, lifecycle events, risk summaries | Health score contract and thresholds |
| Recall quality | CPO | Are agents retrieving useful context efficiently? | `memory recall`, `memory trace`, `memory bundle`, semantic eval report | Recall usage telemetry, latency, bundle-size tracking |
| Trust posture | COO | Are imported artifacts and provenance decisions safe? | Trust packs, snapshot/bundle validation, provenance events | Trust dashboard snapshot with unresolved-review states |
| Operations | COO, operator | Is the local runtime healthy? | `status`, `doctor`, storage contract, schema version, benchmark docs | Alert thresholds and backup/export freshness model |
| Space and agent activity | CEO, CPO | Which spaces/workflows are active and valuable? | Spaces, scopes, records, events, inspector index | Project/agent/workflow IDs in metrics records |
| Storage growth | COO | Is local storage growing predictably? | SQLite path/size from diagnostics, graph/report counts | Metrics DB size reporting and retention policy |
| Roadmap/release posture | CEO, operator | Is this ready to publish or announce? | `release readiness`, roadmap gates, CI status | Optional release snapshot export |

## CEO View

The CEO view should answer:

- Are people or agents using GlialNode?
- Which spaces or workflows show the most activity?
- How much context/token waste appears to be avoided?
- Which value numbers are measured vs estimated?
- Are there any release, trust, or operations blockers?

Acceptance bar:

- No cost/savings card may display without confidence metadata.
- Estimated savings must be visually and structurally separate from measured provider usage.
- The view must still be useful when no metrics DB is configured by showing local memory activity and readiness posture.

## CPO View

The CPO view should answer:

- Is durable memory improving recall and workflow continuity?
- Which memory kinds are being created, reinforced, superseded, or archived?
- Which records are stale, conflicted, low confidence, or rarely recalled?
- Are reviewer/executor/planner bundles shaped correctly?
- Which product workflows need clearer instrumentation?

Acceptance bar:

- Quality metrics must be framed as signals, not model-judged truth.
- Recall quality must include traceability back to query, bundle, and lifecycle evidence.
- Any LLM-based qualitative scoring must be opt-in and excluded from the initial OSS dashboard.

## COO View

The COO view should answer:

- Is the local database healthy and on the expected schema version?
- Is the write-mode contract clear for this deployment?
- Has maintenance run recently?
- Are exports/backups recent enough?
- Are trust anchors, revoked signers, and policy failures visible?

Acceptance bar:

- Operational warnings must be actionable and tied to existing commands or client APIs.
- No background daemon is required for alerts in the OSS version.
- Local HTTP dashboard routes, if added later, must be read-only by default.

## Metric Confidence Labels

Dashboard values must carry one of these labels:

| Label | Meaning | Example |
| --- | --- | --- |
| `measured` | Directly recorded by the host app or runtime | actual input/output tokens from a provider response |
| `estimated` | Derived from a declared baseline or heuristic | estimated saved tokens compared with full-context replay |
| `configured` | Based on operator-provided settings | cost per 1M tokens for a model |
| `computed` | Deterministically aggregated from stored records | active memory count, records by tier, lifecycle event counts |
| `unavailable` | Not enough data has been recorded | cost saved before token usage instrumentation exists |

## Initial Dashboard Snapshot Shape

The first dashboard API should be a versioned snapshot, not a UI-specific data dump.

```ts
interface ExecutiveDashboardSnapshot {
  schemaVersion: "1.0.0";
  generatedAt: string;
  scope: {
    spaceIds?: string[];
    projectIds?: string[];
    agentIds?: string[];
  };
  value: {
    usageStatus: "unconfigured" | "partial" | "measured";
    estimatedSavedTokens?: number;
    estimatedSavedCost?: number;
    confidence: "measured" | "estimated" | "configured" | "computed" | "unavailable";
  };
  memoryHealth: {
    activeRecords: number;
    staleRecords: number;
    contestedRecords: number;
    lowConfidenceRecords: number;
    confidence: "computed";
  };
  trust: {
    recentPolicyFailures: number;
    revokedTrustedSigners: number;
    unsignedArtifactReviews: number;
    confidence: "computed" | "unavailable";
  };
  operations: {
    schemaUpToDate: boolean;
    writeMode: string;
    latestMaintenanceAt?: string;
    warnings: string[];
    confidence: "computed";
  };
}
```

## Implementation Order

1. Finalize persona and decision map. This document satisfies the first planning slice.
2. Define metric confidence and privacy contracts.
3. Define dashboard snapshot schema contracts.
4. Pause and ask the owner to switch `reasoning_level=extra_high`.
5. Implement optional `metrics.sqlite`.
6. Add token/cost/latency recording APIs.
7. Add aggregate reporting APIs.
8. Add dashboard snapshot builders.
9. Add optional read-only local HTTP routes.
10. Build the UI from snapshot contracts, not directly from storage tables.

## Non-Goals For OSS V2.07

- Hosted multi-tenant dashboard.
- Supabase/Postgres team backend.
- Subscription billing.
- Role-based org access control.
- LLM-scored dashboard recommendations by default.
- Raw prompt/completion logging.
