import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createId,
  createMemoryRecord,
  listAppliedSqliteMigrations,
  SqliteMemoryRepository,
  type MemoryEvent,
  type MemorySpace,
  type ScopeRecord,
} from "../index.js";

function createFixtureSpace(): MemorySpace {
  const timestamp = new Date().toISOString();

  return {
    id: createId("space"),
    name: "Planner Workspace",
    description: "Integration test workspace",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createFixtureScope(spaceId: string, type: ScopeRecord["type"] = "agent"): ScopeRecord {
  const timestamp = new Date().toISOString();

  return {
    id: createId("scope"),
    spaceId,
    type,
    label: "planner",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("SqliteMemoryRepository bootstraps, persists records, and retrieves lexical matches", async () => {
  const repository = new SqliteMemoryRepository();
  const space = createFixtureSpace();
  const scope = createFixtureScope(space.id);

  await repository.createSpace(space);
  await repository.upsertScope(scope);

  const event: MemoryEvent = {
    id: createId("evt"),
    spaceId: space.id,
    scope: {
      id: scope.id,
      type: scope.type,
    },
    actorType: "agent",
    actorId: "planner-1",
    type: "decision_made",
    summary: "Chose lexical retrieval first",
    payload: { retrieval: "fts5" },
    createdAt: new Date().toISOString(),
  };

  await repository.appendEvent(event);

  const primaryRecord = createMemoryRecord({
    spaceId: space.id,
    tier: "mid",
    kind: "decision",
    content: "Use lexical retrieval first for GlialNode memory search.",
    summary: "Lexical retrieval decision",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "fts5"],
    importance: 0.9,
    confidence: 0.95,
    freshness: 0.75,
    sourceEventId: event.id,
  });

  const secondaryRecord = createMemoryRecord({
    spaceId: space.id,
    tier: "long",
    kind: "fact",
    content: "Store durable project conventions in long-term memory.",
    summary: "Long-term memory note",
    scope: { id: scope.id, type: scope.type },
    tags: ["memory"],
    importance: 0.6,
    confidence: 0.8,
    freshness: 0.5,
  });

  await repository.writeRecord(primaryRecord);
  await repository.writeRecord(secondaryRecord);

  const matches = await repository.searchRecords({
    spaceId: space.id,
    text: "lexical retrieval",
    limit: 10,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, primaryRecord.id);
  assert.deepEqual(matches[0]?.tags, ["retrieval", "fts5"]);

  repository.close();
});

test("SqliteMemoryRepository lists spaces and scopes", async () => {
  const repository = new SqliteMemoryRepository();
  const space = createFixtureSpace();
  const orchestratorScope = createFixtureScope(space.id, "orchestrator");

  await repository.createSpace(space);
  await repository.upsertScope(orchestratorScope);

  const spaces = await repository.listSpaces();
  const scopes = await repository.listScopes(space.id);

  assert.equal(spaces.length, 1);
  assert.equal(spaces[0]?.id, space.id);
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0]?.type, "orchestrator");

  repository.close();
});

test("SqliteMemoryRepository applies durable defaults for file-backed databases", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-runtime-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = new SqliteMemoryRepository({ filename: databasePath });

  try {
    const runtime = repository.getRuntimeSettings();

    assert.equal(runtime.filename, databasePath);
    assert.equal(runtime.journalMode, "WAL");
    assert.equal(runtime.synchronous, "NORMAL");
    assert.equal(runtime.busyTimeoutMs, 5000);
    assert.equal(runtime.foreignKeys, true);
    assert.equal(runtime.writeMode, "single_writer");
    assert.match(runtime.writeGuarantees.join(" "), /One writer should own durable mutations/i);
    assert.match(runtime.writeNonGoals.join(" "), /does not provide a cross-process write broker/i);

    if (runtime.defensive !== null) {
      assert.equal(runtime.defensive, true);
    }
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMemoryRepository honors busy timeout during write contention", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-lock-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const firstRepository = new SqliteMemoryRepository({
    filename: databasePath,
    connection: {
      busyTimeoutMs: 50,
    },
  });
  const secondRepository = new SqliteMemoryRepository({
    filename: databasePath,
    connection: {
      busyTimeoutMs: 50,
    },
  });

  try {
    const initialSpace = createFixtureSpace();

    await firstRepository.createSpace(initialSpace);
    firstRepository.db.exec("BEGIN IMMEDIATE");

    const contenderSpace = createFixtureSpace();
    const startedAt = Date.now();

    await assert.rejects(
      secondRepository.createSpace(contenderSpace),
      /database is locked|SQLITE_BUSY/i,
    );

    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs >= 25);
    assert.equal(secondRepository.getRuntimeSettings().busyTimeoutMs, 50);
  } finally {
    try {
      firstRepository.db.exec("ROLLBACK");
    } catch {
      // Transaction may already be closed if the test failed earlier.
    }

    firstRepository.close();
    secondRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMemoryRepository surfaces the single-writer contract under two-process contention", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-2proc-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const helperPath = join(tempDirectory, "sqlite-contention-helper.mjs");
  const indexUrl = pathToFileURL(join(process.cwd(), "dist", "index.js")).href;

  writeFileSync(
    helperPath,
    `
import { SqliteMemoryRepository, createId } from ${JSON.stringify(indexUrl)};

const [, , mode, filename, busyTimeoutText, holdMsText] = process.argv;
const busyTimeoutMs = Number(busyTimeoutText ?? "75");
const holdMs = Number(holdMsText ?? "250");
const repository = new SqliteMemoryRepository({
  filename,
  connection: { busyTimeoutMs },
});

const now = new Date().toISOString();
const space = {
  id: createId("space"),
  name: mode === "holder" ? "Holder Space" : "Contender Space",
  createdAt: now,
  updatedAt: now,
};

if (mode === "holder") {
  await repository.createSpace(space);
  repository.db.exec("BEGIN IMMEDIATE");
  process.stdout.write("locked\\n");
  setTimeout(() => {
    try {
      repository.db.exec("ROLLBACK");
    } catch {}
    repository.close();
    process.exit(0);
  }, holdMs);
} else {
  const startedAt = Date.now();
  try {
    await repository.createSpace(space);
    process.stdout.write(JSON.stringify({ ok: true, elapsedMs: Date.now() - startedAt }) + "\\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    }) + "\\n");
  } finally {
    repository.close();
  }
}
`,
    "utf8",
  );

  const holder = spawn(process.execPath, [helperPath, "holder", databasePath, "75", "300"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onStdout = (chunk: Buffer | string) => {
        if (chunk.toString().includes("locked")) {
          holder.stdout?.off("data", onStdout);
          resolve();
        }
      };
      holder.stdout?.on("data", onStdout);
      holder.once("error", reject);
      holder.once("exit", (code) => {
        reject(new Error(`Holder process exited before locking the database (code=${code ?? "null"}).`));
      });
    });

    const contender = spawnSync(process.execPath, [helperPath, "contender", databasePath, "75", "0"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5000,
    });

    assert.equal(contender.status, 0, contender.stderr);
    const result = JSON.parse(contender.stdout.trim()) as {
      ok: boolean;
      elapsedMs: number;
      message?: string;
    };
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /database is locked|SQLITE_BUSY/i);
    assert.ok(result.elapsedMs >= 40, `expected busy timeout delay, got ${result.elapsedMs}ms`);
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) {
      holder.kill();
      await new Promise((resolve) => holder.once("exit", resolve));
    }
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMemoryRepository can expose a serialized-local write contract without changing SQLite semantics", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-write-mode-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = new SqliteMemoryRepository({
    filename: databasePath,
    connection: {
      writeMode: "serialized_local",
    },
  });

  try {
    const runtime = repository.getRuntimeSettings();

    assert.equal(runtime.writeMode, "serialized_local");
    assert.match(runtime.writeGuarantees.join(" "), /Caller serializes writes within one local coordination boundary/i);
    assert.equal(runtime.journalMode, "WAL");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMemoryRepository tracks applied schema migrations", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-migrations-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const firstRepository = new SqliteMemoryRepository({ filename: databasePath });

  try {
    assert.equal(firstRepository.getSchemaVersion(), 3);
    const firstPass = listAppliedSqliteMigrations(firstRepository.db);
    assert.equal(firstPass.length, 3);
    assert.equal(firstPass[0]?.version, 1);
    assert.equal(firstPass[1]?.version, 2);
    assert.equal(firstPass[2]?.version, 3);
  } finally {
    firstRepository.close();
  }

  const secondRepository = new SqliteMemoryRepository({ filename: databasePath });

  try {
    assert.equal(secondRepository.getSchemaVersion(), 3);
    const secondPass = listAppliedSqliteMigrations(secondRepository.db);
    assert.equal(secondPass.length, 3);
    assert.equal(secondPass[0]?.version, 1);
    assert.equal(secondPass[1]?.version, 2);
    assert.equal(secondPass[2]?.version, 3);
  } finally {
    secondRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("SqliteMemoryRepository retrieval prefers distilled summaries for broad recall", async () => {
  const repository = new SqliteMemoryRepository();
  const space = createFixtureSpace();
  const scope = createFixtureScope(space.id);

  await repository.createSpace(space);
  await repository.upsertScope(scope);

  const sourceDecision = createMemoryRecord({
    spaceId: space.id,
    tier: "mid",
    kind: "decision",
    content: "Prefer lexical retrieval first for standard search flows.",
    summary: "Lexical retrieval first",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "search"],
    importance: 0.82,
    confidence: 0.8,
    freshness: 0.68,
    status: "superseded",
  });

  const distilledSummary = createMemoryRecord({
    spaceId: space.id,
    tier: "long",
    kind: "summary",
    content: "Distilled memory from related retrieval records: lexical retrieval first; lexical search reliability.",
    summary: "Distilled retrieval memory",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "distilled", "compaction"],
    importance: 0.8,
    confidence: 0.9,
    freshness: 0.66,
  });

  await repository.writeRecord(sourceDecision);
  await repository.writeRecord(distilledSummary);

  const broadMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "distilled retrieval memory",
    limit: 10,
  });

  assert.equal(broadMatches[0]?.id, distilledSummary.id);

  const supersededMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "lexical retrieval first",
    statuses: ["superseded"],
    limit: 10,
  });

  assert.equal(supersededMatches[0]?.id, sourceDecision.id);

  repository.close();
});

