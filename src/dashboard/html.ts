import type { DashboardAlert, DashboardAlertEvaluation } from "./alerts.js";
import type { DashboardMemoryHealthReport } from "./builders.js";
import type { DashboardRecallQualityReport } from "./recall-quality.js";
import type { ExecutiveDashboardRankedItem, ExecutiveDashboardSnapshot, OperationsDashboardSnapshot, DashboardMetric } from "./schema.js";
import type { DashboardTrustReport } from "./trust-report.js";

export interface DashboardHtmlInput {
  readonly executive: ExecutiveDashboardSnapshot;
  readonly operations: OperationsDashboardSnapshot;
  readonly memoryHealth: DashboardMemoryHealthReport;
  readonly recallQuality: DashboardRecallQualityReport;
  readonly trust: DashboardTrustReport;
  readonly alerts: DashboardAlertEvaluation;
}

export function renderDashboardHtml(input: DashboardHtmlInput): string {
  const generatedAt = input.executive.generatedAt;
  const scopeLabel = formatScope(input.executive.scope);
  const criticalAlerts = input.alerts.summary.critical;
  const warningAlerts = input.alerts.summary.warning;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GlialNode Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17201b;
      --muted: #66736c;
      --paper: #fbf8ef;
      --panel: rgba(255, 255, 255, 0.82);
      --line: rgba(23, 32, 27, 0.14);
      --moss: #376b52;
      --amber: #b86b1f;
      --clay: #d95836;
      --sky: #456f99;
      --shadow: 0 20px 60px rgba(45, 53, 47, 0.16);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Aptos", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 18% 12%, rgba(216, 88, 54, 0.18), transparent 32rem),
        radial-gradient(circle at 82% 2%, rgba(69, 111, 153, 0.20), transparent 28rem),
        linear-gradient(140deg, #fffaf0 0%, #eef4e7 56%, #f5efe1 100%);
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 42px 0 56px;
    }

    .hero {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 22px;
      align-items: stretch;
      margin-bottom: 22px;
    }

    .hero-card, .panel, .metric-card {
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
      border-radius: 28px;
    }

    .hero-card {
      padding: 34px;
      overflow: hidden;
      position: relative;
    }

    .hero-card:after {
      content: "";
      position: absolute;
      inset: auto -8rem -8rem auto;
      width: 18rem;
      height: 18rem;
      border-radius: 999px;
      background: rgba(55, 107, 82, 0.14);
    }

    .eyebrow {
      margin: 0 0 14px;
      color: var(--moss);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 760px;
      font-family: "Georgia", "Times New Roman", serif;
      font-size: clamp(2.35rem, 6vw, 5.2rem);
      line-height: 0.92;
      letter-spacing: -0.055em;
    }

    .lede {
      max-width: 780px;
      margin: 20px 0 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.65;
    }

    .stamp {
      display: grid;
      gap: 14px;
      padding: 24px;
    }

    .stamp strong {
      display: block;
      font-size: 1.8rem;
      letter-spacing: -0.04em;
    }

    .stamp span {
      color: var(--muted);
      line-height: 1.45;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }

    .metric-card {
      padding: 20px;
      min-height: 150px;
    }

    .metric-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 22px;
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .metric-value {
      margin: 0;
      font-size: clamp(1.85rem, 4vw, 3.1rem);
      font-weight: 850;
      letter-spacing: -0.055em;
    }

    .section-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 18px;
    }

    .panel { padding: 24px; }

    .panel h2 {
      margin: 0 0 16px;
      font-size: 1.22rem;
      letter-spacing: -0.025em;
    }

    .rows { display: grid; gap: 10px; }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-top: 1px solid var(--line);
    }

    .row:first-child { border-top: 0; }
    .row span:first-child { color: var(--muted); }
    .row span:last-child { font-weight: 760; text-align: right; }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 5px 10px;
      background: rgba(55, 107, 82, 0.12);
      color: var(--moss);
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .pill.warning { background: rgba(184, 107, 31, 0.16); color: var(--amber); }
    .pill.critical { background: rgba(217, 88, 54, 0.16); color: var(--clay); }
    .pill.info { background: rgba(69, 111, 153, 0.16); color: var(--sky); }

    .alert-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .ranked-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .ranked-list li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.58);
    }

    .ranked-title {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }

    .ranked-note {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .ranked-value {
      font-size: 1.2rem;
      font-weight: 850;
      letter-spacing: -0.04em;
      text-align: right;
    }

    .alert-list li {
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.58);
    }

    .alert-list p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }

    .footer-note {
      margin: 26px 0 0;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.6;
    }

    @media (max-width: 920px) {
      .hero, .section-grid { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 560px) {
      main { width: min(100% - 20px, 1180px); padding-top: 20px; }
      .grid { grid-template-columns: 1fr; }
      .hero-card, .panel, .metric-card { border-radius: 22px; }
      .hero-card { padding: 24px; }
      .row { align-items: flex-start; flex-direction: column; gap: 4px; }
      .row span:last-child { text-align: left; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="hero-card">
        <p class="eyebrow">Local executive dashboard</p>
        <h1>GlialNode command center</h1>
        <p class="lede">A standalone, metadata-only view of value, memory quality, recall behavior, trust posture, and operating risk. This file is safe to open locally and does not call a server.</p>
      </div>
      <aside class="hero-card stamp">
        <div><span>Generated</span><strong>${escapeHtml(formatDate(generatedAt))}</strong></div>
        <div><span>Scope</span><strong>${escapeHtml(scopeLabel)}</strong></div>
        <div><span>Alert posture</span><strong>${escapeHtml(formatSeverity(input.alerts.summary.highestSeverity))}</strong></div>
      </aside>
    </section>

    <section class="grid" aria-label="Executive KPIs">
      ${metricCard("Saved tokens", formatMetric(input.executive.value.savedTokens), input.executive.value.savedTokens.confidence)}
      ${metricCard("Saved cost", formatMetric(input.executive.value.savedCost), input.executive.value.savedCost.confidence)}
      ${metricCard("Memory health", formatPercentMetric(input.executive.risk.memoryHealthScore), input.executive.risk.memoryHealthScore.confidence)}
      ${metricCard("Open risk", `${criticalAlerts} critical`, `${warningAlerts} warnings`)}
    </section>

    <section class="section-grid">
      <section class="panel"><h2>Executive Value</h2><div class="rows">
        ${row("Active spaces", formatMetric(input.executive.value.activeSpaces))}
        ${row("Net savings", formatMetric(input.executive.value.netSavings))}
        ${row("Trust posture score", formatMetric(input.executive.risk.trustPostureScore))}
        ${row("Open critical warnings", formatMetric(input.executive.risk.openCriticalWarnings))}
      </div></section>

      <section class="panel"><h2>Operations</h2><div class="rows">
        ${row("Storage backend", formatMetric(input.operations.storage.backend))}
        ${row("Schema version", formatMetric(input.operations.storage.schemaVersion))}
        ${row("Database size", formatBytes(input.operations.storage.databaseBytes.value))}
        ${row("Doctor status", formatMetric(input.operations.reliability.doctorStatus))}
        ${row("Latest backup", formatMetric(input.operations.reliability.latestBackupAt))}
        ${row("Pending compactions", formatMetric(input.operations.maintenance.pendingCompactions))}
        ${row("Pending retention actions", formatMetric(input.operations.maintenance.pendingRetentionActions))}
      </div></section>

      <section class="panel"><h2>Benchmark Baseline</h2><div class="rows">
        ${formatBenchmarkBaselineRows(input.operations)}
      </div></section>

      <section class="panel"><h2>Top ROI</h2><ol class="ranked-list">
        ${formatRankedItems(input.executive.insights?.topRoi ?? [], "No token ROI telemetry has been recorded for this scope yet.")}
      </ol></section>

      <section class="panel"><h2>Top Risk</h2><ol class="ranked-list">
        ${formatRankedItems(input.executive.insights?.topRisk ?? [], "No memory risk signals crossed the dashboard threshold.")}
      </ol></section>

      <section class="panel"><h2>Memory Health</h2><div class="rows">
        ${row("Active records", formatMetric(input.memoryHealth.activeRecords))}
        ${row("Stale records", formatMetric(input.memoryHealth.staleRecords))}
        ${row("Low-confidence records", formatMetric(input.memoryHealth.lowConfidenceRecords))}
        ${row("Archived records", formatMetric(input.memoryHealth.archivedRecords))}
        ${row("Superseded records", formatMetric(input.memoryHealth.supersededRecords))}
        ${row("Expired records", formatMetric(input.memoryHealth.expiredRecords))}
        ${row("Spaces missing maintenance", formatMetric(input.memoryHealth.lifecycleDue.spacesMissingMaintenance))}
        ${row("Compaction candidates", formatMetric(input.memoryHealth.lifecycleDue.compactionCandidates))}
        ${row("Retention candidates", formatMetric(input.memoryHealth.lifecycleDue.retentionCandidates))}
        ${row("Latest maintenance", formatMetric(input.memoryHealth.latestMaintenanceAt))}
      </div></section>

      <section class="panel"><h2>Recall Quality</h2><div class="rows">
        ${row("Recall requests", formatNumber(input.recallQuality.totals.recallRequests))}
        ${row("Bundle requests", formatNumber(input.recallQuality.totals.bundleRequests))}
        ${row("Trace requests", formatNumber(input.recallQuality.totals.traceRequests))}
        ${row("P50 latency", formatMilliseconds(input.recallQuality.totals.p50LatencyMs))}
        ${row("P95 latency", formatMilliseconds(input.recallQuality.totals.p95LatencyMs))}
        ${row("Compact/full ratio", formatRatio(input.recallQuality.totals.compactVsFullUsageRatio))}
        ${row("Top recalled IDs", input.recallQuality.topRecalled.map((entry) => `${entry.recordId} (${entry.count})`).join(", ") || "None")}
        ${row("Never recalled candidates", input.recallQuality.neverRecalledCandidates.map((entry) => entry.recordId).join(", ") || "None")}
      </div></section>

      <section class="panel"><h2>Trust Posture</h2><div class="rows">
        ${row("Spaces", formatNumber(input.trust.totals.spaces))}
        ${row("Spaces needing review", formatNumber(input.trust.totals.spacesNeedingTrustReview))}
        ${row("Active trusted signers", formatNumber(input.trust.totals.activeTrustedSigners))}
        ${row("Revoked trusted signers", formatNumber(input.trust.totals.revokedTrustedSigners))}
        ${row("Trust policy packs", formatNumber(input.trust.totals.trustPolicyPacks))}
        ${row("Policy failure events", formatNumber(input.trust.totals.policyFailureEvents))}
      </div></section>

      <section class="panel"><h2>Alerts</h2><ul class="alert-list">${formatAlerts(input.alerts.alerts)}</ul></section>
    </section>

    <p class="footer-note">Privacy note: this dashboard intentionally uses metrics, IDs, timestamps, and posture metadata only. It avoids raw memory contents, prompts, bundle text, and private key material.</p>
  </main>
</body>
</html>
`;
}

function metricCard(label: string, value: string, foot: string): string {
  return `<article class="metric-card"><div class="metric-label"><span>${escapeHtml(label)}</span><span class="pill">${escapeHtml(foot)}</span></div><p class="metric-value">${escapeHtml(value)}</p></article>`;
}

function row(label: string, value: string): string {
  return `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function formatAlerts(alerts: readonly DashboardAlert[]): string {
  if (alerts.length === 0) {
    return `<li><span class="pill">clear</span><p>No dashboard alerts crossed configured thresholds.</p></li>`;
  }
  return alerts
    .map((alert) => `<li><span class="pill ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span><p>${escapeHtml(alert.message)}</p></li>`)
    .join("\n");
}

function formatRankedItems(items: readonly ExecutiveDashboardRankedItem[], emptyMessage: string): string {
  if (items.length === 0) {
    return `<li><span><strong class="ranked-title">Nothing to rank yet</strong><span class="ranked-note">${escapeHtml(emptyMessage)}</span></span><span class="ranked-value">-</span></li>`;
  }

  return items
    .map((item) => `<li><span><strong class="ranked-title">${escapeHtml(item.label)}</strong><span class="ranked-note">${escapeHtml(item.category)} | ${escapeHtml(item.notes[0] ?? item.key)}</span></span><span class="ranked-value">${escapeHtml(formatMetric(item.metric))}</span></li>`)
    .join("\n");
}

function formatBenchmarkBaselineRows(operations: OperationsDashboardSnapshot): string {
  const baseline = operations.performance?.benchmarkBaseline;
  if (!baseline) {
    return row("Status", "No local benchmark baseline attached");
  }

  return [
    row("Generated", formatMetric(baseline.generatedAt)),
    row("Records", formatMetric(baseline.records)),
    row("Search median", formatMillisecondsMetric(baseline.searchMs)),
    row("Recall median", formatMillisecondsMetric(baseline.recallMs)),
    row("Bundle median", formatMillisecondsMetric(baseline.bundleBuildMs)),
    row("Compaction dry-run", formatMillisecondsMetric(baseline.compactionDryRunMs)),
    row("Report median", formatMillisecondsMetric(baseline.reportMs)),
  ].join("\n");
}

function formatMetric(metric: DashboardMetric<number | string | boolean>): string {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "bytes" && typeof metric.value === "number") return formatBytes(metric.value);
  if (metric.unit === "currency" && typeof metric.value === "number") return formatCurrency(metric.value);
  if (metric.unit === "timestamp" && typeof metric.value === "string") return formatDate(metric.value);
  if (typeof metric.value === "number") return formatNumber(metric.value);
  return String(metric.value);
}

function formatPercentMetric(metric: DashboardMetric<number>): string {
  return metric.value === null ? "Unavailable" : `${formatNumber(metric.value)}%`;
}

function formatBytes(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${formatNumber(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let normalized = value / 1024;
  let unitIndex = 0;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(round(normalized, 1))} ${units[unitIndex]}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatMilliseconds(value: number | undefined): string {
  return value === undefined ? "Unavailable" : `${formatNumber(value)} ms`;
}

function formatMillisecondsMetric(metric: DashboardMetric<number>): string {
  return metric.value === null ? "Unavailable" : `${formatNumber(metric.value)} ms`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "Unavailable" : formatNumber(value);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

function formatSeverity(value: DashboardAlertEvaluation["summary"]["highestSeverity"]): string {
  return value === "none" ? "Clear" : value;
}

function formatScope(scope: ExecutiveDashboardSnapshot["scope"]): string {
  if (!scope) return "All spaces";
  return [
    scope.spaceId ? `space:${scope.spaceId}` : undefined,
    scope.agentId ? `agent:${scope.agentId}` : undefined,
    scope.projectId ? `project:${scope.projectId}` : undefined,
    scope.workflowId ? `workflow:${scope.workflowId}` : undefined,
  ].filter((entry): entry is string => entry !== undefined).join(" / ") || "All spaces";
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
