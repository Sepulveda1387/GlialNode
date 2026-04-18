import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeExecutable = process.execPath;
const benchDirectory = join(root, ".glialnode", "bench");
const resultDirectory = join(root, "docs", "benchmarks");
const resultPath = join(resultDirectory, "latest.json");
const datasetSizes = parseSizes(process.argv.slice(2));

removeIfExists(benchDirectory);
mkdirSync(benchDirectory, { recursive: true });
mkdirSync(resultDirectory, { recursive: true });

runBuild();
const { GlialNodeClient, SqliteMemoryRepository, createId } = await import(pathToFileURL(join(root, "dist", "index.js")).href);

const results = [];
for (const size of datasetSizes) {
  console.log(`Running benchmark dataset ${size.toLocaleString()} records...`);
  const benchmark = await runDatasetBenchmark(size, SqliteMemoryRepository, GlialNodeClient, createId);
  results.push(benchmark);
  logDatasetSummary(benchmark);
}

const payload = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: `${process.platform} ${process.arch}`,
  cpuModel: os.cpus()[0]?.model ?? "unknown",
  totalMemoryBytes: os.totalmem(),
  datasetSizes,
  results,
};

writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");

console.log("");
console.log(`Wrote benchmark results to ${resultPath}`);

async function runDatasetBenchmark(size, SqliteMemoryRepository, GlialNodeClient, createId) {
  const databasePath = join(benchDirectory, `bench-${size}.sqlite`);
  removeIfExists(databasePath);
  const repository = new SqliteMemoryRepository({ filename: databasePath });
  const client = new GlialNodeClient({ repository });

  const spaceId = createId("space");
  const scopeId = createId("scope");
  const timestamp = new Date().toISOString();

  await repository.createSpace({
    id: spaceId,
    name: `Benchmark ${size}`,
    settings: {
      retentionDays: { short: 7, mid: 30, long: 90 },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await repository.upsertScope({
    id: scopeId,
    spaceId,
    type: "agent",
    label: "benchmark",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const seedStart = process.hrtime.bigint();
  seedRecords(repository, {
    size,
    spaceId,
    scopeId,
    createId,
  });
  const seedMs = toMs(process.hrtime.bigint() - seedStart);

  const queryText = "policy memory retrieval";
  await client.searchRecords({ spaceId, text: queryText, limit: 20 });
  await client.recallRecords({ spaceId, text: queryText, primaryLimit: 3, supportLimit: 3 });
  await client.bundleRecall({ spaceId, text: queryText, limit: 3, supportLimit: 3, bundleConsumer: "auto" });
  await client.maintainSpace(spaceId, { apply: false });
  await client.getSpaceReport(spaceId, 10);

  const profile = resolveRunProfile(size);
  const metrics = {
    searchMs: await measureMedian(async () => {
      await client.searchRecords({ spaceId, text: queryText, limit: 20 });
    }, profile.searchRuns),
    recallMs: await measureMedian(async () => {
      await client.recallRecords({ spaceId, text: queryText, primaryLimit: 3, supportLimit: 3 });
    }, profile.recallRuns),
    bundleBuildMs: await measureMedian(async () => {
      await client.bundleRecall({ spaceId, text: queryText, limit: 3, supportLimit: 3, bundleConsumer: "auto" });
    }, profile.bundleRuns),
    compactionDryRunMs: await measureMedian(async () => {
      await client.maintainSpace(spaceId, { apply: false });
    }, profile.compactionRuns),
    reportMs: await measureMedian(async () => {
      await client.getSpaceReport(spaceId, 10);
    }, profile.reportRuns),
  };

  client.close();
  repository.close();

  return {
    records: size,
    seedMs: round(seedMs),
    ...Object.fromEntries(
      Object.entries(metrics).map(([key, value]) => [key, round(value)]),
    ),
  };
}

function seedRecords(repository, options) {
  const { size, spaceId, scopeId } = options;
  const insertRecord = repository.db.prepare(
    `
    INSERT INTO memory_records (
      id, space_id, scope_id, tier, kind, content, summary, compact_content, compact_source, visibility, status, tags_json,
      importance, confidence, freshness, source_event_id, expires_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const tiers = ["short", "mid", "long"];
  const kinds = ["fact", "decision", "task", "summary", "artifact"];
  const statuses = ["active", "active", "active", "superseded", "archived"];
  const baseEpoch = Date.parse("2026-01-01T00:00:00.000Z");

  repository.db.exec("BEGIN");
  try {
    for (let i = 0; i < size; i += 1) {
      const tier = tiers[i % tiers.length];
      const kind = kinds[i % kinds.length];
      const status = statuses[i % statuses.length];
      const createdAt = new Date(baseEpoch + i * 1000).toISOString();
      const updatedAt = new Date(baseEpoch + i * 1000 + 500).toISOString();
      const token = i % 17;
      const content = `Memory ${i} policy memory retrieval token-${token} reliability operations context`;
      const summary = `Benchmark record ${i} token-${token}`;
      const tags = JSON.stringify([
        "bench",
        `token-${token}`,
        i % 5 === 0 ? "provenance" : "ops",
        i % 3 === 0 ? "maintenance" : "retrieval",
      ]);

      insertRecord.run(
        `record_bench_${i.toString().padStart(6, "0")}`,
        spaceId,
        scopeId,
        tier,
        kind,
        content,
        summary,
        null,
        "generated",
        "space",
        status,
        tags,
        0.35 + ((i % 60) / 100),
        0.3 + ((i % 70) / 100),
        0.25 + ((i % 75) / 100),
        null,
        null,
        createdAt,
        updatedAt,
      );
    }
    repository.db.exec("COMMIT");
  } catch (error) {
    repository.db.exec("ROLLBACK");
    throw error;
  }
}

async function measureMedian(task, runs) {
  if (runs <= 1) {
    const start = process.hrtime.bigint();
    await task();
    return toMs(process.hrtime.bigint() - start);
  }

  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    await task();
    samples.push(toMs(process.hrtime.bigint() - start));
  }

  samples.sort((left, right) => left - right);
  const midpoint = Math.floor(samples.length / 2);
  return samples[midpoint];
}

function logDatasetSummary(result) {
  console.log("");
  console.log(`Dataset ${result.records.toLocaleString()} records`);
  console.log(`  seedMs=${result.seedMs}`);
  console.log(`  searchMs=${result.searchMs}`);
  console.log(`  recallMs=${result.recallMs}`);
  console.log(`  bundleBuildMs=${result.bundleBuildMs}`);
  console.log(`  compactionDryRunMs=${result.compactionDryRunMs}`);
  console.log(`  reportMs=${result.reportMs}`);
}

function parseSizes(argv) {
  const sizeArg = argv.find((entry) => entry.startsWith("--sizes="));
  if (!sizeArg) {
    return [1000, 10000, 50000];
  }

  const values = sizeArg
    .slice("--sizes=".length)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? values : [1000, 10000, 50000];
}

function resolveRunProfile(size) {
  if (size >= 50_000) {
    return {
      searchRuns: 1,
      recallRuns: 1,
      bundleRuns: 1,
      compactionRuns: 1,
      reportRuns: 1,
    };
  }

  if (size >= 10_000) {
    return {
      searchRuns: 3,
      recallRuns: 3,
      bundleRuns: 3,
      compactionRuns: 1,
      reportRuns: 3,
    };
  }

  return {
    searchRuns: 5,
    recallRuns: 5,
    bundleRuns: 5,
    compactionRuns: 3,
    reportRuns: 5,
  };
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
    rmSync(resolved, { force: true, recursive: stats.isDirectory() });
  }
}

function toMs(durationNs) {
  return Number(durationNs) / 1_000_000;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
