import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
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
    assert.ok((report.eventCountsByType.memory_promoted ?? 0) >= 1);
    assert.ok((report.eventCountsByType.memory_expired ?? 0) >= 1);
    assert.ok(Boolean(report.maintenance.latestRunAt));
    assert.ok(Boolean(report.maintenance.latestCompactionAt));
    assert.ok(Boolean(report.maintenance.latestRetentionAt));
    assert.ok((report.maintenance.latestCompactionDelta?.promoted ?? 0) >= 1);
    assert.ok((report.maintenance.latestRetentionDelta?.expired ?? 0) >= 1);

    const promotedRecord = await client.getRecord(promotable.id);
    const expiredRecord = await client.getRecord(expirable.id);
    assert.equal(promotedRecord.tier, "mid");
    assert.equal(expiredRecord.status, "expired");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient exposes storage contract and migration planning helpers", () => {
  const client = new GlialNodeClient();

  try {
    const contract = client.getStorageContract();
    assert.equal(contract.name, "sqlite");
    assert.equal(contract.capabilities.crossProcessWrites, "single_writer");
    assert.equal(contract.capabilities.fullTextSearch, true);

    const plan = client.planStorageMigration({ target: "server-backed" });
    assert.equal(plan.source.name, "sqlite");
    assert.equal(plan.target.name, "server-backed");
    assert.equal(plan.requiresSnapshotExport, true);
    assert.ok(plan.warnings.some((warning) => /Write coordination changes/i.test(warning)));
  } finally {
    client.close();
  }
});

test("GlialNodeClient builds release readiness reports", () => {
  const client = new GlialNodeClient();

  try {
    const blocked = client.buildReleaseReadinessReport();
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.checks.some((check) => check.id === "release_docs" && check.status === "pass"));
    assert.ok(blocked.checks.some((check) => check.id === "demo_green" && check.status === "fail"));
    assert.ok(blocked.blockers.some((blocker) => /tests_green/.test(blocker)));
    assert.ok(blocked.blockers.some((blocker) => /demo_green/.test(blocker)));

    const ready = client.buildReleaseReadinessReport({
      testsGreen: true,
      packGreen: true,
      demoGreen: true,
      docsReviewed: true,
      treeClean: true,
      userApproved: true,
    });
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.blockers, []);
  } finally {
    client.close();
  }
});