test("SqliteMemoryRepository retrieval still surfaces specific raw records when the query is narrow", async () => {
  const repository = new SqliteMemoryRepository();
  const space = createFixtureSpace();
  const scope = createFixtureScope(space.id);

  await repository.createSpace(space);
  await repository.upsertScope(scope);

  const distilledSummary = createMemoryRecord({
    spaceId: space.id,
    tier: "long",
    kind: "summary",
    content: "Distilled memory from related retrieval records: lexical retrieval first; lexical search reliability.",
    summary: "Distilled retrieval memory",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "distilled", "compaction"],
    importance: 0.8,
    confidence: 0.9,
    freshness: 0.66,
  });

  const specificDecision = createMemoryRecord({
    spaceId: space.id,
    tier: "mid",
    kind: "decision",
    content: "Prefer lexical retrieval first for standard search flows.",
    summary: "Lexical retrieval decision",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "search"],
    importance: 0.78,
    confidence: 0.84,
    freshness: 0.8,
  });

  await repository.writeRecord(distilledSummary);
  await repository.writeRecord(specificDecision);

  const matches = await repository.searchRecords({
    spaceId: space.id,
    text: "decision lexical retrieval first",
    limit: 10,
  });

  assert.equal(matches[0]?.id, specificDecision.id);

  repository.close();
});

