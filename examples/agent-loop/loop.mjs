import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const nodeExecutable = process.execPath;
const sourceDbPath = join(root, ".glialnode", "agent-loop-source.sqlite");
const targetDbPath = join(root, ".glialnode", "agent-loop-target.sqlite");
const presetDirectory = join(root, ".glialnode", "agent-loop-presets");
const exportPath = join(root, ".glialnode", "agent-loop-snapshot.json");

removeIfExists(sourceDbPath);
removeIfExists(targetDbPath);
removeIfExists(exportPath);
removeIfExists(presetDirectory);

logStep("Building GlialNode");
runBuild();

const { GlialNodeClient } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const sourceClient = new GlialNodeClient({ filename: sourceDbPath, presetDirectory });
const targetClient = new GlialNodeClient({ filename: targetDbPath, presetDirectory });

try {
  logStep("Bootstrapping Source Space");
  const space = await sourceClient.createSpace({
    name: "Agent Loop Source",
    preset: "conservative-review",
    settings: {
      provenance: {
        trustProfile: "anchored",
        trustedSignerNames: ["ops-anchor"],
      },
      retentionDays: {
        short: 7,
        mid: 30,
        long: 90,
      },
    },
  });
  const scope = await sourceClient.addScope({
    spaceId: space.id,
    type: "agent",
    label: "planner",
  });
  console.log(`sourceSpaceId=${space.id}`);

  logStep("Seeding Agent Memory");
  await sourceClient.addRecord({
    spaceId: space.id,
    scope: { id: scope.id, type: scope.type },
    tier: "mid",
    kind: "task",
    content: "Deliver weekly coaching plan with explicit recovery constraints.",
    summary: "Weekly coaching task",
    tags: ["actionable", "planning"],
    importance: 0.9,
    confidence: 0.92,
    freshness: 0.9,
  });
  await sourceClient.addRecord({
    spaceId: space.id,
    scope: { id: scope.id, type: scope.type },
    tier: "mid",
    kind: "summary",
    content: "Bundle import audit for trusted signer review.",
    summary: "Bundle import audit",
    tags: ["provenance", "bundle", "audit"],
    importance: 0.76,
    confidence: 0.87,
    freshness: 0.84,
  });

  logStep("Building Recall Bundle");
  const bundles = await sourceClient.bundleRecall({
    spaceId: space.id,
    text: "weekly coaching plan",
    limit: 1,
  }, {
    bundleConsumer: "auto",
    bundleProvenanceMode: "auto",
    supportLimit: 4,
    bundleMaxSupporting: 4,
  });
  console.log(`bundleCount=${bundles.length}`);
  console.log(`bundleRoute=${bundles[0]?.route.resolvedConsumer ?? "none"}`);
  console.log(`bundleTrace=${bundles[0]?.trace.summary ?? ""}`);

  logStep("Running Maintenance");
  const maintenance = await sourceClient.maintainSpace(space.id, { apply: true });
  console.log(`promotions=${maintenance.compactionPlan.promoted.length}`);
  console.log(`expired=${maintenance.retentionPlan.expired.length}`);
  console.log(`decayed=${maintenance.decayPlan.decayed.length}`);

  logStep("Creating Trust Anchor And Signed Export");
  sourceClient.generateSigningKey("ops-snapshot-key", { signer: "Ops Team" });
  const signingKey = sourceClient.getSigningKey("ops-snapshot-key");
  sourceClient.trustSigningKey("ops-snapshot-key", { trustName: "ops-anchor" });

  await sourceClient.exportSpaceToFile(space.id, exportPath, {
    origin: "agent-loop-example",
    signer: "Ops Team",
    signingPrivateKeyPem: sourceClient.getSigningKey("ops-snapshot-key").privateKeyPem,
  });
  const exported = JSON.parse(readFileSync(exportPath, "utf8"));
  console.log(`snapshotSigned=${Boolean(exported.metadata?.signature)}`);
  console.log(`snapshotPath=${exportPath}`);

  logStep("Previewing Anchored Import");
  const preview = await targetClient.previewSnapshotImportFromFile(exportPath, {
    trustPolicy: { trustedSignerNames: ["ops-anchor"] },
    trustProfile: "anchored",
    directory: presetDirectory,
    collisionPolicy: "error",
  });
  console.log(`previewApplyAllowed=${preview.applyAllowed}`);
  console.log(`previewBlockingIssues=${preview.blockingIssues.length}`);

  logStep("Importing Into Target");
  const imported = await targetClient.importSnapshotFromFile(exportPath, {
    trustPolicy: { trustedSignerNames: ["ops-anchor"] },
    trustProfile: "anchored",
    directory: presetDirectory,
    collisionPolicy: "error",
  });
  console.log(`targetSpaceId=${imported.space.id}`);
  console.log(`targetSpaceName=${imported.space.name}`);
  console.log(`targetRecords=${imported.records.length}`);

  logStep("Verifying Target Recall");
  const targetBundles = await targetClient.bundleRecall({
    spaceId: imported.space.id,
    text: "weekly coaching",
    limit: 1,
  }, {
    bundleConsumer: "auto",
    bundleProvenanceMode: "auto",
  });
  console.log(`targetBundleCount=${targetBundles.length}`);
  console.log(`targetBundleRoute=${targetBundles[0]?.route.resolvedConsumer ?? "none"}`);
} finally {
  sourceClient.close();
  targetClient.close();
}

console.log("");
console.log("Agent loop example complete.");

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
