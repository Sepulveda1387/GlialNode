import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const nodeExecutable = process.execPath;
const dbPath = join(root, ".glialnode", "example-service.sqlite");
const exportPath = join(root, ".glialnode", "example-service-export.json");

removeIfExists(dbPath);
removeIfExists(exportPath);

logStep("Building GlialNode");
runBuild();

const { GlialNodeClient } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const client = new GlialNodeClient({ filename: dbPath });

try {
  logStep("Bootstrapping Service Space");
  const space = await client.createSpace({
    name: "Example Memory Service",
    preset: "execution-first",
    settings: {
      provenance: {
        trustProfile: "signed",
      },
      retentionDays: {
        short: 7,
        mid: 30,
        long: 90,
      },
    },
  });
  const scope = await client.addScope({
    spaceId: space.id,
    type: "agent",
    label: "coach-worker",
  });
  console.log(`spaceId=${space.id}`);
  console.log(`scopeId=${scope.id}`);

  logStep("Ingesting Session Events");
  await ingestSessionTurn(client, {
    spaceId: space.id,
    scopeId: scope.id,
    message: "Client asked for a 12-week strength plan with 3 sessions/week.",
    summary: "Strength plan request",
    tier: "mid",
    kind: "task",
    tags: ["session", "intake", "plan"],
  });
  await ingestSessionTurn(client, {
    spaceId: space.id,
    scopeId: scope.id,
    message: "Coach decided to prioritize progressive overload and recovery deload in week 4.",
    summary: "Programming decision",
    tier: "long",
    kind: "decision",
    tags: ["session", "programming", "decision"],
  });
  await ingestSessionTurn(client, {
    spaceId: space.id,
    scopeId: scope.id,
    message: "Client prefers concise weekly summaries and explicit next-session homework.",
    summary: "Communication preference",
    tier: "long",
    kind: "preference",
    tags: ["session", "preference", "communication"],
  });

  logStep("Preparing Reply Context");
  const replyContext = await client.prepareReplyContext(
    {
      spaceId: space.id,
      text: "progressive",
      limit: 10,
    },
    {
      supportLimit: 3,
      bundleConsumer: "planner",
      bundleMaxSupporting: 4,
    },
  );
  console.log(`contextEntries=${replyContext.entries.length}`);
  console.log(replyContext.text);

  logStep("Running Maintenance");
  const maintenance = await client.maintainSpace(space.id, { apply: true });
  console.log(`promotions=${maintenance.compactionPlan.promoted.length}`);
  console.log(`expired=${maintenance.retentionPlan.expired.length}`);
  console.log(`decayed=${maintenance.decayPlan.decayed.length}`);

  logStep("Inspecting Report");
  const report = await client.getSpaceReport(space.id, 10);
  console.log(`records=${report.recordCount}`);
  console.log(`events=${report.eventCount}`);
  console.log(`eventTypes=${JSON.stringify(report.eventCountsByType)}`);
  console.log(`provenanceSummaryRecords=${report.provenanceSummaryCount}`);
  console.log(`maintenanceLatestRunAt=${report.maintenance.latestRunAt ?? ""}`);

  logStep("Exporting Snapshot");
  const output = await client.exportSpaceToFile(space.id, exportPath, {
    origin: "example-service",
  });
  const snapshot = JSON.parse(readFileSync(output, "utf8"));
  console.log(`output=${output}`);
  console.log(`snapshotRecords=${snapshot.records.length}`);
  console.log(`snapshotEvents=${snapshot.events.length}`);
} finally {
  client.close();
}

console.log("");
console.log("Example service run complete.");

async function ingestSessionTurn(client, input) {
  await client.addEvent({
    spaceId: input.spaceId,
    scope: { id: input.scopeId, type: "agent" },
    actorType: "agent",
    actorId: "coach-service",
    type: "task_completed",
    summary: input.summary,
    payload: {
      source: "example-memory-service",
      tags: input.tags,
    },
  });

  await client.addRecord({
    spaceId: input.spaceId,
    scope: { id: input.scopeId, type: "agent" },
    tier: input.tier,
    kind: input.kind,
    content: input.message,
    summary: input.summary,
    tags: input.tags,
    visibility: "space",
    importance: input.tier === "long" ? 0.86 : 0.72,
    confidence: 0.89,
    freshness: 0.82,
  });
}

function runBuild() {
  const npmCliPath = process.env.npm_execpath;

  if (npmCliPath) {
    run(nodeExecutable, [npmCliPath, "run", "build"]);
    return;
  }

  const tscPath = join(root, "node_modules", "typescript", "lib", "tsc.js");
  run(nodeExecutable, [tscPath, "-p", "tsconfig.json"]);
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
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