test("GlialNodeClient keeps lifecycle state stable across a deterministic 48-step long-run loop", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-lifecycle-longrun-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = new SqliteMemoryRepository({ filename: databasePath });
  const client = new GlialNodeClient({ repository });

  try {
    const space = await client.createSpace({
      name: "Lifecycle Long-Run Space",
      settings: {
        retentionDays: {
          short: 0,
          mid: 2,
          long: 365,
        },
        compaction: {
          shortPromoteImportanceMin: 0.72,
          shortPromoteConfidenceMin: 0.7,
          midPromoteImportanceMin: 0.8,
          midPromoteConfidenceMin: 0.75,
          midPromoteFreshnessMin: 0.5,
          archiveImportanceMax: 0.25,
          archiveConfidenceMax: 0.35,
          archiveFreshnessMax: 0.25,
        },
        decay: {
          minAgeDays: 0,
          confidenceDecayPerDay: 0.03,
          freshnessDecayPerDay: 0.04,
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

    let lifecycleSteps = 0;
    const decayNow = new Date("2030-01-01T00:00:00.000Z");

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await client.addRecord({
        spaceId: space.id,
        scope: { id: scope.id, type: scope.type },
        tier: "short",
        kind: "task",
        content: `Promotable cycle ${cycle}`,
        summary: `Promotable ${cycle}`,
        importance: 0.93,
        confidence: 0.88,
        freshness: 0.84,
        tags: ["longrun", "promotable"],
      });

      await client.addRecord({
        spaceId: space.id,
        scope: { id: scope.id, type: scope.type },
        tier: "short",
        kind: "task",
        content: `Expirable cycle ${cycle}`,
        summary: `Expirable ${cycle}`,
        importance: 0.42,
        confidence: 0.6,
        freshness: 0.62,
        tags: ["longrun", "expirable"],
      });

      const decaying = await client.addRecord({
        spaceId: space.id,
        scope: { id: scope.id, type: scope.type },
        tier: "long",
        kind: "fact",
        content: `Durable fact cycle ${cycle}`,
        summary: `Durable fact ${cycle}`,
        importance: 0.76,
        confidence: 0.9,
        freshness: 0.86,
        tags: ["longrun", "decay"],
      });

      const stale = await repository.getRecord(decaying.id);
      assert.ok(stale);
      stale.updatedAt = "2029-12-25T00:00:00.000Z";
      await repository.writeRecord(stale);

      await client.maintainSpace(space.id, { apply: true });
      lifecycleSteps += 1;
      await client.compactSpace(space.id, { apply: true });
      lifecycleSteps += 1;
      await client.retainSpace(space.id, { apply: true });
      lifecycleSteps += 1;
      await client.decaySpace(space.id, { apply: true, now: decayNow });
      lifecycleSteps += 1;
    }

    assert.equal(lifecycleSteps, 48);

    const report = await client.getSpaceReport(space.id, 20);
    assert.ok((report.eventCountsByType.memory_promoted ?? 0) >= 1);
    assert.ok((report.eventCountsByType.memory_expired ?? 0) >= 1);
    assert.ok((report.eventCountsByType.memory_decayed ?? 0) >= 1);
    assert.ok((report.maintenance.latestRunAt ?? "").length > 0);

    const records = await repository.listRecords(space.id, Number.MAX_SAFE_INTEGER);
    for (const record of records) {
      if (record.status === "active" || record.status === "superseded") {
        assert.ok(record.confidence >= 0.2);
        assert.ok(record.freshness >= 0.15);
      }
    }
  } finally {
    client.close();
    repository.close();
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
    assert.equal(space.settings?.provenance?.trustProfile, undefined);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can store provenance settings on a space", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-space-provenance-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({
      name: "Trusted Space",
      settings: {
        provenance: {
          trustProfile: "anchored",
          trustedSignerNames: ["team-anchor"],
        },
      },
    });

    assert.equal(space.settings?.provenance?.trustProfile, "anchored");
    assert.deepEqual(space.settings?.provenance?.trustedSignerNames, ["team-anchor"]);
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

test("GlialNodeClient can manage local signing keys", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-signing-keys-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const publicKeyPath = join(tempDirectory, "team-executor.public.pem");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    const generated = client.generateSigningKey("team-executor", {
      signer: "GlialNode Test",
    });
    assert.equal(generated.name, "team-executor");
    assert.equal(generated.algorithm, "ed25519");
    assert.equal(generated.signer, "GlialNode Test");
    assert.ok(generated.keyId);

    const listed = client.listSigningKeys();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, "team-executor");

    const stored = client.getSigningKey("team-executor");
    assert.equal(stored.keyId, generated.keyId);
    assert.match(stored.publicKeyPem, /BEGIN PUBLIC KEY/);
    assert.match(stored.privateKeyPem, /BEGIN PRIVATE KEY/);

    const keyPath = join(presetDirectory, ".keys", "team-executor.json");
    const keyFile = readFileSync(keyPath, "utf8");
    assert.match(keyFile, /BEGIN PRIVATE KEY/);
    if (process.platform !== "win32") {
      const keyDirectoryMode = statSync(join(presetDirectory, ".keys")).mode & 0o777;
      assert.equal(keyDirectoryMode & 0o077, 0, `expected private key directory to hide group/other bits, got ${keyDirectoryMode.toString(8)}`);
      const mode = statSync(keyPath).mode & 0o777;
      assert.equal(mode & 0o077, 0, `expected private key file to hide group/other bits, got ${mode.toString(8)}`);
    }

    const exported = client.exportSigningPublicKey("team-executor", publicKeyPath);
    assert.equal(exported.keyId, generated.keyId);
    assert.match(readFileSync(publicKeyPath, "utf8"), /BEGIN PUBLIC KEY/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can manage trusted signers", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-trusted-signers-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const publicKeyPath = join(tempDirectory, "team-executor.public.pem");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.generateSigningKey("team-executor-key", {
      signer: "GlialNode Test",
    });
    const trustedFromLocal = client.trustSigningKey("team-executor-key", {
      trustName: "team-anchor",
    });
    assert.equal(trustedFromLocal.name, "team-anchor");
    assert.equal(trustedFromLocal.signer, "GlialNode Test");

    client.exportSigningPublicKey("team-executor-key", publicKeyPath);
    const trustedFromFile = client.registerTrustedSignerFromPublicKey(publicKeyPath, {
      name: "team-public",
      signer: "GlialNode Test",
    });
    assert.equal(trustedFromFile.name, "team-public");

    const listed = client.listTrustedSigners();
    assert.equal(listed.length, 2);
    assert.ok(listed.some((entry) => entry.name === "team-anchor"));
    assert.ok(listed.some((entry) => entry.name === "team-public"));

    const stored = client.getTrustedSigner("team-anchor");
    assert.equal(stored.keyId, trustedFromLocal.keyId);
    assert.match(stored.publicKeyPem, /BEGIN PUBLIC KEY/);

    const trustedPath = join(presetDirectory, ".trusted", "team-anchor.json");
    const trustedFile = readFileSync(trustedPath, "utf8");
    assert.doesNotMatch(trustedFile, /BEGIN PRIVATE KEY/);
    if (process.platform !== "win32") {
      const trustedDirectoryMode = statSync(join(presetDirectory, ".trusted")).mode & 0o777;
      assert.equal(trustedDirectoryMode & 0o022, 0, `expected trusted signer directory to avoid group/other write bits, got ${trustedDirectoryMode.toString(8)}`);
      const mode = statSync(trustedPath).mode & 0o777;
      assert.equal(mode & 0o022, 0, `expected trusted signer file to avoid group/other write bits, got ${mode.toString(8)}`);
    }

    const rotated = client.rotateTrustedSigner("team-anchor", publicKeyPath, {
      nextName: "team-anchor-v2",
      signer: "GlialNode Test",
      source: "rotation-test",
    });
    assert.equal(rotated.name, "team-anchor-v2");

    const revoked = client.getTrustedSigner("team-anchor");
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.replacedBy, "team-anchor-v2");

    const explicitlyRevoked = client.revokeTrustedSigner("team-public");
    assert.ok(explicitlyRevoked.revokedAt);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can manage trust policy packs with inheritance", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-trust-packs-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    const base = client.registerTrustPolicyPack("strict-signed", {
      description: "Require signed artifacts from production origins.",
      baseProfile: "signed",
      policy: {
        allowedOrigins: ["production"],
      },
    });
    assert.equal(base.baseProfile, "signed");

    const child = client.registerTrustPolicyPack("strict-signed-anchored", {
      inheritsFrom: "strict-signed",
      policy: {
        trustedSignerNames: ["team-anchor"],
      },
    });
    assert.equal(child.inheritsFrom, "strict-signed");

    const listed = client.listTrustPolicyPacks();
    assert.equal(listed.length, 2);
    assert.ok(listed.some((pack) => pack.name === "strict-signed"));
    assert.ok(listed.some((pack) => pack.name === "strict-signed-anchored"));

    const resolved = client.resolveTrustPolicyPack("strict-signed-anchored");
    assert.equal(resolved.baseProfile, "signed");
    assert.deepEqual(resolved.policy.allowedOrigins, ["production"]);
    assert.deepEqual(resolved.policy.trustedSignerNames, ["team-anchor"]);
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

