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

test("GlialNodeClient can create a space from a preset", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Preset Space",
      preset: "execution-first",
    });

    assert.equal(space.settings?.routing?.preferExecutorOnActionable, true);
    assert.equal(space.settings?.routing?.preferPlannerOnDistilled, false);
    assert.equal(space.settings?.compaction?.shortPromoteImportanceMin, 0.78);
    assert.equal(space.settings?.reinforcement?.confidenceBoost, 0.1);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can inspect available presets", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-inspect-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const presets = client.listPresets();
    assert.ok(presets.length >= 4);
    assert.ok(presets.some((preset) => preset.name === "conservative-review"));

    const preset = client.getPreset("planning-heavy");
    assert.match(preset.summary, /planner-oriented/i);
    assert.equal(preset.settings.routing?.preferPlannerOnDistilled, true);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can diff preset definitions", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-diff-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const left = client.getPreset("execution-first");
    const right = client.getPreset("conservative-review");
    const diff = client.diffPresets(left, right);

    assert.equal(diff.left.name, "execution-first");
    assert.equal(diff.right.name, "conservative-review");
    assert.ok(diff.metadata.some((change) => change.path === "summary"));
    assert.ok(diff.settings.some((change) => change.path === "settings.routing.preferExecutorOnActionable"));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export and load preset files for custom space setup", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-file-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const exported = client.exportPreset("execution-first", presetPath);
    assert.equal(exported.name, "execution-first");

    const loaded = client.loadPreset(presetPath);
    assert.equal(loaded.name, "execution-first");
    assert.equal(loaded.settings.routing?.preferExecutorOnActionable, true);

    const space = await client.createSpace({
      name: "Custom Preset Space",
      presetDefinition: loaded,
    });
    assert.equal(space.settings?.routing?.preferExecutorOnActionable, true);
    assert.equal(space.settings?.routing?.preferPlannerOnDistilled, false);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can register and reload local preset files", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-registry-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    const registered = client.registerPreset(presetPath, {
      name: "team-executor",
      author: "GlialNode Test",
      version: "2.1.0",
    });
    assert.equal(registered.name, "team-executor");
    assert.equal(registered.author, "GlialNode Test");
    assert.equal(registered.version, "2.1.0");

    const listed = client.listRegisteredPresets();
    assert.ok(listed.some((preset) => preset.name === "team-executor"));

    const loaded = client.getRegisteredPreset("team-executor");
    assert.equal(loaded.settings.routing?.preferExecutorOnActionable, true);
    assert.equal(loaded.settings.routing?.preferPlannerOnDistilled, false);
    assert.equal(loaded.author, "GlialNode Test");
    assert.equal(loaded.version, "2.1.0");
    assert.ok(loaded.source?.endsWith("execution-first.json"));

    const history = client.listRegisteredPresetHistory("team-executor");
    assert.equal(history.length, 1);
    assert.equal(history[0]?.version, "2.1.0");
    assert.equal(history[0]?.author, "GlialNode Test");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can roll back a registered preset to an earlier version", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-rollback-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      author: "GlialNode Test",
      version: "2.1.0",
    });

    client.exportPreset("planning-heavy", alternatePresetPath);
    client.registerPreset(alternatePresetPath, {
      name: "team-executor",
      author: "GlialNode Test",
      version: "2.2.0",
    });

    const rolledBack = client.rollbackRegisteredPreset("team-executor", {
      version: "2.1.0",
      author: "Rollback Test",
    });

    assert.equal(rolledBack.version, "2.1.0");
    assert.equal(rolledBack.author, "Rollback Test");
    assert.equal(rolledBack.source, "rollback:2.1.0");
    assert.equal(rolledBack.settings.routing?.preferPlannerOnDistilled, false);

    const current = client.getRegisteredPreset("team-executor");
    assert.equal(current.version, "2.1.0");
    assert.equal(current.source, "rollback:2.1.0");

    const history = client.listRegisteredPresetHistory("team-executor");
    assert.ok(history.length >= 3);
    assert.ok(history.some((preset) => preset.version === "2.2.0"));
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

