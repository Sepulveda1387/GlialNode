import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const outputDirectory = resolve(args["output-dir"] ?? join(root, ".glialnode", "dashboard-demo"));
const skipBuild = args["skip-build"] === "true";
const nodeExecutable = process.execPath;
const tscPath = join(root, "node_modules", "typescript", "lib", "tsc.js");
const cliPath = join(root, "dist", "cli", "index.js");
const databasePath = join(outputDirectory, "glialnode.dashboard-demo.sqlite");
const metricsDatabasePath = join(outputDirectory, "glialnode.dashboard-demo.metrics.sqlite");
const presetDirectory = join(outputDirectory, "presets");
const artifactsDirectory = join(outputDirectory, "artifacts");

removeIfExists(outputDirectory);
mkdirSync(artifactsDirectory, { recursive: true });

if (!skipBuild) {
  logStep("Building GlialNode");
  run(nodeExecutable, [tscPath, "-p", "tsconfig.json"]);
}

logStep("Seeding dashboard fixture");
const spaceOutput = cli([
  "space",
  "create",
  "--name",
  "Dashboard Demo Space",
  "--description",
  "Synthetic local-only dashboard fixture for GlialNode reporting.",
  "--provenance-trust-profile",
  "anchored",
  "--provenance-trust-signer",
  "demo-anchor",
]);
const spaceId = readId(spaceOutput);

const agentScopeOutput = cli([
  "scope",
  "add",
  "--space-id",
  spaceId,
  "--type",
  "agent",
  "--label",
  "demo-agent",
]);
const agentScopeId = readId(agentScopeOutput);

const auditScopeOutput = cli([
  "scope",
  "add",
  "--space-id",
  spaceId,
  "--type",
  "memory_space",
  "--label",
  "Dashboard Trust Audit",
]);
const auditScopeId = readId(auditScopeOutput);

const primaryRecordId = addMemory({
  tier: "long",
  kind: "decision",
  content: "Use dashboard metrics to decide whether GlialNode reduces repeated context assembly.",
  summary: "Dashboard ROI decision",
  importance: "0.92",
  confidence: "0.9",
  freshness: "0.88",
  tags: "dashboard,roi,decision",
});
const supportingRecordId = addMemory({
  tier: "mid",
  kind: "fact",
  content: "Recall bundles should stay compact, cited, and free of raw prompt telemetry.",
  summary: "Recall quality guardrail",
  importance: "0.78",
  confidence: "0.82",
  freshness: "0.76",
  tags: "dashboard,recall,quality",
});
addMemory({
  tier: "mid",
  kind: "fact",
  content: "This synthetic stale memory exists so memory-health cards have a non-perfect score.",
  summary: "Synthetic stale memory",
  importance: "0.54",
  confidence: "0.32",
  freshness: "0.12",
  tags: "dashboard,stale,fixture",
});
addMemory({
  tier: "long",
  kind: "fact",
  content: "This important synthetic memory is intentionally never recalled for opportunity reporting.",
  summary: "Never recalled opportunity",
  importance: "1",
  confidence: "0.95",
  freshness: "0.93",
  tags: "dashboard,opportunity,fixture",
});

logStep("Seeding trust registry and audit metadata");
cli(["preset", "keygen", "--name", "dashboard-demo-key", "--signer", "Dashboard Demo", "--directory", presetDirectory]);
cli([
  "preset",
  "trust-local-key",
  "--name",
  "dashboard-demo-key",
  "--trust-name",
  "demo-anchor",
  "--directory",
  presetDirectory,
]);
cli([
  "preset",
  "trust-pack-register",
  "--name",
  "dashboard-demo-anchored",
  "--base-profile",
  "anchored",
  "--trust-signer",
  "demo-anchor",
  "--directory",
  presetDirectory,
]);
cli([
  "event",
  "add",
  "--space-id",
  spaceId,
  "--scope-id",
  auditScopeId,
  "--scope-type",
  "memory_space",
  "--actor-type",
  "system",
  "--actor-id",
  "dashboard-fixture",
  "--event-type",
  "bundle_reviewed",
  "--summary",
  "Synthetic dashboard trust review metadata.",
  "--payload",
  JSON.stringify({
    trustProfile: "anchored",
    trusted: false,
    signer: "Dashboard Demo",
    origin: "fixture",
    matchedTrustedSignerNames: ["demo-anchor"],
    warnings: ["Fixture warning used to exercise trust dashboard failure counts."],
  }),
]);

logStep("Seeding token and retrieval metrics");
recordTokenUsage({
  operation: "memory.recall",
  baselineTokens: "1800",
  actualContextTokens: "620",
  glialnodeOverheadTokens: "80",
  inputTokens: "700",
  outputTokens: "160",
  latencyMs: "48",
  dimensions: {
    primaryRecordId,
    supportingRecordIds: supportingRecordId,
  },
});
recordTokenUsage({
  operation: "memory.bundle",
  baselineTokens: "2200",
  actualContextTokens: "760",
  glialnodeOverheadTokens: "110",
  inputTokens: "870",
  outputTokens: "180",
  latencyMs: "96",
  dimensions: {
    primaryRecordId,
  },
});
recordTokenUsage({
  operation: "agent.reply",
  baselineTokens: "1400",
  actualContextTokens: "520",
  glialnodeOverheadTokens: "60",
  inputTokens: "580",
  outputTokens: "220",
  latencyMs: "132",
  dimensions: {
    workflow: "dashboard-demo",
  },
});