test("GlialNodeClient can promote preset versions into named channels", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-channel-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });

    client.exportPreset("planning-heavy", alternatePresetPath);
    client.registerPreset(alternatePresetPath, {
      name: "team-executor",
      version: "2.2.0",
    });

    const channels = client.promotePresetChannel("team-executor", {
      channel: "stable",
      version: "2.1.0",
    });
    assert.equal(channels.channels.stable, "2.1.0");

    client.promotePresetChannel("team-executor", {
      channel: "candidate",
      version: "2.2.0",
    });

    const listed = client.listPresetChannels("team-executor");
    assert.equal(listed.channels.stable, "2.1.0");
    assert.equal(listed.channels.candidate, "2.2.0");

    const stablePreset = client.resolvePresetChannel("team-executor", { channel: "stable" });
    assert.equal(stablePreset.version, "2.1.0");
    assert.equal(stablePreset.settings.routing?.preferPlannerOnDistilled, false);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can create and configure spaces from preset channels", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-preset-channel-space-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    client.promotePresetChannel("team-executor", {
      channel: "stable",
      version: "2.1.0",
    });

    const created = await client.createSpace({
      name: "Channel Space",
      presetLocalName: "team-executor",
      presetChannel: "stable",
    });
    assert.ok(created.settings);
    assert.equal(created.settings.routing?.preferPlannerOnDistilled, false);

    client.exportPreset("planning-heavy", alternatePresetPath);
    client.registerPreset(alternatePresetPath, {
      name: "team-executor",
      version: "2.2.0",
    });
    client.promotePresetChannel("team-executor", {
      channel: "candidate",
      version: "2.2.0",
    });

    const configured = await client.configureSpace({
      spaceId: created.id,
      presetLocalName: "team-executor",
      presetChannel: "candidate",
    });
    assert.ok(configured.settings);
    assert.equal(configured.settings.routing?.preferPlannerOnDistilled, true);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can use a preset default channel for space setup", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-default-channel-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    client.promotePresetChannel("team-executor", {
      channel: "stable",
      version: "2.1.0",
    });
    const channelState = client.setDefaultPresetChannel("team-executor", {
      channel: "stable",
    });
    assert.equal(channelState.defaultChannel, "stable");

    const resolved = client.resolvePresetChannel("team-executor", {});
    assert.equal(resolved.version, "2.1.0");

    const space = await client.createSpace({
      name: "Default Channel Space",
      presetLocalName: "team-executor",
    });
    assert.ok(space.settings);
    assert.equal(space.settings.routing?.preferPlannerOnDistilled, false);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export and import preset channel manifests", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-channel-io-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const manifestPath = join(tempDirectory, "channels.json");
  const sourcePresetDirectory = join(tempDirectory, "source-presets");
  const targetPresetDirectory = join(tempDirectory, "target-presets");
  const sourceClient = new GlialNodeClient({ filename: databasePath, presetDirectory: sourcePresetDirectory });
  const targetClient = new GlialNodeClient({ filename: databasePath, presetDirectory: targetPresetDirectory });

  try {
    sourceClient.exportPreset("execution-first", presetPath);
    sourceClient.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    sourceClient.promotePresetChannel("team-executor", {
      channel: "stable",
      version: "2.1.0",
    });
    sourceClient.setDefaultPresetChannel("team-executor", {
      channel: "stable",
    });

    const exported = sourceClient.exportPresetChannels("team-executor", manifestPath);
    assert.equal(exported.defaultChannel, "stable");

    const imported = targetClient.importPresetChannels(manifestPath, {
      name: "team-executor-copy",
    });
    assert.equal(imported.name, "team-executor-copy");
    assert.equal(imported.defaultChannel, "stable");
    assert.equal(imported.channels.stable, "2.1.0");

    const listed = targetClient.listPresetChannels("team-executor-copy");
    assert.equal(listed.defaultChannel, "stable");
    assert.equal(listed.channels.stable, "2.1.0");
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export and import full preset bundles", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-io-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const altPresetPath = join(tempDirectory, "planning-heavy.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const sourcePresetDirectory = join(tempDirectory, "source-presets");
  const targetPresetDirectory = join(tempDirectory, "target-presets");
  const sourceClient = new GlialNodeClient({ filename: databasePath, presetDirectory: sourcePresetDirectory });
  const targetClient = new GlialNodeClient({ filename: databasePath, presetDirectory: targetPresetDirectory });

  try {
    sourceClient.exportPreset("execution-first", presetPath);
    sourceClient.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    sourceClient.exportPreset("planning-heavy", altPresetPath);
    sourceClient.registerPreset(altPresetPath, {
      name: "team-executor",
      version: "2.2.0",
    });
    sourceClient.promotePresetChannel("team-executor", {
      channel: "stable",
      version: "2.1.0",
    });
    sourceClient.promotePresetChannel("team-executor", {
      channel: "candidate",
      version: "2.2.0",
    });
    sourceClient.setDefaultPresetChannel("team-executor", {
      channel: "stable",
    });

    const exported = sourceClient.exportPresetBundle("team-executor", bundlePath);
    assert.equal(exported.preset.name, "team-executor");
    assert.ok(exported.history.length >= 2);
    assert.equal(exported.channels.defaultChannel, "stable");

    const imported = targetClient.importPresetBundle(bundlePath, {
      name: "team-executor-copy",
    });
    assert.equal(imported.preset.name, "team-executor-copy");
    assert.equal(imported.channels.defaultChannel, "stable");

    const current = targetClient.getRegisteredPreset("team-executor-copy");
    assert.equal(current.version, "2.2.0");

    const history = targetClient.listRegisteredPresetHistory("team-executor-copy");
    assert.ok(history.some((preset) => preset.version === "2.1.0"));
    assert.ok(history.some((preset) => preset.version === "2.2.0"));

    const channels = targetClient.listPresetChannels("team-executor-copy");
    assert.equal(channels.channels.stable, "2.1.0");
    assert.equal(channels.channels.candidate, "2.2.0");
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient importPresetBundle enforces explicit collision policy", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-collision-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    client.exportPresetBundle("team-executor", bundlePath);

    assert.throws(
      () => client.importPresetBundle(bundlePath),
      /Preset already exists: team-executor\. Use collisionPolicy=overwrite or collisionPolicy=rename\./,
    );

    const overwritten = client.importPresetBundle(bundlePath, {
      collisionPolicy: "overwrite",
    });
    assert.equal(overwritten.preset.name, "team-executor");

    const renamed = client.importPresetBundle(bundlePath, {
      collisionPolicy: "rename",
    });
    assert.equal(renamed.preset.name, "team-executor imported");
    assert.equal(client.getRegisteredPreset("team-executor imported").name, "team-executor imported");
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient validates preset bundle metadata and rejects unsupported formats", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-validation-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const signerPublicKeyPath = join(tempDirectory, "team-executor.signer.public.pem");
  const invalidBundlePath = join(tempDirectory, "team-executor.invalid.bundle.json");
  const tamperedBundlePath = join(tempDirectory, "team-executor.tampered.bundle.json");
  const invalidSignatureBundlePath = join(tempDirectory, "team-executor.invalid-signature.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    client.exportPreset("execution-first", presetPath);
    client.registerPreset(presetPath, {
      name: "team-executor",
      version: "2.1.0",
    });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const signerKeyId = createHash("sha256").update(publicKeyPem).digest("hex");

    const bundle = client.exportPresetBundle("team-executor", bundlePath, undefined, {
      origin: "local-dev",
      signer: "GlialNode Test",
      signingPrivateKeyPem: privateKeyPem,
    });
    const validation = client.validatePresetBundle(bundlePath);
    assert.equal(validation.metadata.bundleFormatVersion, 1);
    assert.equal(validation.warnings.length, 0);
    assert.equal(validation.trusted, true);
    assert.equal(validation.report.trustProfile, "permissive");
    assert.equal(validation.metadata.origin, "local-dev");
    assert.equal(validation.metadata.signer, "GlialNode Test");
    assert.equal(validation.metadata.signatureAlgorithm, "ed25519");
    assert.equal(validation.metadata.signerKeyId, signerKeyId);
    assert.equal(validation.metadata.signerPublicKey, publicKeyPem);
    assert.ok(validation.metadata.signature);
    assert.equal(validation.trustWarnings.length, 0);
    assert.equal(validation.report.signerKeyId, signerKeyId);

    const strictValidation = client.validatePresetBundle(bundlePath, {
      requireSigner: true,
      requireSignature: true,
      allowedOrigins: ["local-dev"],
      allowedSigners: ["GlialNode Test"],
      allowedSignerKeyIds: [signerKeyId],
    });
    assert.equal(strictValidation.trusted, true);
    assert.equal(strictValidation.report.effectivePolicy.requireSignature, true);

    writeFileSync(signerPublicKeyPath, bundle.metadata.signerPublicKey ?? publicKeyPem, "utf8");
    client.registerTrustedSignerFromPublicKey(signerPublicKeyPath, {
      name: "team-anchor",
      signer: "GlialNode Test",
      source: "bundle-test",
    });
    const trustedByName = client.validatePresetBundle(bundlePath, {
      requireSignature: true,
      trustedSignerNames: ["team-anchor"],
    });
    assert.equal(trustedByName.trusted, true);
    assert.deepEqual(trustedByName.report.matchedTrustedSignerNames, ["team-anchor"]);

    const alternateKeyPair = generateKeyPairSync("ed25519");
    const alternatePublicKeyPem = alternateKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    writeFileSync(signerPublicKeyPath, alternatePublicKeyPem, "utf8");
    client.registerTrustedSignerFromPublicKey(signerPublicKeyPath, {
      name: "other-anchor",
      signer: "Another Signer",
      source: "bundle-test-alt",
    });
    const multiAnchorValidation = client.validatePresetBundle(bundlePath, {
      requireSignature: true,
      trustedSignerNames: ["team-anchor", "other-anchor"],
    });
    assert.deepEqual(multiAnchorValidation.report.matchedTrustedSignerNames, ["team-anchor"]);

    const provenanceSpace = await client.createSpace({
      name: "Trusted Bundle Review",
      settings: {
        provenance: {
          trustProfile: "anchored",
          trustedSignerNames: ["team-anchor"],
        },
      },
    });
    const spaceValidation = await client.validatePresetBundleForSpace(bundlePath, {
      spaceId: provenanceSpace.id,
    });
    assert.equal(spaceValidation.trusted, true);
    assert.equal(spaceValidation.report.trustProfile, "anchored");
    assert.deepEqual(spaceValidation.report.matchedTrustedSignerNames, ["team-anchor"]);

    const importedBySpace = await client.importPresetBundleForSpace(bundlePath, {
      spaceId: provenanceSpace.id,
      name: "team-executor-imported",
    });
    assert.equal(importedBySpace.preset.name, "team-executor-imported");

    const provenanceReport = await client.getSpaceReport(provenanceSpace.id);
    assert.match(provenanceReport.recentProvenanceEvents.map((event) => event.type).join(","), /bundle_reviewed/);
    assert.match(provenanceReport.recentProvenanceEvents.map((event) => event.type).join(","), /bundle_imported/);
    assert.equal(provenanceReport.provenanceSummaryCount, 2);

    const auditRecords = await client.searchRecords({
      spaceId: provenanceSpace.id,
      text: "Bundle import audit",
      limit: 10,
    });
    assert.match(auditRecords.map((record) => record.summary ?? record.content).join(","), /Bundle import audit/);

    const provenanceBundles = await client.bundleRecall({
      spaceId: provenanceSpace.id,
      text: "Bundle import audit",
      limit: 3,
    }, {
      primaryLimit: 1,
      supportLimit: 3,
      bundleConsumer: "reviewer",
    });
    assert.ok(provenanceBundles[0]?.primary.annotations.includes("provenance"));
    assert.ok(provenanceBundles[0]?.hints.includes("contains_provenance_memory"));
    assert.match(provenanceBundles[0]?.trace.citations.map((citation) => citation.reason).join(" "), /provenance audit/i);

    const signedProfile = client.validatePresetBundle(bundlePath, undefined, "signed");
    assert.equal(signedProfile.trusted, true);
    assert.equal(signedProfile.report.trustProfile, "signed");

    const anchoredProfile = client.validatePresetBundle(bundlePath, {
      trustedSignerNames: ["team-anchor"],
    }, "anchored");
    assert.equal(anchoredProfile.trusted, true);

    client.revokeTrustedSigner("team-anchor");
    assert.throws(
      () => client.validatePresetBundle(bundlePath, {
        requireSignature: true,
        trustedSignerNames: ["team-anchor"],
      }),
      /Trusted signers are revoked: team-anchor/,
    );
    assert.throws(
      () => client.validatePresetBundle(bundlePath, undefined, "anchored"),
      /Trust profile 'anchored' requires trusted signers or allowed signer key ids\./,
    );

    assert.throws(
      () => client.validatePresetBundle(bundlePath, { allowedOrigins: ["production"] }),
      /Preset bundle trust validation failed: Preset bundle origin is not allowed: local-dev/,
    );
    assert.throws(
      () => client.importPresetBundle(bundlePath, {
        trustPolicy: { allowedSigners: ["Trusted CI"] },
      }),
      /Preset bundle trust validation failed: Preset bundle signer is not allowed: GlialNode Test/,
    );
    assert.throws(
      () => client.validatePresetBundle(bundlePath, { allowedSignerKeyIds: ["deadbeef"] }),
      new RegExp(`Preset bundle trust validation failed: Preset bundle signer key id is not allowed: ${signerKeyId}`),
    );

    const invalidBundle = {
      ...bundle,
      metadata: {
        ...bundle.metadata,
        bundleFormatVersion: 999,
      },
    };
    writeFileSync(invalidBundlePath, JSON.stringify(invalidBundle, null, 2), "utf8");

    assert.throws(
      () => client.validatePresetBundle(invalidBundlePath),
      /Unsupported preset bundle format: 999/,
    );
    assert.throws(
      () => client.importPresetBundle(invalidBundlePath),
      /Unsupported preset bundle format: 999/,
    );

    const tamperedBundle = {
      ...bundle,
      preset: {
        ...bundle.preset,
        summary: "tampered",
      },
    };
    writeFileSync(tamperedBundlePath, JSON.stringify(tamperedBundle, null, 2), "utf8");

    assert.throws(
      () => client.validatePresetBundle(tamperedBundlePath),
      /Preset bundle checksum verification failed/,
    );

    const invalidSignatureBundlePath = join(tempDirectory, "team-executor.invalid-signature.bundle.json");
    const invalidSignatureBundle = {
      ...bundle,
      metadata: {
        ...bundle.metadata,
        signature: "invalid-signature",
      },
    };
    writeFileSync(invalidSignatureBundlePath, JSON.stringify(invalidSignatureBundle, null, 2), "utf8");

    assert.throws(
      () => client.validatePresetBundle(invalidSignatureBundlePath),
      /Preset bundle signature verification failed/,
    );
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export and import a versioned snapshot without the CLI", async () => {
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

    const snapshot = await sourceClient.exportSpace(space.id, {
      origin: "client-test",
    });
    assert.equal(snapshot.metadata.snapshotFormatVersion, 1);
    assert.equal(snapshot.metadata.origin, "client-test");
    assert.ok(snapshot.metadata.checksum);
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

test("GlialNodeClient can export a space graph for topology inspection", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-graph-export-"));
  const databasePath = join(tempDirectory, "graph.sqlite");
  const outputPath = join(tempDirectory, "space.graph.json");
  const cytoscapeOutputPath = join(tempDirectory, "space.graph.cytoscape.json");
  const dotOutputPath = join(tempDirectory, "space.graph.dot");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Graph Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });
    await client.addEvent({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      actorType: "agent",
      actorId: "writer-1",
      type: "decision_made",
      summary: "Captured graph event.",
    });
    const first = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "First graph node.",
      summary: "First node",
    });
    const second = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "summary",
      content: "Second graph node.",
      summary: "Second node",
    });
    await client.addLink({
      spaceId: space.id,
      fromRecordId: first.id,
      toRecordId: second.id,
      type: "supports",
    });

    const graph = await client.exportSpaceGraph(space.id);
    assert.equal(graph.metadata.schemaVersion, 1);
    assert.equal(graph.metadata.spaceId, space.id);
    assert.ok(graph.nodes.some((node) => node.type === "space" && node.id === space.id));
    assert.ok(graph.nodes.some((node) => node.type === "scope" && node.id === scope.id));
    assert.ok(graph.nodes.some((node) => node.type === "event"));
    assert.ok(graph.nodes.some((node) => node.type === "record" && node.id === first.id));
    assert.ok(graph.edges.some((edge) => edge.type === "record_link" && edge.relation === "supports"));
    assert.ok(graph.edges.some((edge) => edge.type === "contains_scope" && edge.toId === scope.id));

    const cytoscape = await client.exportSpaceGraphCytoscape(space.id);
    assert.equal(cytoscape.metadata.schemaVersion, 1);
    assert.ok(cytoscape.elements.nodes.some((node) => node.data.type === "scope"));
    assert.ok(cytoscape.elements.edges.some((edge) => edge.data.type === "record_link"));

    const dot = await client.exportSpaceGraphDot(space.id);
    assert.match(dot, /^digraph /);
    assert.match(dot, /label="supports"/);

    const minimalGraph = await client.exportSpaceGraph(space.id, {
      includeEvents: false,
      includeScopes: false,
    });
    assert.equal(minimalGraph.metadata.options.includeEvents, false);
    assert.equal(minimalGraph.metadata.options.includeScopes, false);
    assert.equal(minimalGraph.nodes.some((node) => node.type === "event"), false);
    assert.equal(minimalGraph.nodes.some((node) => node.type === "scope"), false);

    const exportedPath = await client.exportSpaceGraphToFile(space.id, outputPath, {
      includeEvents: false,
      includeScopes: false,
    });
    assert.equal(exportedPath, outputPath);
    const stored = JSON.parse(readFileSync(outputPath, "utf8")) as {
      metadata: { spaceId: string; nodeCount: number };
    };
    assert.equal(stored.metadata.spaceId, space.id);
    assert.equal(typeof stored.metadata.nodeCount, "number");

    await client.exportSpaceGraphToFile(space.id, cytoscapeOutputPath, {
      format: "cytoscape",
    });
    const storedCytoscape = JSON.parse(readFileSync(cytoscapeOutputPath, "utf8")) as {
      elements: { nodes: Array<{ data: { type: string } }> };
    };
    assert.ok(storedCytoscape.elements.nodes.some((node) => node.data.type === "scope"));

    await client.exportSpaceGraphToFile(space.id, dotOutputPath, {
      format: "dot",
    });
    const storedDot = readFileSync(dotOutputPath, "utf8");
    assert.match(storedDot, /^digraph /);
    assert.match(storedDot, /label="contains"/);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can export a standalone space inspector artifact", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-space-inspector-"));
  const databasePath = join(tempDirectory, "inspector.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const outputPath = join(tempDirectory, "space-inspector.html");
  const snapshotOutputPath = join(tempDirectory, "space-inspector.snapshot.json");
  const indexOutputPath = join(tempDirectory, "space-inspector-index.html");
  const indexSnapshotOutputPath = join(tempDirectory, "space-inspector-index.snapshot.json");
  const packOutputDirectory = join(tempDirectory, "space-inspector-pack");
  const client = new GlialNodeClient({ filename: databasePath, presetDirectory });

  try {
    const space = await client.createSpace({
      name: "Inspector Space",
      settings: {
        routing: {
          preferExecutorOnActionable: false,
        },
      },
    });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "reviewer",
    });
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Inspector artifacts should include policy and trust context.",
      summary: "Inspector policy",
    });
    await client.generateSigningKey("inspector-key", {
      signer: "Inspector Signer",
      overwrite: true,
    });
    client.trustSigningKey("inspector-key", {
      trustName: "inspector-anchor",
      overwrite: true,
    });
    client.registerTrustPolicyPack("inspector-pack", {
      description: "Inspector trust pack",
      baseProfile: "anchored",
      policy: {
        trustedSignerNames: ["inspector-anchor"],
      },
      overwrite: true,
    });

    const snapshot = await client.buildSpaceInspectorSnapshot(space.id, {
      presetDirectory,
      recentEventLimit: 5,
      recall: {
        query: {
          text: "policy trust context",
          limit: 2,
        },
        primaryLimit: 2,
        supportLimit: 2,
        bundleConsumer: "reviewer",
      },
    });
    assert.equal(snapshot.metadata.schemaVersion, 1);
    assert.equal(snapshot.space.id, space.id);
    assert.equal(snapshot.report.spaceId, space.id);
    assert.equal(snapshot.risk.contestedMemoryEvents, 0);
    assert.equal(snapshot.risk.riskLevel, "moderate");
    assert.equal(snapshot.policy.effective.routing.preferExecutorOnActionable, false);
    assert.equal(snapshot.policy.origin.routing.preferExecutorOnActionable, "space");
    assert.equal(snapshot.recall?.traceCount, 1);
    assert.equal(snapshot.recall?.query.text, "policy trust context");
    assert.ok(snapshot.recall?.traces[0]?.summary);
    assert.equal(snapshot.recall?.bundles[0]?.route.resolvedConsumer, "reviewer");
    assert.ok((snapshot.trustRegistry?.trustedSigners.length ?? 0) >= 1);
    assert.ok(snapshot.trustRegistry?.trustPolicyPacks.some((pack) => pack.name === "inspector-pack"));

    const exportResult = await client.exportSpaceInspectorHtml(space.id, outputPath, {
      presetDirectory,
    });
    assert.equal(exportResult.outputPath, outputPath);
    const snapshotResult = await client.exportSpaceInspectorSnapshotToFile(space.id, snapshotOutputPath, {
      presetDirectory,
      recall: {
        query: { text: "policy trust context", limit: 1 },
      },
    });
    assert.equal(snapshotResult.outputPath, snapshotOutputPath);
    const snapshotFile = JSON.parse(readFileSync(snapshotOutputPath, "utf8")) as {
      space: { id: string };
      risk: { riskLevel: string };
      recall?: { traceCount: number };
    };
    assert.equal(snapshotFile.space.id, space.id);
    assert.equal(snapshotFile.risk.riskLevel, "moderate");
    assert.equal(snapshotFile.recall?.traceCount, 1);

    const html = readFileSync(outputPath, "utf8");
    assert.match(html, /GlialNode Space Inspector/);
    assert.match(html, /Inspector Space/);
    assert.match(html, /snapshot-data/);

    const secondSpace = await client.createSpace({ name: "Inspector Space B" });
    await client.addScope({
      spaceId: secondSpace.id,
      type: "agent",
      label: "observer",
    });
    const index = await client.buildSpaceInspectorIndexSnapshot({
      presetDirectory,
      includeGraphCounts: true,
      recentEventLimit: 3,
    });
    assert.ok(index.metadata.spaceCount >= 2);
    assert.ok(index.totals.records >= 1);
    assert.ok(index.totals.graphNodes >= 2);
    assert.ok(index.totals.spacesNeedingTrustReview >= 0);
    assert.ok(index.spaces.some((entry) => entry.space.name === "Inspector Space B"));

    const indexResult = await client.exportSpaceInspectorIndexHtml(indexOutputPath, {
      presetDirectory,
      includeGraphCounts: true,
    });
    assert.equal(indexResult.outputPath, indexOutputPath);
    const indexHtml = readFileSync(indexOutputPath, "utf8");
    assert.match(indexHtml, /GlialNode Space Inspector Index/);
    assert.match(indexHtml, /Inspector Space B/);
    const indexSnapshotResult = await client.exportSpaceInspectorIndexSnapshotToFile(indexSnapshotOutputPath, {
      presetDirectory,
      includeGraphCounts: true,
    });
    assert.equal(indexSnapshotResult.outputPath, indexSnapshotOutputPath);
    const indexSnapshotFile = JSON.parse(readFileSync(indexSnapshotOutputPath, "utf8")) as {
      metadata: { spaceCount: number };
      totals: { spacesWithContestedMemory: number };
      spaces: Array<{ risk: { riskLevel: string } }>;
    };
    assert.ok(indexSnapshotFile.metadata.spaceCount >= 2);
    assert.ok(indexSnapshotFile.totals.spacesWithContestedMemory >= 0);
    assert.ok(indexSnapshotFile.spaces.length >= 2);

    const packResult = await client.exportSpaceInspectorPack(packOutputDirectory, {
      presetDirectory,
      includeGraphCounts: true,
      recall: {
        query: { text: "inspector", limit: 1 },
      },
    });
    assert.equal(packResult.outputDirectory, packOutputDirectory);
    assert.equal(packResult.manifest.metadata.spaceCount, indexSnapshotFile.metadata.spaceCount);
    assert.ok(packResult.manifest.spaces.length >= 2);
    const manifestFile = JSON.parse(readFileSync(packResult.manifestPath, "utf8")) as {
      metadata: { spaceCount: number };
      files: { indexHtml: string; indexSnapshot: string; indexScreenshot?: string };
      spaces: Array<{ html: string; snapshot: string; screenshot?: string }>;
    };
    assert.ok(manifestFile.metadata.spaceCount >= 2);
    assert.match(readFileSync(manifestFile.files.indexHtml, "utf8"), /GlialNode Space Inspector Index/);
    assert.equal(manifestFile.files.indexScreenshot, undefined);
    assert.ok(manifestFile.spaces.every((entry) => entry.html.endsWith(".html")));
    assert.ok(manifestFile.spaces.every((entry) => entry.snapshot.endsWith(".snapshot.json")));
    assert.ok(manifestFile.spaces.every((entry) => entry.screenshot === undefined));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient importSnapshot enforces explicit collision policy", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-snapshot-collision-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const sourceClient = new GlialNodeClient({ filename: sourcePath });
  const targetClient = new GlialNodeClient({ filename: targetPath });

  try {
    const space = await sourceClient.createSpace({ name: "Collision Space" });
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
      content: "Snapshot import should not overwrite silently.",
      summary: "Collision rule",
    });

    const snapshot = await sourceClient.exportSpace(space.id);
    await targetClient.importSnapshot(snapshot);

    await assert.rejects(
      () => targetClient.importSnapshot(snapshot),
      /Space already exists: .*Use collisionPolicy=overwrite or collisionPolicy=rename\./,
    );

    const overwritten = await targetClient.importSnapshot(snapshot, {
      collisionPolicy: "overwrite",
    });
    assert.equal(overwritten.space.id, space.id);

    const renamed = await targetClient.importSnapshot(snapshot, {
      collisionPolicy: "rename",
    });
    assert.notEqual(renamed.space.id, space.id);
    assert.equal(renamed.space.name, "Collision Space (imported)");

    const renamedRecords = await targetClient.searchRecords({
      spaceId: renamed.space.id,
      text: "overwrite silently",
      limit: 10,
    });
    assert.equal(renamedRecords.length, 1);
    assert.notEqual(renamedRecords[0]?.id, record.id);
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can preview snapshot imports without mutating storage", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-snapshot-preview-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const sourceClient = new GlialNodeClient({ filename: sourcePath });
  const targetClient = new GlialNodeClient({ filename: targetPath });

  try {
    const space = await sourceClient.createSpace({ name: "Preview Space" });
    const scope = await sourceClient.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });

    await sourceClient.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Preview should surface collisions before apply.",
      summary: "Preview rule",
    });

    const snapshot = await sourceClient.exportSpace(space.id);
    const firstPreview = await targetClient.previewSnapshotImport(snapshot);
    assert.equal(firstPreview.applyAllowed, true);
    assert.equal(firstPreview.identityRemapped, false);
    assert.equal(firstPreview.importedCounts.records, 1);

    await targetClient.importSnapshot(snapshot);
    const errorPreview = await targetClient.previewSnapshotImport(snapshot);
    assert.equal(errorPreview.applyAllowed, false);
    assert.ok(errorPreview.blockingIssues.some((issue) => /Space already exists:/i.test(issue)));

    const renamePreview = await targetClient.previewSnapshotImport(snapshot, {
      collisionPolicy: "rename",
    });
    assert.equal(renamePreview.applyAllowed, true);
    assert.equal(renamePreview.identityRemapped, true);
    assert.equal(renamePreview.targetSpace.name, "Preview Space (imported)");
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient validates signed snapshots against trusted signers", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-snapshot-signed-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const sourceClient = new GlialNodeClient({ filename: sourcePath, presetDirectory });
  const targetClient = new GlialNodeClient({ filename: targetPath, presetDirectory });

  try {
    const signingKey = sourceClient.generateSigningKey("snapshot-key", {
      signer: "GlialNode Test",
    });
    sourceClient.trustSigningKey("snapshot-key", {
      trustName: "snapshot-anchor",
    });

    const space = await sourceClient.createSpace({ name: "Signed Portable Space" });
    const scope = await sourceClient.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });

    await sourceClient.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Signed snapshots should validate against trusted anchors.",
      summary: "Signed snapshot rule",
    });

    const snapshot = await sourceClient.exportSpace(space.id, {
      origin: "client-test",
      signer: signingKey.signer,
      signingPrivateKeyPem: sourceClient.getSigningKey("snapshot-key").privateKeyPem,
    });
    const validation = await targetClient.validateSnapshot(
      snapshot,
      { trustedSignerNames: ["snapshot-anchor"] },
      "anchored",
      presetDirectory,
    );

    assert.equal(validation.trusted, true);
    assert.equal(validation.report.signed, true);
    assert.deepEqual(validation.report.matchedTrustedSignerNames, ["snapshot-anchor"]);

    await targetClient.importSnapshot(snapshot, {
      trustPolicy: { trustedSignerNames: ["snapshot-anchor"] },
      trustProfile: "anchored",
      directory: presetDirectory,
    });

    const importedSpace = await targetClient.getSpace(space.id);
    assert.equal(importedSpace.name, "Signed Portable Space");
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient snapshot trust enforces rotated anchors and rejects revoked ones", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-snapshot-rotation-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const rotatedPublicKeyPath = join(tempDirectory, "snapshot-key-v2.public.pem");
  const sourceClient = new GlialNodeClient({ filename: sourcePath, presetDirectory });
  const targetClient = new GlialNodeClient({ filename: targetPath, presetDirectory });

  try {
    const signingKeyV1 = sourceClient.generateSigningKey("snapshot-key-v1", {
      signer: "GlialNode Test",
    });
    sourceClient.trustSigningKey("snapshot-key-v1", {
      trustName: "snapshot-anchor",
    });
    const signingKeyV2 = sourceClient.generateSigningKey("snapshot-key-v2", {
      signer: "GlialNode Test",
    });
    sourceClient.exportSigningPublicKey("snapshot-key-v2", rotatedPublicKeyPath);
    sourceClient.rotateTrustedSigner("snapshot-anchor", rotatedPublicKeyPath, {
      nextName: "snapshot-anchor-v2",
    });

    const space = await sourceClient.createSpace({ name: "Signed Rotation Space" });
    const scope = await sourceClient.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });

    await sourceClient.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Rotated trust anchors should control snapshot imports.",
      summary: "Signed rotation rule",
    });

    const snapshotV1 = await sourceClient.exportSpace(space.id, {
      origin: "client-test",
      signer: signingKeyV1.signer,
      signingPrivateKeyPem: sourceClient.getSigningKey("snapshot-key-v1").privateKeyPem,
    });
    await assert.rejects(
      () => targetClient.importSnapshot(snapshotV1, {
        trustPolicy: { trustedSignerNames: ["snapshot-anchor"] },
        trustProfile: "anchored",
        directory: presetDirectory,
      }),
      /Trusted signers are revoked: snapshot-anchor/,
    );

    const snapshotV2 = await sourceClient.exportSpace(space.id, {
      origin: "client-test",
      signer: signingKeyV2.signer,
      signingPrivateKeyPem: sourceClient.getSigningKey("snapshot-key-v2").privateKeyPem,
    });
    const validationV2 = await targetClient.validateSnapshot(
      snapshotV2,
      { trustedSignerNames: ["snapshot-anchor-v2"] },
      "anchored",
      presetDirectory,
    );
    assert.equal(validationV2.trusted, true);
    assert.deepEqual(validationV2.report.matchedTrustedSignerNames, ["snapshot-anchor-v2"]);

    await targetClient.importSnapshot(snapshotV2, {
      trustPolicy: { trustedSignerNames: ["snapshot-anchor-v2"] },
      trustProfile: "anchored",
      directory: presetDirectory,
    });
    const importedSpace = await targetClient.getSpace(space.id);
    assert.equal(importedSpace.name, "Signed Rotation Space");
  } finally {
    sourceClient.close();
    targetClient.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient rejects tampered snapshots", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-snapshot-tamper-"));
  const sourcePath = join(tempDirectory, "source.sqlite");
  const targetPath = join(tempDirectory, "target.sqlite");
  const sourceClient = new GlialNodeClient({ filename: sourcePath });
  const targetClient = new GlialNodeClient({ filename: targetPath });

  try {
    const space = await sourceClient.createSpace({ name: "Tamper Space" });
    const scope = await sourceClient.addScope({
      spaceId: space.id,
      type: "agent",
      label: "writer",
    });

    await sourceClient.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Original export content.",
      summary: "Tamper target",
    });

    const snapshot = await sourceClient.exportSpace(space.id);
    snapshot.records[0] = {
      ...snapshot.records[0]!,
      content: "Tampered export content.",
    };

    await assert.rejects(
      () => targetClient.importSnapshot(snapshot),
      /Space snapshot checksum verification failed/,
    );
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

    const semanticResults = await client.searchRecords(
      {
        spaceId: space.id,
        text: "preferred retrieval default",
        limit: 5,
      },
      {
        semantic: {
          enabled: true,
          semanticWeight: 0.6,
        },
      },
    );
    assert.equal(semanticResults.length, 1);

    const gatedResults = await client.searchRecords(
      {
        spaceId: space.id,
        text: "preferred retrieval default",
        limit: 5,
      },
      {
        semantic: {
          enabled: true,
          semanticWeight: 0.6,
          gate: {
            requirePass: true,
            passed: false,
            reportId: "semantic-eval-failed",
          },
        },
      },
    );
    assert.equal(gatedResults.length, 1);

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

