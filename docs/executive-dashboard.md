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

Dashboard values must carry one of these labels. These labels are part of the data contract, not UI decoration.

| Label | Meaning | Example |
| --- | --- | --- |
| `measured` | Directly recorded by the host app or runtime | actual input/output tokens from a provider response |
| `estimated` | Derived from a declared baseline or heuristic | estimated saved tokens compared with full-context replay |
| `configured` | Based on operator-provided settings | cost per 1M tokens for a model |
| `computed` | Deterministically aggregated from stored records | active memory count, records by tier, lifecycle event counts |
| `unavailable` | Not enough data has been recorded | cost saved before token usage instrumentation exists |

Every metric exposed to an executive dashboard must carry:

```ts
type DashboardMetricConfidence =
  | "measured"
  | "estimated"
  | "configured"
  | "computed"
  | "unavailable";

interface DashboardMetric<T> {
  value: T | null;
  confidence: DashboardMetricConfidence;
  label: string;
  description?: string;
  unit?: "count" | "tokens" | "currency" | "milliseconds" | "percent" | "ratio" | "bytes" | "timestamp";
  provenance: DashboardMetricProvenance;
}
```

The `value` is nullable so dashboards do not invent zeros when data is missing. A missing value should use `confidence="unavailable"` and explain what data source is absent.

## Metric Provenance

Metric provenance explains where a value came from and whether an operator can trust it as measured, computed, configured, or estimated.

```ts
interface DashboardMetricProvenance {
  source:
    | "memory_report"
    | "memory_events"
    | "recall_trace"
    | "bundle_trace"
    | "trust_registry"
    | "doctor_status"
    | "storage_contract"
    | "metrics_store"
    | "cost_model"
    | "release_readiness"
    | "fixture";
  sourceIds?: string[];
  generatedAt: string;
  window?: {
    from: string;
    to: string;
    granularity: "hour" | "day" | "week" | "month" | "all";
  };
  estimateBasis?: EstimateBasis;
  costModel?: DashboardCostModelMetadata;
}

interface EstimateBasis {
  method:
    | "host_reported_baseline"
    | "full_context_replay_estimate"
    | "pre_glialnode_baseline"
    | "manual_operator_baseline"
    | "fixture";
  baselineTokens?: number;
  actualTokens?: number;
  glialnodeOverheadTokens?: number;
  assumptions: string[];
}

interface DashboardCostModelMetadata {
  provider: string;
  model: string;
  currency: string;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
  source: "operator_configured" | "fixture" | "unknown";
  effectiveAt?: string;
}
```

## Confidence Rules

- `measured` values must come from host-provided usage records or provider response metadata.
- `computed` values must be deterministic aggregations of GlialNode records, events, reports, traces, or diagnostics.
- `configured` values must come from an explicit operator or fixture configuration.
- `estimated` values must include `estimateBasis.method` and at least one human-readable assumption.
- `unavailable` values must explain the missing source through `description` or the surrounding snapshot warning.
- A total may not combine measured and estimated values unless the output exposes a mixed-confidence breakdown.
- Cost savings may not be shown as exact spend unless both usage and cost model are measured/configured with visible provenance.
- Fixture values must be visibly marked as fixture data in provenance.

## Common Metric Contracts

| Metric | Unit | Confidence | Source | Notes |
| --- | --- | --- | --- | --- |
| Active spaces | `count` | `computed` | `memory_report` | Count from current local repository |
| Active records | `count` | `computed` | `memory_report` | Split by status/tier/kind when possible |
| Stale records | `count` | `computed` | `memory_report` or dashboard health rules | Requires declared stale thresholds |
| Contested records | `count` | `computed` | `memory_events` and record links | Based on contradiction links or superseded state |
| Recall bundle size | `tokens` or `bytes` | `computed` | `bundle_trace` | Computed locally from emitted bundle payload |
| Input/output tokens | `tokens` | `measured` | `metrics_store` | Recorded by host app from provider response |
| Baseline tokens | `tokens` | `estimated` or `measured` | `metrics_store` | Measured only if host explicitly recorded real baseline |
| Estimated saved tokens | `tokens` | `estimated` | `metrics_store` | Must disclose baseline method |
| Cost per model | `currency` | `configured` | `cost_model` | Operator-provided; pricing can become stale |
| Estimated saved cost | `currency` | `estimated` | `metrics_store` and `cost_model` | Requires token estimate plus cost model metadata |
| Schema up-to-date | `count` or boolean | `computed` | `doctor_status` | Deterministic from runtime diagnostics |
| Release readiness | `count` or status | `computed` | `release_readiness` | Based on explicit readiness report |