test("GlialNodeClient decay lowers stale durable memory trust", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-decay-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Decay Space",
      settings: {
        decay: {
          minAgeDays: 0,
          confidenceDecayPerDay: 0.05,
          freshnessDecayPerDay: 0.1,
          minConfidence: 0.2,
          minFreshness: 0.15,
        },
      },
    });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const record = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "fact",
      content: "Lexical retrieval is the default memory strategy.",
      summary: "Retrieval default",
      tags: ["retrieval"],
      confidence: 0.9,
      freshness: 0.8,
      importance: 0.85,
    });

    const decayPlan = await client.decaySpace(space.id, { apply: true, now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });
    assert.equal(decayPlan.decayed.length, 1);

    const updated = await client.getRecord(record.id);
    assert.ok(updated.confidence < record.confidence);
    assert.ok(updated.freshness < record.freshness);

    const report = await client.getSpaceReport(space.id, 10);
    assert.match(report.recentLifecycleEvents.map((event) => event.type).join(","), /memory_decayed/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient reinforcement strengthens a durable memory explicitly", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-reinforce-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Reinforcement Space",
      settings: {
        reinforcement: {
          confidenceBoost: 0.05,
          freshnessBoost: 0.1,
          maxConfidence: 0.96,
          maxFreshness: 0.92,
        },
      },
    });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const record = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Prefer lexical retrieval first for stable search flows.",
      summary: "Retrieval preference",
      confidence: 0.7,
      freshness: 0.45,
      importance: 0.82,
    });

    const plan = await client.reinforceRecord(record.id, {
      reason: "operator-confirmed",
      strength: 2,
    });
    assert.equal(plan.reinforced.length, 1);

    const updated = await client.getRecord(record.id);
    assert.equal(updated.confidence, 0.8);
    assert.equal(updated.freshness, 0.65);

    const report = await client.getSpaceReport(space.id, 10);
    assert.match(report.recentLifecycleEvents.map((event) => event.type).join(","), /memory_reinforced/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can reinforce successful search results when explicitly requested", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-search-reinforce-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Search Reinforcement Space",
      settings: {
        reinforcement: {
          confidenceBoost: 0.04,
          freshnessBoost: 0.08,
          maxConfidence: 0.95,
          maxFreshness: 0.9,
        },
      },
    });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const record = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "fact",
      content: "Lexical retrieval remains the preferred default for confirmed search flows.",
      summary: "Preferred retrieval default",
      confidence: 0.7,
      freshness: 0.4,
      importance: 0.84,
    });

    const results = await client.searchRecords(
      {
        spaceId: space.id,
        text: "preferred retrieval default",
        limit: 5,
      },
      {
        reinforce: {
          enabled: true,
          strength: 2,
          limit: 1,
        },
      },
    );
    assert.equal(results.length, 1);

    const updated = await client.getRecord(record.id);
    assert.equal(updated.confidence, 0.78);
    assert.equal(updated.freshness, 0.56);

    const report = await client.getSpaceReport(space.id, 10);
    assert.match(report.recentLifecycleEvents.map((event) => event.type).join(","), /memory_reinforced/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can build recall packs with supporting memory", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-recall-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Recall Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Prefer lexical retrieval first for stable search flows.",
      summary: "Lexical retrieval decision",
      tags: ["retrieval", "search"],
      confidence: 0.84,
      freshness: 0.78,
      importance: 0.88,
    });

    const supporting = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval is easier to debug than a heavier semantic stack.",
      summary: "Lexical debugging benefit",
      tags: ["retrieval", "debugging"],
      confidence: 0.8,
      freshness: 0.7,
      importance: 0.76,
    });

    const distilled = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "summary",
      content: "Distilled retrieval memory for lexical-first search defaults.",
      summary: "Distilled retrieval memory",
      tags: ["retrieval", "distilled"],
      confidence: 0.86,
      freshness: 0.74,
      importance: 0.83,
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: supporting.id,
      type: "supports",
    });

    const packs = await client.recallRecords({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 3,
    }, {
      primaryLimit: 1,
      supportLimit: 3,
    });

    assert.equal(packs.length, 1);
    assert.equal(packs[0]?.primary.id, primary.id);
    assert.ok(packs[0]?.supporting.some((record) => record.id === supporting.id));
    assert.ok(packs[0]?.supporting.some((record) => record.id === distilled.id));
    assert.ok((packs[0]?.links.length ?? 0) >= 1);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can build structured recall traces with citations", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-trace-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Trace Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Prefer lexical retrieval first for stable search flows.",
      summary: "Lexical retrieval decision",
      tags: ["retrieval", "search"],
      confidence: 0.84,
      freshness: 0.78,
      importance: 0.88,
    });

    const support = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval is easier to debug than a heavier semantic stack.",
      summary: "Lexical debugging benefit",
      tags: ["retrieval", "debugging"],
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: support.id,
      type: "supports",
    });

    const traces = await client.traceRecall({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 1,
    }, {
      primaryLimit: 1,
      supportLimit: 3,
    });

    assert.equal(traces.length, 1);
    assert.match(traces[0]?.summary ?? "", /Recalled/);
    assert.ok(traces[0]?.citations.some((citation) => citation.recordId === primary.id));
    assert.ok(traces[0]?.citations.some((citation) => citation.role === "primary"));
    assert.ok(traces[0]?.citations.some((citation) => citation.recordId === support.id));
    assert.ok(traces[0]?.citations.some((citation) => citation.relation === "supports"));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can build reusable memory bundles", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Prefer lexical retrieval first for stable search flows.",
      summary: "Lexical retrieval decision",
      compactContent: "U:req retrieval=lexical_first",
      tags: ["retrieval", "search"],
    });

    const support = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval is easier to debug than a heavier semantic stack.",
      summary: "Lexical debugging benefit",
      compactContent: "F:retrieval debug=easy",
      tags: ["retrieval", "debugging"],
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: support.id,
      type: "supports",
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 1,
    }, {
      primaryLimit: 1,
      supportLimit: 3,
    });

    assert.equal(bundles.length, 1);
    assert.match(bundles[0]?.trace.summary ?? "", /Recalled/);
    assert.ok(bundles[0]?.primary.compactContent);
    assert.ok(
      bundles[0]?.primary.annotations.includes("actionable") ||
      bundles[0]?.supporting.some((entry) => entry.annotations.includes("actionable")),
    );
    assert.ok(
      bundles[0]?.primary.recordId === support.id ||
      bundles[0]?.supporting.some((entry) => entry.recordId === support.id),
    );
    assert.ok(bundles[0]?.links.some((link) => link.type === "supports"));
    assert.ok(
      bundles[0]?.hints.includes("actionable_primary") ||
      bundles[0]?.primary.annotations.includes("actionable") ||
      bundles[0]?.supporting.some((entry) => entry.annotations.includes("actionable")),
    );
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient bundle policies can prune and compact handoff payloads", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-policy-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Policy Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "decision",
      content: "Prefer lexical retrieval first for stable search flows and operational debugging.",
      summary: "Lexical retrieval decision",
      compactContent: "U:req retrieval=lexical_first",
      tags: ["retrieval", "search"],
      importance: 0.92,
      confidence: 0.85,
      freshness: 0.8,
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval remains easier to debug than a heavier semantic stack.",
      summary: "Lexical debugging benefit",
      compactContent: "F:retrieval debug=easy",
      tags: ["retrieval", "debugging"],
      importance: 0.7,
      confidence: 0.7,
      freshness: 0.65,
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval uses simpler ranking signals and predictable filters.",
      summary: "Lexical ranking simplicity",
      compactContent: "F:retrieval ranking=simple",
      tags: ["retrieval", "ranking"],
      importance: 0.68,
      confidence: 0.69,
      freshness: 0.64,
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 1,
    }, {
      primaryLimit: 1,
      supportLimit: 4,
      bundleProfile: "executor",
      bundleMaxSupporting: 1,
      bundleMaxContentChars: 18,
      bundlePreferCompact: true,
    });

    assert.equal(bundles.length, 1);
    assert.ok((bundles[0]?.supporting.length ?? 0) <= 1);
    assert.ok((bundles[0]?.primary.content.length ?? 0) <= 18);
    assert.match(bundles[0]?.primary.content ?? "", /\.\.\.$/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient bundle annotations flag stale and contested memory", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-annotations-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Annotation Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const distilled = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "summary",
      content: "Distilled retrieval memory with stale confidence.",
      summary: "Distilled retrieval memory",
      tags: ["retrieval", "distilled"],
      confidence: 0.3,
      freshness: 0.3,
      importance: 0.7,
    });

    const superseded = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Legacy retrieval decision that is now superseded.",
      summary: "Legacy retrieval decision",
      status: "superseded",
      tags: ["retrieval"],
      confidence: 0.6,
      freshness: 0.4,
      importance: 0.68,
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: distilled.id,
      toRecordId: superseded.id,
      type: "references",
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "retrieval",
      limit: 1,
    }, {
      primaryLimit: 1,
      supportLimit: 4,
    });

    assert.equal(bundles.length, 1);
    assert.ok(bundles[0]?.hints.includes("contains_stale_memory"));
    assert.ok(bundles[0]?.hints.includes("contains_superseded_memory"));
    assert.ok(
      bundles[0]?.primary.annotations.includes("distilled") ||
      bundles[0]?.supporting.some((entry) => entry.annotations.includes("distilled")),
    );
    assert.ok(
      bundles[0]?.primary.recordId === superseded.id ||
      bundles[0]?.supporting.some((entry) => entry.recordId === superseded.id),
    );
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can auto-route bundles toward reviewer context when memory is risky", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-routing-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Routing Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "summary",
      content: "Distilled retrieval memory that now needs review before reuse.",
      summary: "Distilled retrieval memory",
      tags: ["retrieval", "distilled"],
      confidence: 0.3,
      freshness: 0.28,
      importance: 0.72,
    });

    const contested = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Legacy retrieval decision that has been superseded.",
      summary: "Legacy retrieval decision",
      status: "superseded",
      tags: ["retrieval"],
      confidence: 0.58,
      freshness: 0.42,
      importance: 0.67,
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: contested.id,
      type: "references",
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "retrieval",
      limit: 1,
    }, {
      primaryLimit: 1,
      supportLimit: 4,
      bundleConsumer: "auto",
    });

    assert.equal(bundles.length, 1);
    assert.equal(bundles[0]?.route.resolvedConsumer, "reviewer");
    assert.equal(bundles[0]?.route.profileUsed, "reviewer");
    assert.equal(bundles[0]?.route.source, "auto");
    assert.ok(bundles[0]?.route.warnings.includes("contains_stale_memory"));
    assert.ok(bundles[0]?.route.warnings.includes("contains_superseded_memory"));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient space routing policy can override auto-routing defaults", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-routing-policy-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Routing Policy Space",
      settings: {
        routing: {
          preferReviewerOnContested: false,
          preferReviewerOnStale: false,
          preferPlannerOnDistilled: true,
        },
      },
    });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const primary = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "long",
      kind: "summary",
      content: "Distilled retrieval memory that is stale but still useful for planning.",
      summary: "Distilled retrieval memory",
      tags: ["retrieval", "distilled"],
      confidence: 0.3,
      freshness: 0.3,
      importance: 0.7,
    });

    const contested = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Legacy retrieval decision that has been superseded.",
      summary: "Legacy retrieval decision",
      status: "superseded",
      tags: ["retrieval"],
      confidence: 0.58,
      freshness: 0.42,
      importance: 0.67,
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: contested.id,
      type: "references",
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "retrieval",
      limit: 1,
    }, {
      bundleConsumer: "auto",
      primaryLimit: 1,
      supportLimit: 4,
    });

    assert.equal(bundles.length, 1);
    assert.equal(bundles[0]?.route.resolvedConsumer, "planner");
    assert.equal(bundles[0]?.route.profileUsed, "planner");
    assert.equal(bundles[0]?.route.source, "auto");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