test("GlialNodeClient can build a read-only learning loop plan", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-learning-loop-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Learning Loop Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    const reinforced = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval remains the default search mode.",
      summary: "Lexical retrieval default",
      confidence: 0.7,
      freshness: 0.62,
    });
    const current = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Use serialized local writes for concurrent host calls.",
      summary: "Serialized local writes",
      confidence: 0.9,
      freshness: 0.8,
    });
    const older = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "decision",
      content: "Use direct SQLite writes for concurrent host calls.",
      summary: "Direct SQLite writes",
      confidence: 0.55,
      freshness: 0.7,
    });

    await client.reinforceRecord(reinforced.id, { reason: "successful-retrieval" });
    await client.reinforceRecord(reinforced.id, { reason: "successful-retrieval" });
    await client.addLink({
      spaceId: space.id,
      fromRecordId: current.id,
      toRecordId: older.id,
      type: "contradicts",
    });

    const plan = await client.planLearningLoop(space.id, {
      policy: {
        minSuccessfulUses: 2,
      },
    });

    assert.equal(plan.summary.recordsReviewed >= 3, true);
    assert.ok(plan.suggestions.some((suggestion) =>
      suggestion.type === "reinforce_repeated_success" &&
      suggestion.recordId === reinforced.id,
    ));
    assert.ok(plan.suggestions.some((suggestion) =>
      suggestion.type === "review_contradiction" &&
      suggestion.recordId === current.id &&
      suggestion.relatedRecordId === older.id,
    ));
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

