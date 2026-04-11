import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("SqliteMemoryRepository tracks applied schema migrations", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-sqlite-migrations-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const firstRepository = new SqliteMemoryRepository({ filename: databasePath });

  try {
    assert.equal(firstRepository.getSchemaVersion(), 2);
    const firstPass = listAppliedSqliteMigrations(firstRepository.db);
    assert.equal(firstPass.length, 2);
    assert.equal(firstPass[0]?.version, 1);
    assert.equal(firstPass[1]?.version, 2);
  } finally {
    firstRepository.close();
  }

  const secondRepository = new SqliteMemoryRepository({ filename: databasePath });

  try {
    assert.equal(secondRepository.getSchemaVersion(), 2);
    const secondPass = listAppliedSqliteMigrations(secondRepository.db);
    assert.equal(secondPass.length, 2);
    assert.equal(secondPass[0]?.version, 1);
    assert.equal(secondPass[1]?.version, 2);
  } finally {
    secondRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
