import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeExecutable = process.execPath;
const dbPath = join(root, ".glialnode", "client-demo.sqlite");
const exportPath = join(root, ".glialnode", "client-demo-export.json");

removeIfExists(dbPath);
removeIfExists(exportPath);
removeIfExists(join(root, "dist"));

logStep("Building GlialNode");
runBuild();

const { GlialNodeClient } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const client = new GlialNodeClient({ filename: dbPath });

try {
  logStep("Creating Space");
  const space = await client.createSpace({
    name: "Client Demo Space",
    settings: {
      retentionDays: {
        short: 0,
      },
    },
  });
  console.log(`spaceId=${space.id}`);

  logStep("Adding Scope");
  const scope = await client.addScope({
    spaceId: space.id,
    type: "agent",
    label: "planner",
  });
  console.log(`scopeId=${scope.id}`);

  logStep("Writing Records");
  const promotedRecord = await client.addRecord({
    spaceId: space.id,
    scope: { id: scope.id, type: scope.type },
    tier: "short",
    kind: "task",
    content: "Promote this note through the client.",
    summary: "Client promote",
    importance: 0.95,
    confidence: 0.9,
    freshness: 0.8,
  });
  const expiredRecord = await client.addRecord({
    spaceId: space.id,
    scope: { id: scope.id, type: scope.type },
    tier: "short",
    kind: "task",
    content: "Expire this note through the client.",
    summary: "Client expire",
  });
  console.log(`recordIds=${promotedRecord.id},${expiredRecord.id}`);

  logStep("Searching");
  const matches = await client.searchRecords({
    spaceId: space.id,
    text: "client",
    limit: 10,
  });
  console.log(`matches=${matches.length}`);
  for (const match of matches) {
    console.log(`${match.id} ${match.tier} ${match.kind} ${match.summary ?? match.content}`);
  }

  logStep("Maintaining");
  const maintenance = await client.maintainSpace(space.id, { apply: true });
  console.log(`promotions=${maintenance.compactionPlan.promoted.length}`);
  console.log(`expired=${maintenance.retentionPlan.expired.length}`);

  logStep("Reporting");
  const report = await client.getSpaceReport(space.id, 10);
  console.log(`records=${report.recordCount}`);
  console.log(`events=${report.eventCount}`);
  console.log(`links=${report.linkCount}`);

  logStep("Exporting");
  const writtenPath = await client.exportSpaceToFile(space.id, exportPath);
  console.log(`output=${writtenPath}`);

  logStep("Snapshot Preview");
  const snapshot = JSON.parse(readFileSync(exportPath, "utf8"));
  console.log(`snapshotRecords=${snapshot.records.length}`);
  console.log(`snapshotEvents=${snapshot.events.length}`);
} finally {
  client.close();
}

console.log("");
console.log("Client demo completed.");
console.log(`Database: ${dbPath}`);
console.log(`Export:   ${exportPath}`);

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
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
