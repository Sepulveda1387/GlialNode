import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GlialNodeClient } from "../client/index.js";
import { SqliteMemoryRepository } from "../index.js";

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
    assert.equal(report.recordCount, 5);
    assert.ok(report.eventCount >= 2);

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

test("GlialNodeClient maintenance refreshes generated compact memory when it drifts", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-refresh-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = new SqliteMemoryRepository({ filename: databasePath });
  const client = new GlialNodeClient({ repository });

  try {
    const space = await client.createSpace({ name: "Refresh Space" });
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
    });

    await client.updateRecordStatus(record.id, "active");
    const drifted = await client.getRecord(record.id);

    drifted.compactContent = "stale compact text";
    drifted.compactSource = "generated";
    await repository.writeRecord(drifted);

    const maintenance = await client.maintainSpace(space.id, { apply: true });
    assert.equal(maintenance.compactionPlan.refreshed.length, 1);

    const refreshed = await client.getRecord(record.id);
    assert.notEqual(refreshed.compactContent, "stale compact text");
    assert.equal(refreshed.compactSource, "generated");
  } finally {
    client.close();
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient compaction distills related records into a summary with provenance", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-distill-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Distill Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Prefer lexical retrieval first for standard search flows.",
      summary: "Lexical retrieval first",
      tags: ["retrieval", "search"],
      importance: 0.82,
      confidence: 0.8,
      freshness: 0.7,
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical search remains the most reliable default for user-facing memory recall.",
      summary: "Lexical search reliability",
      tags: ["retrieval", "ranking"],
      importance: 0.78,
      confidence: 0.76,
      freshness: 0.68,
    });

    const plan = await client.compactSpace(space.id, { apply: true });
    assert.equal(plan.distilled.length, 1);

    const report = await client.getSpaceReport(space.id, 10);
    assert.ok(report.recordCount >= 3);
    assert.ok(report.eventCount >= 1);

    const distilled = plan.distilled[0]!.distilledRecord;
    const stored = await client.getRecord(distilled.id);
    assert.equal(stored.kind, "summary");
    assert.match(stored.summary ?? "", /Distilled retrieval memory/);

    const links = await client.listLinksForRecord(distilled.id);
    assert.equal(links.length, 5);
    assert.equal(links.filter((link) => link.type === "derived_from").length, 2);
    assert.equal(links.filter((link) => link.type === "supersedes").length, 2);

    const visibleResults = await client.searchRecords({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 10,
    });
    assert.equal(visibleResults.length, 1);
    assert.equal(visibleResults[0]?.id, distilled.id);

    const supersededResults = await client.searchRecords({
      spaceId: space.id,
      text: "lexical retrieval",
      statuses: ["superseded"],
      limit: 10,
    });
    assert.equal(supersededResults.length, 2);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient detects contradictory durable memory and lowers older confidence", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-conflict-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Conflict Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const first = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Prefer lexical retrieval first for search flows.",
      summary: "Prefer lexical retrieval",
      tags: ["retrieval", "search"],
      confidence: 0.9,
      freshness: 0.8,
      importance: 0.85,
    });

    const second = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Avoid lexical retrieval first for search flows.",
      summary: "Avoid lexical retrieval",
      tags: ["retrieval", "search"],
      confidence: 0.88,
      freshness: 0.78,
      importance: 0.84,
    });

    const updatedFirst = await client.getRecord(first.id);
    assert.ok(updatedFirst.confidence < first.confidence);

    const links = await client.listLinksForRecord(second.id);
    assert.equal(links.filter((link) => link.type === "contradicts").length, 1);

    const report = await client.getSpaceReport(space.id, 10);
    assert.match(report.recentLifecycleEvents.map((event) => event.type).join(","), /memory_conflicted/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
