import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GlialNodeClient } from "../client/index.js";

test("GlialNodeClient supports the core programmatic memory workflow", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "SDK Space",
      settings: {
        retentionDays: {
          short: 0,
        },
      },
    });

    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const promotable = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "short",
      kind: "task",
      content: "Promote this through the client API.",
      summary: "Promotable client record",
      importance: 0.95,
      confidence: 0.9,
      freshness: 0.8,
    });

    const expirable = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "short",
      kind: "task",
      content: "Expire this through the client API.",
      summary: "Expirable client record",
    });

    const searchResults = await client.searchRecords({
      spaceId: space.id,
      text: "client API",
      limit: 10,
    });

    assert.equal(searchResults.length, 2);

    const maintenance = await client.maintainSpace(space.id, { apply: true });
    assert.equal(maintenance.applied, true);
    assert.equal(maintenance.compactionPlan.promoted.length, 1);
    assert.equal(maintenance.retentionPlan.expired.length, 1);

    const report = await client.getSpaceReport(space.id, 10);
    assert.equal(report.recordCount, 4);
    assert.equal(report.eventCount, 2);

    const promotedRecord = await client.getRecord(promotable.id);
    const expiredRecord = await client.getRecord(expirable.id);
    assert.equal(promotedRecord.tier, "mid");
    assert.equal(expiredRecord.status, "expired");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export and import a snapshot without the CLI", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-export-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const sourceClient = new GlialNodeClient({ filename: sourcePath });
  const targetClient = new GlialNodeClient({ filename: targetPath });

  try {
    const space = await sourceClient.createSpace({ name: "Portable Space" });
    const scope = await sourceClient.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });

    const record = await sourceClient.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Prefer lexical retrieval first.",
      summary: "Retrieval preference",
    });

    await sourceClient.addEvent({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      actorType: "agent",
      actorId: "writer-1",
      type: "decision_made",
      summary: "Captured a durable retrieval preference.",
    });

    const snapshot = await sourceClient.exportSpace(space.id);
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.events.length, 1);

    await targetClient.importSnapshot(snapshot);

    const importedSpace = await targetClient.getSpace(space.id);
    const importedRecords = await targetClient.searchRecords({
      spaceId: importedSpace.id,
      text: "lexical retrieval",
      limit: 10,
    });

    assert.equal(importedRecords.length, 1);
    assert.equal(importedRecords[0]?.id, record.id);
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient stores and retrieves compact memory content", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-compact-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Compact Client Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const record = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Prefer lexical retrieval first.",
      summary: "Lexical retrieval",
      compactContent: "U:req retrieval=lexical_first",
    });

    assert.equal(record.compactContent, "U:req retrieval=lexical_first");

    const found = await client.searchRecords({
      spaceId: space.id,
      text: "lexical_first",
      limit: 10,
    });

    assert.equal(found.length, 1);
    assert.equal(found[0]?.compactContent, "U:req retrieval=lexical_first");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
