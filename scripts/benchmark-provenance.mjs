import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeExecutable = process.execPath;
const benchDirectory = join(root, ".glialnode", "bench-provenance");
const resultDirectory = join(root, "docs", "benchmarks");
const resultPath = join(resultDirectory, "provenance-latest.json");

const datasetSize = parseSize(process.argv.slice(2));
const profiles = [
  { name: "balanced_mix", provenanceEvery: 8 },
  { name: "provenance_heavy", provenanceEvery: 2 },
];

removeIfExists(benchDirectory);
mkdirSync(benchDirectory, { recursive: true });
mkdirSync(resultDirectory, { recursive: true });

runBuild();
const { GlialNodeClient, SqliteMemoryRepository } = await import(pathToFileURL(join(root, "dist", "index.js")).href);

const results = [];
for (const profile of profiles) {
  const benchmark = await runProfileBenchmark(datasetSize, profile, SqliteMemoryRepository, GlialNodeClient);
  results.push(benchmark);
  logProfileSummary(benchmark);
}

const payload = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  datasetSize,
  profiles,
  results,
};

writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
console.log(`\nWrote provenance benchmark results to ${resultPath}`);

async function runProfileBenchmark(size, profile, SqliteMemoryRepository, GlialNodeClient) {
  const databasePath = join(benchDirectory, `${profile.name}-${size}.sqlite`);
  removeIfExists(databasePath);

  const repository = new SqliteMemoryRepository({ filename: databasePath });
  const client = new GlialNodeClient({ repository });
  const space = await client.createSpace({ name: `Provenance ${profile.name}` });
  const scope = await client.addScope({
    spaceId: space.id,
    type: "agent",
    label: "bench",
  });

  const seedStart = process.hrtime.bigint();
  for (let i = 0; i < size; i += 1) {
    const provenance = i % profile.provenanceEvery === 0;
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: provenance ? "summary" : i % 3 === 0 ? "task" : "fact",
      summary: provenance
        ? `Bundle import audit ${i}`
        : `Deployment checklist ${i}`,
      content: provenance
        ? `Bundle import audit record ${i} for trust review and signer policy.`
        : `Deployment checklist record ${i} covering rollout validation and operator steps.`,
      tags: provenance
        ? ["provenance", "bundle", "audit"]
        : ["deployment", "checklist", "operations"],
      importance: provenance ? 0.7 : 0.82,
      confidence: provenance ? 0.86 : 0.84,
      freshness: provenance ? 0.78 : 0.88,
    });
  }
  const seedMs = toMs(process.hrtime.bigint() - seedStart);

  const normalQuery = "deployment checklist validation";
  const provenanceQuery = "bundle import audit trust signer";

  const normalSearch = await measureMedian(async () => {
    await client.searchRecords({ spaceId: space.id, text: normalQuery, limit: 20 });
  }, 5);
  const provenanceSearch = await measureMedian(async () => {
    await client.searchRecords({ spaceId: space.id, text: provenanceQuery, limit: 20 });
  }, 5);

  const normalTop = await client.searchRecords({ spaceId: space.id, text: normalQuery, limit: 20 });
  const provenanceTop = await client.searchRecords({ spaceId: space.id, text: provenanceQuery, limit: 20 });
  const normalTopProvenanceShare = ratio(
    normalTop.filter((record) => record.tags.includes("provenance")).length,
    normalTop.length,
  );
  const provenanceTopProvenanceShare = ratio(
    provenanceTop.filter((record) => record.tags.includes("provenance")).length,
    provenanceTop.length,
  );

  client.close();
  repository.close();

  return {
    profile: profile.name,
    records: size,
    seedMs: round(seedMs),
    normalSearchMs: round(normalSearch),
    provenanceSearchMs: round(provenanceSearch),
    normalTopProvenanceShare: round(normalTopProvenanceShare),
    provenanceTopProvenanceShare: round(provenanceTopProvenanceShare),
  };
}

function parseSize(argv) {
  const sizeArg = argv.find((entry) => entry.startsWith("--size="));
  if (!sizeArg) {
    return 2000;
  }

  const parsed = Number(sizeArg.slice("--size=".length).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

async function measureMedian(task, runs) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    await task();
    samples.push(toMs(process.hrtime.bigint() - start));
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

function ratio(numerator, denominator) {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function logProfileSummary(result) {
  console.log(`\nProfile ${result.profile} (${result.records} records)`);
  console.log(`  seedMs=${result.seedMs}`);
  console.log(`  normalSearchMs=${result.normalSearchMs}`);
  console.log(`  provenanceSearchMs=${result.provenanceSearchMs}`);
  console.log(`  normalTopProvenanceShare=${result.normalTopProvenanceShare}`);
  console.log(`  provenanceTopProvenanceShare=${result.provenanceTopProvenanceShare}`);
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

function removeIfExists(path) {
  const resolved = resolve(path);
  if (existsSync(resolved)) {
    const stats = lstatSync(resolved);
    rmSync(resolved, { recursive: stats.isDirectory(), force: true });
  }
}

function toMs(durationNs) {
  return Number(durationNs) / 1_000_000;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