## Forbidden Metric Shapes

Do not emit these shapes:

```ts
// Bad: value looks exact but is actually estimated.
{ savedCost: 12.42 }

// Bad: zero hides missing instrumentation.
{ savedTokens: 0, confidence: "measured" }

// Bad: no basis for estimate.
{ value: 100000, confidence: "estimated", provenance: { source: "metrics_store" } }
```

Prefer:

```ts
{
  value: 100000,
  confidence: "estimated",
  label: "Estimated saved tokens",
  unit: "tokens",
  provenance: {
    source: "metrics_store",
    generatedAt: "2026-04-24T00:00:00.000Z",
    estimateBasis: {
      method: "host_reported_baseline",
      baselineTokens: 140000,
      actualTokens: 40000,
      glialnodeOverheadTokens: 3000,
      assumptions: [
        "Host app supplied baseline token count for the same workflow.",
        "Savings subtract GlialNode context overhead before reporting net saved tokens."
      ]
    }
  }
}
```

## Initial Dashboard Snapshot Shape

The first dashboard API should be a versioned snapshot, not a UI-specific data dump.
The package now exports the initial schema contract and validators from `glialnode` and `glialnode/dashboard`.

```ts
import {
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  assertDashboardSnapshot,
  type ExecutiveDashboardSnapshot,
} from "glialnode/dashboard";
```

Contract types:

- `DashboardOverviewSnapshot`
- `ExecutiveDashboardSnapshot`
- `ProductDashboardSnapshot`
- `OperationsDashboardSnapshot`
- `DashboardMetric<T>`
- `DashboardMetricProvenance`
- `DashboardEstimateBasis`
- `DashboardCostModelMetadata`
- `ExecutiveDashboardRankedItem`

Executive snapshots may include an additive `insights` section:

- `insights.topRoi` ranks spaces, agents, projects, workflows, and operations by estimated saved tokens from metrics telemetry.
- `insights.topRisk` ranks spaces by memory-health-derived risk score.
- Ranked insights are metadata-only and must not include prompt text, completion text, raw memory content, or request/response payloads.

The `trends` array includes aggregate KPIs plus recent bucket-level token ROI metrics when the caller requests `day`, `week`, or `month` granularity. Bucket trend metrics carry the same estimate-basis and cost-model provenance as the aggregate ROI metrics.

Operations snapshots may include an additive `performance.benchmarkBaseline` section when a local benchmark JSON file is supplied. This section uses the largest dataset result in the baseline file and reports search, recall, bundle, compaction dry-run, and report median timings.

Validation helpers:

- `assertDashboardSnapshotVersion`
- `assertDashboardMetric`
- `assertDashboardSnapshot`
- `createUnavailableDashboardMetric`

Builder APIs:

- `client.buildDashboardOverviewSnapshot()`
- `client.buildSpaceDashboardSnapshot(spaceId)`
- `client.buildAgentDashboardSnapshot(agentId)`
- `client.buildExecutiveDashboardSnapshot()`
- `client.buildMemoryHealthReport()`
- `client.buildOperationsDashboardSnapshot()`
- `client.buildRecallQualityReport()`
- `client.buildTrustDashboardReport()`
- `client.evaluateDashboardAlerts()`
- `buildDashboardOverviewSnapshot(input)`
- `buildSpaceDashboardSnapshot(input)`
- `buildAgentDashboardSnapshot(input)`
- `evaluateDashboardAlerts(input)`

CLI JSON:

```bash
glialnode dashboard overview --json
glialnode dashboard executive --json
glialnode dashboard space --space-id <space-id> --json
glialnode dashboard agent --agent-id <agent-id> --json
glialnode dashboard operations --json
glialnode dashboard operations --benchmark-baseline docs/benchmarks/latest.json --json
glialnode dashboard memory-health --json
glialnode dashboard recall-quality --json
glialnode dashboard trust --json
glialnode dashboard alerts --json
glialnode dashboard export --kind dashboard-html --format html --output dashboard.html --json
glialnode dashboard export --kind dashboard-html --format html --output dashboard.html --screenshot-output dashboard.png --screenshot-width 1440 --screenshot-height 900 --json
glialnode dashboard export --kind token-roi --format csv --output token-roi.csv --json
glialnode dashboard export --kind recall-quality --output recall-quality.json --json
glialnode dashboard export --kind trust --output trust.json --json
glialnode dashboard serve --duration-ms 30000 --allow-origin http://127.0.0.1:5173 --port 8787 --json
npm run demo:dashboard
```

Compatibility notes:

- `schemaVersion` starts at `"1.0.0"` and must be present on every snapshot.
- Missing values must use `value: null` and `confidence: "unavailable"` instead of pretending the value is zero.
- Estimated values must include `provenance.estimateBasis.assumptions`.
- Snapshot builders validate the schema and privacy contract before returning JSON.
- Alert evaluations are foreground/read-only; the OSS package does not run a background alert daemon.
- Recall quality reports are metrics-only: host apps may provide record IDs in `dimensions.primaryRecordId` and comma-separated `dimensions.supportingRecordIds`, but raw memory text remains excluded.
- Trust dashboard reports are metadata-only: signer posture, trust-pack counts, per-space trust settings, and provenance event summaries without bundle/snapshot contents.
- Executive dashboard insights are additive to schema version `1.0.0` and safe for older consumers to ignore.
- Executive dashboard trend metrics include recent bucket-level saved token/cost values when token metrics are requested with day/week/month granularity.
- Memory health reports include `lifecycleDue.spacesMissingMaintenance`, `lifecycleDue.compactionCandidates`, and `lifecycleDue.retentionCandidates`. These are planner-derived counts only; they do not expose memory text.
- Operations benchmark baselines are opt-in local files. The dashboard does not run benchmarks automatically.
- Dashboard exports write local artifacts only. `dashboard-html` writes a standalone local HTML dashboard; `token-roi` supports CSV/JSON; `memory-health`, `recall-quality`, `trust`, and `alerts` support JSON.
- Dashboard HTML exports can optionally capture a PNG with `--screenshot-output` when Playwright is installed by the operator or CI environment. Screenshot capture is never required for normal package use.
- `npm run demo:dashboard` generates a synthetic local fixture under `.glialnode/dashboard-demo/` for parser tests, screenshots, and early dashboard UI work, including `artifacts/dashboard.html`.

## Privacy And Access Contract

The OSS dashboard contract is local-first and metrics-only. It must not expose raw prompt text, completion text, memory content, request bodies, response bodies, API keys, or secret values.

The package exports privacy helpers from `glialnode/dashboard`:

```ts
import {
  assertDashboardCapabilityAllowed,
  assertDashboardPrivacyPolicy,
  assertDashboardSnapshotPrivacy,
  assertOssDashboardBoundary,
  createDashboardDistributionBoundary,
  createDefaultDashboardPrivacyPolicy,
} from "glialnode/dashboard";
```

Default policy:

- `accessMode: "local_process"`
- `allowRawText: false`
- `allowedOrigins: []`
- `redactionRules: ["no_prompt_text", "no_completion_text", "no_memory_content", "no_request_response_body", "no_secret_values"]`

Local HTTP notes:

- Optional local HTTP dashboard routes must be read-only.
- Local HTTP mode must declare explicit `allowedOrigins`.
- The OSS local server binds only to loopback hosts: `127.0.0.1`, `localhost`, or `::1`.
- CORS is deny-by-default for browser origins. Use `--allow-origin <origin[,origin]>`; wildcard origins are intentionally not supported.
- The local server auto-shuts down after `--duration-ms` and is intended for local dashboard clients, CI probes, and temporary previews.
- Hosted team dashboards are intentionally rejected in the OSS privacy contract and reserved for the future paid/Supabase path.