test("GlialNodeClient can prepare pre-reply memory context for host apps", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-reply-context-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Reply Context Space" });
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
      content: "Prefer lexical retrieval first for stable reply drafting flows.",
      summary: "Lexical retrieval decision",
      compactContent: "U:req retrieval=lexical_first",
      tags: ["retrieval", "reply"],
      confidence: 0.88,
      freshness: 0.82,
      importance: 0.9,
    });

    const support = await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Lexical retrieval keeps reply preparation easier to audit than heavier semantic stacks.",
      summary: "Lexical auditing benefit",
      compactContent: "F:reply audit=easy",
      tags: ["retrieval", "audit"],
      confidence: 0.79,
      freshness: 0.74,
      importance: 0.76,
    });

    await client.addLink({
      spaceId: space.id,
      fromRecordId: primary.id,
      toRecordId: support.id,
      type: "supports",
    });

    const replyContext = await client.prepareReplyContext({
      spaceId: space.id,
      text: "lexical retrieval for reply drafting",
      limit: 3,
    }, {
      maxEntries: 1,
      supportLimit: 2,
      bundleConsumer: "auto",
      bundlePreferCompact: true,
    });

    assert.equal(replyContext.entries.length, 1);
    assert.equal(replyContext.entries[0]?.pack.primary.id, primary.id);
    assert.match(replyContext.entries[0]?.trace.summary ?? "", /Recalled/);
    assert.match(replyContext.entries[0]?.text ?? "", /\[GlialNode Memory\]/);
    assert.match(replyContext.entries[0]?.text ?? "", /route=/);
    assert.match(replyContext.text, /primary=Lexical retrieval decision/);
    assert.ok(replyContext.entries[0]?.bundle.supporting.some((entry) => entry.recordId === support.id));
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient can prepare pre-reply memory context with a custom formatter", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-reply-context-custom-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Reply Context Custom Space" });
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
      content: "Prefer lexical retrieval first for stable reply drafting flows.",
      summary: "Lexical retrieval decision",
      tags: ["retrieval", "reply"],
      confidence: 0.88,
      freshness: 0.82,
      importance: 0.9,
    });

    const replyContext = await client.prepareReplyContext({
      spaceId: space.id,
      text: "lexical retrieval",
      limit: 2,
    }, {
      maxEntries: 1,
      formatter: (entry, index) =>
        `ctx${index + 1}:${entry.bundle.primary.summary}|${entry.trace.citations[0]?.reason}`,
    });

    assert.equal(replyContext.entries.length, 1);
    assert.match(replyContext.entries[0]?.text ?? "", /^ctx1:Lexical retrieval decision\|/);
    assert.equal(replyContext.text, replyContext.entries[0]?.text ?? "");
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