logStep("Writing dashboard artifacts");
const artifacts = {
  overview: exportDashboardJson("overview", "dashboard-overview.json"),
  executive: exportDashboardJson("executive", "dashboard-executive.json"),
  operations: exportDashboardJson("operations", "dashboard-operations.json", ["--latest-backup-at", "2026-04-24T00:00:00.000Z"]),
  memoryHealth: exportDashboardJson("memory-health", "dashboard-memory-health.json"),
  recallQuality: exportDashboardJson("recall-quality", "dashboard-recall-quality.json", ["--max-top-recalled", "10", "--max-never-recalled", "10"]),
  trust: exportDashboardJson("trust", "dashboard-trust.json", ["--preset-directory", presetDirectory]),
  alerts: exportDashboardJson("alerts", "dashboard-alerts.json", [
    "--latest-backup-at",
    "2026-04-24T00:00:00.000Z",
    "--memory-health-warning-below",
    "95",
    "--memory-health-critical-below",
    "80",
  ]),
  tokenRoiCsv: exportDashboardArtifact("token-roi", "csv", "token-roi.csv"),
  dashboardHtml: exportDashboardArtifact("dashboard-html", "html", "dashboard.html"),
};

const manifest = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  fixture: "dashboard-demo",
  note: "Synthetic local-only GlialNode dashboard fixture. Do not treat values as production benchmarks.",
  databasePath,
  metricsDatabasePath,
  presetDirectory,
  spaceId,
  agentScopeId,
  records: {
    primaryRecordId,
    supportingRecordId,
  },
  artifacts,
};
const manifestPath = join(outputDirectory, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("");
console.log("Dashboard fixture completed.");
console.log(`Output:   ${outputDirectory}`);
console.log(`Manifest: ${manifestPath}`);

function addMemory(input) {
  const output = cli([
    "memory",
    "add",
    "--space-id",
    spaceId,
    "--scope-id",
    agentScopeId,
    "--scope-type",
    "agent",
    "--tier",
    input.tier,
    "--kind",
    input.kind,
    "--content",
    input.content,
    "--summary",
    input.summary,
    "--importance",
    input.importance,
    "--confidence",
    input.confidence,
    "--freshness",
    input.freshness,
    "--tags",
    input.tags,
  ]);
  return readId(output);
}

function recordTokenUsage(input) {
  cli([
    "metrics",
    "token-record",
    "--metrics-db",
    metricsDatabasePath,
    "--space-id",
    spaceId,
    "--agent-id",
    agentScopeId,
    "--operation",
    input.operation,
    "--model",
    "gpt-dashboard-fixture",
    "--baseline-tokens",
    input.baselineTokens,
    "--actual-context-tokens",
    input.actualContextTokens,
    "--glialnode-overhead-tokens",
    input.glialnodeOverheadTokens,
    "--input-tokens",
    input.inputTokens,
    "--output-tokens",
    input.outputTokens,
    "--latency-ms",
    input.latencyMs,
    "--dimensions",
    JSON.stringify(input.dimensions),
  ]);
}

function exportDashboardJson(kind, fileName, extraArgs = []) {
  const outputPath = join(artifactsDirectory, fileName);
  const result = cli([
    "dashboard",
    kind,
    "--metrics-db",
    metricsDatabasePath,
    "--granularity",
    "all",
    ...extraArgs,
    "--json",
  ]);
  writeFileSync(outputPath, `${result.trimEnd()}\n`, "utf8");
  return outputPath;
}

function exportDashboardArtifact(kind, format, fileName) {
  const outputPath = join(artifactsDirectory, fileName);
  cli([
    "dashboard",
    "export",
    "--kind",
    kind,
    "--format",
    format,
    "--output",
    outputPath,
    "--metrics-db",
    metricsDatabasePath,
    "--granularity",
    "all",
  ]);
  return outputPath;
}

function cli(args) {
  return run(nodeExecutable, [cliPath, ...args, "--db", databasePath]);
}

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
  });
}

function readId(output) {
  const idLine = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("id="));

  if (!idLine) {
    throw new Error("Expected command output to contain an id= line.");
  }

  return idLine.slice(3);
}

function logStep(title) {
  console.log(`== ${title} ==`);
}

function removeIfExists(path) {
  const resolved = resolve(path);
  if (existsSync(resolved)) {
    const stats = lstatSync(resolved);
    rmSync(resolved, { force: true, recursive: stats.isDirectory() });
  }
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const entry = rawArgs[index];
    if (!entry?.startsWith("--")) {
      continue;
    }
    const key = entry.slice(2);
    const next = rawArgs[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