## OSS Vs Paid Dashboard Boundary

The open-source package intentionally ships the dashboard as local-first infrastructure:

- Allowed in OSS: local `metrics.sqlite`, CLI JSON, standalone local HTML export, temporary loopback-only read-only HTTP API, and seeded demo fixtures.
- Reserved for a future paid/team path: hosted dashboards, Supabase project backend, Postgres team storage, subscription billing, org role access control, and cross-user tenancy.
- Validation helpers expose this boundary through `createDashboardDistributionBoundary()`, `assertOssDashboardBoundary()`, and `assertDashboardCapabilityAllowed(...)`.
- The paid path must not be started as a hidden default in OSS. It should only begin after public OSS usage signals justify it, with tenant isolation, billing, and auth modeled explicitly.

Read-only local HTTP routes:

- `GET /overview`
- `GET /executive`
- `GET /spaces`
- `GET /spaces/:id`
- `GET /agents`
- `GET /agents/:id`
- `GET /metrics/token-usage`
- `GET /trust`
- `GET /ops`

Each route returns a JSON envelope:

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-04-24T00:00:00.000Z",
  "route": "/overview",
  "data": {}
}
```

Snapshot privacy validation:

- Rejects raw-text object fields such as `promptText`, `completionText`, `memoryContent`, `rawText`, `requestBody`, and `responseBody`.
- Allows metric labels, provenance source IDs, compatibility notes, and warning messages.
- Should be called by future dashboard builders before returning JSON to CLI, local HTTP, or UI consumers.

## Implementation Order

1. Finalize persona and decision map. This document satisfies the first planning slice.
2. Define metric confidence and privacy contracts.
3. Define dashboard snapshot schema contracts. This is complete for the exported TypeScript contract.
4. Pause and ask the owner to switch `reasoning_level=extra_high`. This checkpoint was completed before metrics implementation.
5. Implement optional `metrics.sqlite`. Complete for local token usage metrics.
6. Add token/cost/latency recording APIs. Complete for client and CLI append paths.
7. Add aggregate reporting APIs. Complete for day/week/month/all token ROI reports.
8. Add dashboard snapshot builders. Complete for overview, space, and agent connector snapshots.
9. Expand dashboard snapshot builders. Complete for executive and operations snapshots, plus memory health report API.
10. Add dashboard alert threshold model. Complete for memory health, maintenance, backup freshness, and database size thresholds.
11. Add recall quality reporting. Complete for retrieval request counts, latency percentiles, compact-vs-full token ratio, top recalled IDs, and never-recalled candidates.
12. Add trust/provenance dashboard reporting. Complete for signer posture, trust-pack counts, per-space trust posture, recent provenance events, and policy failure counts.
13. Add exportable dashboard artifacts. Complete for token ROI CSV/JSON plus memory health, recall quality, trust, and alerts JSON.
14. Add seeded dashboard fixture/demo dataset. Complete for deterministic synthetic local artifacts via `npm run demo:dashboard`.
15. Add optional read-only local HTTP routes. Complete for loopback-only, explicit-origin dashboard API routes.
16. Add lifecycle-due memory health detail. Complete for planner-derived compaction/retention candidates and spaces missing maintenance.
17. Add executive historical trend detail. Complete for recent bucket-level token ROI trend metrics in existing snapshot contracts.
18. Define OSS vs paid dashboard boundary. Complete for exported capability boundary helpers plus documentation that keeps Supabase/Postgres/team dashboards reserved.
19. Add optional dashboard screenshot capture. Complete for `dashboard export --kind dashboard-html --screenshot-output <png>` with explicit viewport flags and optional Playwright runtime dependency.
20. Build the UI from snapshot contracts, not directly from storage tables.

## Non-Goals For OSS V2.07

- Hosted multi-tenant dashboard.
- Supabase/Postgres team backend.
- Subscription billing.
- Role-based org access control.
- LLM-scored dashboard recommendations by default.
- Raw prompt/completion logging.
