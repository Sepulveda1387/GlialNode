import test from "node:test";
import assert from "node:assert/strict";

import {
  createId,
  createMemoryRecord,
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