test("GlialNodeClient can auto-route bundles toward reviewer context when provenance memory is present", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-routing-provenance-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Provenance Routing Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "planner",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "summary",
      content: "Bundle import audit for retrieval policy bundle review.",
      summary: "Bundle import audit",
      tags: ["provenance", "bundle", "audit"],
      confidence: 0.88,
      freshness: 0.82,
      importance: 0.72,
    });

    const bundles = await client.bundleRecall({
      spaceId: space.id,
      text: "Bundle import audit",
      limit: 1,
    }, {
      bundleConsumer: "auto",
      primaryLimit: 1,
      supportLimit: 3,
    });

    assert.equal(bundles.length, 1);
    assert.equal(bundles[0]?.route.resolvedConsumer, "reviewer");
    assert.equal(bundles[0]?.route.profileUsed, "reviewer");
    assert.equal(bundles[0]?.route.source, "auto");
    assert.ok(bundles[0]?.route.warnings.includes("contains_provenance_memory"));
    assert.match(bundles[0]?.trace.summary ?? "", /Reviewer hint: includes 1 provenance memory item\(s\)\./);
  } finally {
    client.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("GlialNodeClient de-prioritizes provenance supporting memory for executor bundles unless risk is present", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-client-bundle-provenance-pruning-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const client = new GlialNodeClient({ filename: databasePath });

  try {
    const space = await client.createSpace({ name: "Bundle Provenance Pruning Space" });
    const scope = await client.addScope({
      spaceId: space.id,
      type: "agent",
      label: "executor",
    });

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "task",
      content: "Ship the rollout checklist and deployment notes.",
      summary: "Ship rollout checklist",
      tags: ["release", "actionable"],
      importance: 0.9,
      confidence: 0.92,
      freshness: 0.9,
    });
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "fact",
      content: "Rollout checklist requires signed artifact verification.",
      summary: "Signed artifact verification",
      tags: ["release", "execution"],
      importance: 0.8,
      confidence: 0.85,
      freshness: 0.86,
    });
    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "summary",
      content: "Bundle import audit for rollout trust review.",
      summary: "Bundle import audit",
      tags: ["provenance", "bundle", "audit"],
      importance: 0.7,
      confidence: 0.84,
      freshness: 0.88,
    });

    const noRiskBundles = await client.bundleRecall({
      spaceId: space.id,
      text: "rollout checklist",
      limit: 1,
    }, {
      bundleConsumer: "executor",
      bundleProvenanceMode: "auto",
      primaryLimit: 1,
      supportLimit: 4,
      bundleMaxSupporting: 4,
    });

    assert.equal(noRiskBundles.length, 1);
    assert.equal(noRiskBundles[0]?.route.resolvedConsumer, "executor");
    assert.equal(
      noRiskBundles[0]?.supporting.some((entry) => entry.annotations.includes("provenance")),
      false,
    );

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "summary",
      content: "Second bundle audit record for risky rollout checklist review.",
      summary: "Secondary rollout provenance audit",
      tags: ["provenance", "bundle", "audit"],
      importance: 0.65,
      confidence: 0.82,
      freshness: 0.18,
    });

    const riskBundles = await client.bundleRecall({
      spaceId: space.id,
      text: "rollout checklist",
      limit: 1,
    }, {
      bundleConsumer: "executor",
      bundleProvenanceMode: "auto",
      primaryLimit: 1,
      supportLimit: 5,
      bundleMaxSupporting: 5,
    });

    assert.equal(riskBundles.length, 1);
    const provenanceSupporting = riskBundles[0]?.supporting.filter((entry) => entry.annotations.includes("provenance")) ?? [];
    const primaryHasProvenance = riskBundles[0]?.primary.annotations.includes("provenance") ?? false;
    const totalProvenanceItems = provenanceSupporting.length + (primaryHasProvenance ? 1 : 0);
    assert.ok(riskBundles[0]?.route.warnings.includes("contains_stale_memory"));
    assert.ok(totalProvenanceItems >= 1);
    assert.ok(provenanceSupporting.length <= 1);
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
          preferReviewerOnProvenance: false,
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

    await client.addRecord({
      spaceId: space.id,
      scope: { id: scope.id, type: scope.type },
      tier: "mid",
      kind: "summary",
      content: "Bundle import audit for retrieval policy review.",
      summary: "Bundle import audit",
      tags: ["provenance", "bundle", "audit"],
      confidence: 0.9,
      freshness: 0.88,
      importance: 0.63,
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