test("SqliteMemoryRepository safely handles punctuation-heavy FTS queries", async () => {
  const repository = new SqliteMemoryRepository();
  const space = createFixtureSpace();
  const scope = createFixtureScope(space.id);

  await repository.createSpace(space);
  await repository.upsertScope(scope);

  const importedRecord = createMemoryRecord({
    spaceId: space.id,
    tier: "mid",
    kind: "summary",
    content: 'Bundle import audit for team-executor-imported with trust:anchored and reviewer("strict") context.',
    summary: "team-executor-imported bundle import audit",
    scope: { id: scope.id, type: scope.type },
    tags: ["bundle-import", "team-executor-imported", "trust:anchored"],
    importance: 0.86,
    confidence: 0.91,
    freshness: 0.79,
  });

  const wildcardRecord = createMemoryRecord({
    spaceId: space.id,
    tier: "mid",
    kind: "fact",
    content: "Retrieval wildcard guidance covers retrieval flows and safe query parsing.",
    summary: "retrieval wildcard guidance",
    scope: { id: scope.id, type: scope.type },
    tags: ["retrieval", "query"],
    importance: 0.7,
    confidence: 0.82,
    freshness: 0.73,
  });

  await repository.writeRecord(importedRecord);
  await repository.writeRecord(wildcardRecord);

  const dashedMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "team-executor-imported",
    limit: 10,
  });
  assert.equal(dashedMatches[0]?.id, importedRecord.id);

  const quotedMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "\"Bundle import audit\"",
    limit: 10,
  });
  assert.equal(quotedMatches[0]?.id, importedRecord.id);

  const colonMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "trust:anchored",
    limit: 10,
  });
  assert.equal(colonMatches[0]?.id, importedRecord.id);

  const parenthesisMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "reviewer(\"strict\")",
    limit: 10,
  });
  assert.equal(parenthesisMatches[0]?.id, importedRecord.id);

  const wildcardMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "retrieval*",
    limit: 10,
  });
  assert.equal(wildcardMatches[0]?.id, wildcardRecord.id);

  const whitespaceMatches = await repository.searchRecords({
    spaceId: space.id,
    text: "   ",
    limit: 10,
  });
  assert.equal(whitespaceMatches.length, 2);

  repository.close();
});
