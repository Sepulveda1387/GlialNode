import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../cli/args.js";
import { createRepository, runCommand } from "../cli/commands.js";

test("CLI commands create and query persisted memory", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Demo Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);

    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "writer"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);

    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "decision",
        "--content",
        "Keep working memory small and focused.",
        "--summary",
        "Working memory guideline",
        "--tags",
        "memory,policy",
      ]),
      { repository },
    );

    const searchResult = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "working memory"]),
      { repository },
    );

    assert.equal(searchResult.lines[0], "records=1");
    assert.match(searchResult.lines[1] ?? "", /Working memory guideline/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI status reports the SQLite write-mode contract", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-status-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const result = await runCommand(
      parseArgs(["status"]),
      { repository },
    );

    assert.match(result.lines.join("\n"), /writeMode=single_writer/);
    assert.match(result.lines.join("\n"), /storageAdapter=sqlite/);
    assert.match(result.lines.join("\n"), /storageCrossProcessWrites=single_writer/);
    assert.match(result.lines.join("\n"), /maintenanceSpaces=/);
    assert.match(result.lines.join("\n"), /maintenanceCompactionDeltas=/);
    assert.match(result.lines.join("\n"), /writeGuarantee=One writer should own durable mutations/);
    assert.match(result.lines.join("\n"), /writeNonGoal=GlialNode does not provide a cross-process write broker/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI status can report serialized_local write mode when requested", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-status-serialized-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath, { writeMode: "serialized_local" });

  try {
    const result = await runCommand(
      parseArgs(["status"]),
      { repository },
    );

    assert.match(result.lines.join("\n"), /writeMode=serialized_local/);
    assert.match(result.lines.join("\n"), /writeGuarantee=Caller serializes writes within one local coordination boundary\./);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI status supports machine-readable JSON runtime output", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-status-json-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const result = await runCommand(
      parseArgs(["status", "--json"]),
      {
        repository,
        databasePath,
        databaseExistedAtStartup: true,
        databaseParentExistedAtStartup: true,
      },
    );

    const parsed = JSON.parse(result.lines.join("\n")) as {
      status: string;
      storage: string;
      database: { path: string; existedAtStartup: boolean; parentExistedAtStartup: boolean };
      schema: { upToDate: boolean; latest: number; version: number };
      maintenance: { spacesWithMaintenance: number };
      runtime: { writeMode: string };
    };

    assert.equal(parsed.status, "ready");
    assert.equal(parsed.storage, "sqlite");
    assert.equal(parsed.database.path, databasePath);
    assert.equal(parsed.database.existedAtStartup, true);
    assert.equal(parsed.database.parentExistedAtStartup, true);
    assert.equal(parsed.schema.upToDate, true);
    assert.equal(parsed.maintenance.spacesWithMaintenance, 0);
    assert.equal(parsed.runtime.writeMode, "single_writer");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI status supports versioned JSON envelope output", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-status-envelope-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const result = await runCommand(
      parseArgs(["status", "--json", "--json-envelope"]),
      {
        repository,
        databasePath,
        databaseExistedAtStartup: true,
        databaseParentExistedAtStartup: true,
      },
    );

    const parsed = JSON.parse(result.lines.join("\n")) as {
      schemaVersion: string;
      command: string;
      generatedAt: string;
      data: {
        status: string;
        runtime: { writeMode: string };
      };
    };

    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.equal(parsed.command, "status");
    assert.equal(typeof parsed.generatedAt, "string");
    assert.equal(parsed.data.status, "ready");
    assert.equal(parsed.data.runtime.writeMode, "single_writer");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can inspect storage contracts and migration plans", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-storage-contract-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const contractResult = await runCommand(
      parseArgs(["storage", "contract", "--json"]),
      { repository },
    );
    const contract = JSON.parse(contractResult.lines.join("\n")) as {
      name: string;
      capabilities: { fullTextSearch: boolean; crossProcessWrites: string };
    };

    assert.equal(contract.name, "sqlite");
    assert.equal(contract.capabilities.fullTextSearch, true);
    assert.equal(contract.capabilities.crossProcessWrites, "single_writer");

    const planResult = await runCommand(
      parseArgs(["storage", "migration-plan", "--target", "postgres", "--json"]),
      { repository },
    );
    const plan = JSON.parse(planResult.lines.join("\n")) as {
      source: { name: string };
      target: { name: string; dialect: string };
      requiresSnapshotExport: boolean;
      warnings: string[];
      steps: string[];
    };

    assert.equal(plan.source.name, "sqlite");
    assert.equal(plan.target.name, "postgres");
    assert.equal(plan.target.dialect, "postgres");
    assert.equal(plan.requiresSnapshotExport, true);
    assert.ok(plan.warnings.some((warning) => /Write coordination changes/i.test(warning)));
    assert.ok(plan.steps.some((step) => /snapshot restore path/i.test(step)));
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can report release readiness gates without mutating state", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-release-readiness-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const blockedResult = await runCommand(
      parseArgs(["release", "readiness", "--json"]),
      { repository },
    );
    const blocked = JSON.parse(blockedResult.lines.join("\n")) as {
      status: string;
      checks: Array<{ id: string; status: string }>;
      blockers: string[];
    };

    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.checks.some((check) => check.id === "v1_p0_roadmap" && check.status === "pass"));
    assert.ok(blocked.checks.some((check) => check.id === "user_approved" && check.status === "fail"));
    assert.ok(blocked.blockers.some((blocker) => /user_approved/.test(blocker)));

    const readyResult = await runCommand(
      parseArgs([
        "release",
        "readiness",
        "--tests-green",
        "true",
        "--pack-green",
        "true",
        "--docs-reviewed",
        "true",
        "--tree-clean",
        "true",
        "--user-approved",
        "true",
        "--json",
      ]),
      { repository },
    );
    const ready = JSON.parse(readyResult.lines.join("\n")) as {
      status: string;
      blockers: string[];
      manualInputs: { testsGreen: boolean; packGreen: boolean; docsReviewed: boolean; treeClean: boolean; userApproved: boolean };
    };

    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.blockers, []);
    assert.equal(ready.manualInputs.testsGreen, true);
    assert.equal(ready.manualInputs.packGreen, true);
    assert.equal(ready.manualInputs.docsReviewed, true);
    assert.equal(ready.manualInputs.treeClean, true);
    assert.equal(ready.manualInputs.userApproved, true);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI metrics commands record and report token usage without memory payloads", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-metrics-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const metricsPath = join(tempDirectory, "glialnode.metrics.sqlite");
  const repository = createRepository(databasePath);

  try {
    const recordResult = await runCommand(
      parseArgs([
        "metrics",
        "token-record",
        "--metrics-db",
        metricsPath,
        "--space-id",
        "space_cli",
        "--operation",
        "memory.recall",
        "--provider",
        "openai",
        "--model",
        "gpt-test",
        "--baseline-tokens",
        "1000",
        "--actual-context-tokens",
        "340",
        "--glialnode-overhead-tokens",
        "40",
        "--input-tokens",
        "380",
        "--output-tokens",
        "80",
        "--created-at",
        "2026-04-24T00:00:00.000Z",
        "--json",
      ]),
      { repository, databasePath },
    );

    const recordPayload = JSON.parse(recordResult.lines.join("\n")) as {
      metricsDatabasePath: string;
      record: { estimatedSavedTokens: number };
    };
    assert.equal(recordPayload.metricsDatabasePath, metricsPath);
    assert.equal(recordPayload.record.estimatedSavedTokens, 620);

    const reportResult = await runCommand(
      parseArgs([
        "metrics",
        "token-report",
        "--metrics-db",
        metricsPath,
        "--space-id",
        "space_cli",
        "--granularity",
        "day",
        "--input-cost-per-million",
        "2",
        "--output-cost-per-million",
        "8",
        "--json",
      ]),
      { repository, databasePath },
    );

    const reportPayload = JSON.parse(reportResult.lines.join("\n")) as {
      report: {
        totals: { recordCount: number; estimatedSavedTokens: number; costSaved?: number };
        buckets: Array<{ key: string }>;
      };
    };
    assert.equal(reportPayload.report.totals.recordCount, 1);
    assert.equal(reportPayload.report.totals.estimatedSavedTokens, 620);
    assert.equal(reportPayload.report.buckets[0]?.key, "2026-04-24");
    assert.ok((reportPayload.report.totals.costSaved ?? 0) > 0);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI metrics token-record rejects raw text flags", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-metrics-privacy-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    await assert.rejects(
      () =>
        runCommand(
          parseArgs([
            "metrics",
            "token-record",
            "--operation",
            "memory.recall",
            "--model",
            "gpt-test",
            "--input-tokens",
            "1",
            "--output-tokens",
            "1",
            "--prompt-text",
            "private prompt",
          ]),
          { repository, databasePath },
        ),
      /raw text or secret payloads/,
    );
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI dashboard overview emits schema-versioned JSON snapshots", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-dashboard-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const metricsPath = join(tempDirectory, "glialnode.metrics.sqlite");
  const repository = createRepository(databasePath);

  try {
    const spaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Dashboard CLI Space"]),
      { repository, databasePath },
    );
    const spaceId = spaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const scopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository, databasePath },
    );
    const scopeId = scopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "fact",
        "--content",
        "Dashboard CLI snapshot test memory.",
        "--summary",
        "Dashboard CLI fact",
      ]),
      { repository, databasePath },
    );

    await runCommand(
      parseArgs([
        "metrics",
        "token-record",
        "--metrics-db",
        metricsPath,
        "--space-id",
        spaceId,
        "--agent-id",
        scopeId,
        "--operation",
        "memory.recall",
        "--model",
        "gpt-test",
        "--baseline-tokens",
        "1000",
        "--actual-context-tokens",
        "400",
        "--input-tokens",
        "400",
        "--output-tokens",
        "100",
      ]),
      { repository, databasePath },
    );

    const dashboardResult = await runCommand(
      parseArgs([
        "dashboard",
        "overview",
        "--metrics-db",
        metricsPath,
        "--granularity",
        "all",
        "--json",
      ]),
      { repository, databasePath },
    );

    const payload = JSON.parse(dashboardResult.lines.join("\n")) as {
      snapshot: {
        schemaVersion: string;
        kind: string;
        memory: { activeSpaces: { value: number }; activeRecords: { value: number } };
        value: { savedTokens: { value: number; confidence: string } };
      };
    };

    assert.equal(payload.snapshot.schemaVersion, "1.0.0");
    assert.equal(payload.snapshot.kind, "overview");
    assert.equal(payload.snapshot.memory.activeSpaces.value, 1);
    assert.equal(payload.snapshot.memory.activeRecords.value, 1);
    assert.equal(payload.snapshot.value.savedTokens.value, 600);
    assert.equal(payload.snapshot.value.savedTokens.confidence, "estimated");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI doctor reports runtime and registry health in JSON", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-doctor-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "keygen", "--name", "doctor-key", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    await runCommand(
      parseArgs(["preset", "trust-local-key", "--name", "doctor-key", "--trust-name", "doctor-anchor", "--directory", presetDirectory]),
      { repository },
    );

    const result = await runCommand(
      parseArgs(["doctor", "--preset-directory", presetDirectory, "--json"]),
      {
        repository,
        databasePath,
        databaseExistedAtStartup: true,
        databaseParentExistedAtStartup: true,
      },
    );

    const parsed = JSON.parse(result.lines.join("\n")) as {
      status: string;
      database: { kind: string; walSidecarPresent: boolean; shmSidecarPresent: boolean };
      schema: { upToDate: boolean };
      presetRegistry: { kind: string; presetFileCount: number };
      signerStore: { kind: string; fileCount: number };
      trustStore: { kind: string; fileCount: number; revokedCount: number };
      warnings: string[];
    };

    assert.equal(parsed.status, "ready");
    assert.equal(parsed.database.kind, "file");
    assert.equal(parsed.schema.upToDate, true);
    assert.equal(parsed.presetRegistry.kind, "directory");
    assert.equal(parsed.presetRegistry.presetFileCount, 0);
    assert.equal(parsed.signerStore.kind, "directory");
    assert.equal(parsed.signerStore.fileCount, 1);
    assert.equal(parsed.trustStore.kind, "directory");
    assert.equal(parsed.trustStore.fileCount, 1);
    assert.equal(parsed.trustStore.revokedCount, 0);
    assert.deepEqual(parsed.warnings, []);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI doctor flags invalid trusted signer store paths", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-doctor-invalid-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    mkdirSync(presetDirectory, { recursive: true });
    writeFileSync(join(presetDirectory, ".trusted"), "not-a-directory", "utf8");

    const result = await runCommand(
      parseArgs(["doctor", "--preset-directory", presetDirectory, "--json"]),
      {
        repository,
        databasePath,
        databaseExistedAtStartup: true,
        databaseParentExistedAtStartup: true,
      },
    );

    const parsed = JSON.parse(result.lines.join("\n")) as {
      status: string;
      trustStore: { kind: string; fileCount: number };
      warnings: string[];
    };

    assert.equal(parsed.status, "attention");
    assert.equal(parsed.trustStore.kind, "file");
    assert.equal(parsed.trustStore.fileCount, 0);
    assert.match(parsed.warnings.join("\n"), /Trusted signer store path is not a directory/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can create and configure spaces from presets with explicit overrides", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Preset Space",
        "--preset", "planning-heavy",
      ]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space", "configure",
        "--id", spaceId,
        "--preset", "execution-first",
        "--routing-prefer-executor-on-actionable", "false",
      ]),
      { repository },
    );

    const showResult = await runCommand(
      parseArgs(["space", "show", "--id", spaceId]),
      { repository },
    );

    const settingsLine = showResult.lines.find((line) => line.startsWith("settings="));
    const effectiveSettingsLine = showResult.lines.find((line) => line.startsWith("effectiveSettings="));
    const settingsOriginLine = showResult.lines.find((line) => line.startsWith("settingsOrigin="));
    assert.ok(settingsLine);
    assert.ok(effectiveSettingsLine);
    assert.ok(settingsOriginLine);
    const settings = JSON.parse(settingsLine!.slice("settings=".length)) as {
      routing?: {
        preferExecutorOnActionable?: boolean;
        preferPlannerOnDistilled?: boolean;
      };
      reinforcement?: {
        confidenceBoost?: number;
      };
      provenance?: {
        trustProfile?: string;
        trustedSignerNames?: string[];
      };
    };
    const effectiveSettings = JSON.parse(effectiveSettingsLine!.slice("effectiveSettings=".length)) as {
      routing?: {
        preferExecutorOnActionable?: boolean;
        preferPlannerOnDistilled?: boolean;
      };
    };
    const settingsOrigin = JSON.parse(settingsOriginLine!.slice("settingsOrigin=".length)) as {
      routing?: {
        preferExecutorOnActionable?: string;
        preferPlannerOnDistilled?: string;
      };
    };

    assert.equal(settings.routing?.preferExecutorOnActionable, false);
    assert.equal(settings.routing?.preferPlannerOnDistilled, false);
    assert.equal(settings.reinforcement?.confidenceBoost, 0.1);
    assert.equal(effectiveSettings.routing?.preferExecutorOnActionable, false);
    assert.equal(effectiveSettings.routing?.preferPlannerOnDistilled, false);
    assert.equal(settingsOrigin.routing?.preferExecutorOnActionable, "space");
    assert.equal(settingsOrigin.routing?.preferPlannerOnDistilled, "space");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can store provenance settings on a space and use them for bundle validation", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-space-provenance-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    const createSpace = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Trusted Space",
        "--provenance-trust-profile", "anchored",
        "--provenance-trust-signer", "team-anchor",
      ]),
      { repository },
    );
    const spaceId = createSpace.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "team-executor-key",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "team-executor-key",
        "--trust-name", "team-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "bundle-export",
        "--name", "team-executor",
        "--output", bundlePath,
        "--directory", presetDirectory,
        "--signing-key", "team-executor-key",
      ]),
      { repository },
    );

    const showResult = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--space-id", spaceId,
      ]),
      { repository },
    );
    assert.match(showResult.lines.join("\n"), /trustProfile=anchored/);
    assert.match(showResult.lines.join("\n"), /matchedTrustedSigners=team-anchor/);

    const importResult = await runCommand(
      parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--name", "team-executor-imported",
        "--space-id", spaceId,
      ]),
      { repository },
    );
    assert.match(importResult.lines.join("\n"), /trusted=true/);

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /recentProvenanceEvents=2/);
    assert.match(report.lines.join("\n"), /provenanceSummaryRecords=2/);
    assert.match(report.lines.join("\n"), /bundle_reviewed/);
    assert.match(report.lines.join("\n"), /bundle_imported/);

    const auditSearch = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "Bundle import audit"]),
      { repository },
    );
    assert.match(auditSearch.lines.join("\n"), /Bundle import audit/);

    const auditBundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "Bundle import audit",
        "--limit", "1",
        "--support-limit", "3",
        "--bundle-consumer", "reviewer",
      ]),
      { repository },
    );
    const parsedBundle = JSON.parse(auditBundle.lines.join("\n")) as Array<{
      trace: { citations: Array<{ reason: string }> };
      primary: { annotations: string[] };
      hints: string[];
    }>;
    assert.ok(parsedBundle[0]?.primary.annotations.includes("provenance"));
    assert.ok(parsedBundle[0]?.hints.includes("contains_provenance_memory"));
    assert.match(parsedBundle[0]?.trace.citations.map((citation) => citation.reason).join(" "), /provenance audit/i);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI supports stable machine-readable JSON output for space and memory read flows", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-json-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "JSON Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "writer"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "decision",
        "--content",
        "Keep working memory small and focused.",
        "--summary",
        "Working memory guideline",
        "--tags",
        "memory,policy",
      ]),
      { repository },
    );

    const showResult = await runCommand(
      parseArgs(["space", "show", "--id", spaceId, "--json"]),
      { repository },
    );
    const parsedShow = JSON.parse(showResult.lines.join("\n")) as {
      space: { id: string; name: string };
      policy: {
        effective: { maxShortTermRecords: number };
        origin: { maxShortTermRecords: string };
      };
    };
    assert.equal(parsedShow.space.id, spaceId);
    assert.equal(parsedShow.space.name, "JSON Space");
    assert.equal(parsedShow.policy.effective.maxShortTermRecords, 50);
    assert.equal(parsedShow.policy.origin.maxShortTermRecords, "default");

    const reportResult = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--json"]),
      { repository },
    );
    const parsedReport = JSON.parse(reportResult.lines.join("\n")) as {
      report: { spaceId: string; recordCount: number; eventCountsByType: Record<string, number> };
      policy: { effective: { routing: { staleThreshold: number } } };
    };
    assert.equal(parsedReport.report.spaceId, spaceId);
    assert.equal(parsedReport.report.recordCount, 1);
    assert.equal(typeof parsedReport.report.eventCountsByType, "object");
    assert.equal(parsedReport.policy.effective.routing.staleThreshold, 0.35);

    const searchResult = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "working memory", "--json"]),
      { repository },
    );
    const parsedSearch = JSON.parse(searchResult.lines.join("\n")) as {
      count: number;
      records: Array<{ summary?: string }>;
    };
    assert.equal(parsedSearch.count, 1);
    assert.equal(parsedSearch.records[0]?.summary, "Working memory guideline");

    const semanticSearchResult = await runCommand(
      parseArgs([
        "memory", "search",
        "--space-id", spaceId,
        "--text", "working memory",
        "--semantic-prototype", "true",
        "--semantic-weight", "0.6",
        "--json",
      ]),
      { repository },
    );
    const parsedSemanticSearch = JSON.parse(semanticSearchResult.lines.join("\n")) as {
      count: number;
      records: Array<{ summary?: string }>;
    };
    assert.equal(parsedSemanticSearch.count, 1);
    assert.equal(parsedSemanticSearch.records[0]?.summary, "Working memory guideline");

    const recallResult = await runCommand(
      parseArgs(["memory", "recall", "--space-id", spaceId, "--text", "working memory", "--json"]),
      { repository },
    );
    const parsedRecall = JSON.parse(recallResult.lines.join("\n")) as {
      count: number;
      packs: Array<{ primary: { summary?: string } }>;
    };
    assert.equal(parsedRecall.count, 1);
    assert.equal(parsedRecall.packs[0]?.primary.summary, "Working memory guideline");

    const traceResult = await runCommand(
      parseArgs(["memory", "trace", "--space-id", spaceId, "--text", "working memory", "--json"]),
      { repository },
    );
    const parsedTrace = JSON.parse(traceResult.lines.join("\n")) as {
      count: number;
      traces: Array<{ summary: string }>;
    };
    assert.equal(parsedTrace.count, 1);
    assert.match(parsedTrace.traces[0]?.summary ?? "", /Recalled/);

    const bundleResult = await runCommand(
      parseArgs(["memory", "bundle", "--space-id", spaceId, "--text", "working memory", "--json"]),
      { repository },
    );
    const parsedBundle = JSON.parse(bundleResult.lines.join("\n")) as {
      count: number;
      bundles: Array<{ primary: { summary?: string } }>;
    };
    assert.equal(parsedBundle.count, 1);
    assert.equal(parsedBundle.bundles[0]?.primary.summary, "Working memory guideline");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI memory semantic-eval emits a gate report and can write it to disk", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-semantic-eval-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const corpusPath = join(tempDirectory, "semantic-corpus.json");
  const outputPath = join(tempDirectory, "semantic-eval-report.json");
  const repository = createRepository(databasePath);

  try {
    writeFileSync(corpusPath, JSON.stringify({
      version: 1,
      scenarios: [
        {
          id: "semantic_eval_basic",
          description: "Basic lexical match",
          queryText: "rollout checklist",
          records: [
            {
              summary: "Rollout checklist",
              content: "Ship rollout checklist with validation.",
              kind: "task",
            },
          ],
          expect: {
            primarySummaryContains: "rollout checklist",
          },
        },
      ],
    }, null, 2), "utf8");

    const result = await runCommand(
      parseArgs([
        "memory", "semantic-eval",
        "--corpus", corpusPath,
        "--output", outputPath,
        "--json",
      ]),
      { repository },
    );
    const parsed = JSON.parse(result.lines.join("\n")) as {
      schemaVersion: string;
      passed: boolean;
      reportId: string;
      gate: { reason: string };
    };

    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.equal(typeof parsed.passed, "boolean");
    assert.equal(typeof parsed.reportId, "string");
    assert.equal(typeof parsed.gate.reason, "string");

    const written = JSON.parse(readFileSync(outputPath, "utf8")) as {
      schemaVersion: string;
      reportId: string;
    };
    assert.equal(written.schemaVersion, "1.0.0");
    assert.equal(written.reportId, parsed.reportId);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI rejects semantic gate require-pass mode without a report file", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-semantic-gate-require-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const created = await runCommand(
      parseArgs(["space", "create", "--name", "Semantic Gate Space"]),
      { repository },
    );
    const spaceId = created.lines.find((line) => line.startsWith("id="))?.slice(3) ?? "";
    const scope = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = scope.lines.find((line) => line.startsWith("id="))?.slice(3) ?? "";

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval baseline",
        "--summary", "Lexical baseline",
      ]),
      { repository },
    );

    await assert.rejects(
      runCommand(
        parseArgs([
          "memory", "search",
          "--space-id", spaceId,
          "--text", "lexical baseline",
          "--semantic-prototype", "true",
          "--semantic-gate-require-pass", "true",
          "--json",
        ]),
        { repository },
      ),
      /Missing required semantic gate report/,
    );
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI supports stable machine-readable JSON output for preset bundle review and import", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-json-bundle-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "team-executor-key",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "bundle-export",
        "--name", "team-executor",
        "--output", bundlePath,
        "--directory", presetDirectory,
        "--signing-key", "team-executor-key",
      ]),
      { repository },
    );

    const showResult = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--json",
      ]),
      { repository },
    );
    const parsedShow = JSON.parse(showResult.lines.join("\n")) as {
      bundle: { preset: { name: string } };
      validation: { trusted: boolean };
    };
    assert.equal(parsedShow.bundle.preset.name, "team-executor");
    assert.equal(parsedShow.validation.trusted, true);

    const importResult = await runCommand(
      parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--name", "team-executor-imported",
        "--json",
      ]),
      { repository },
    );
    const parsedImport = JSON.parse(importResult.lines.join("\n")) as {
      importedPresetName: string;
      bundleName: string;
      versions: number;
      validation: { trusted: boolean };
    };
    assert.equal(parsedImport.importedPresetName, "team-executor-imported");
    assert.equal(parsedImport.bundleName, "team-executor");
    assert.equal(parsedImport.versions, 1);
    assert.equal(parsedImport.validation.trusted, true);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can list and show preset definitions", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-show-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const listResult = await runCommand(
      parseArgs(["preset", "list"]),
      { repository },
    );
    assert.equal(listResult.lines[0], "presets=4");
    assert.match(listResult.lines.join("\n"), /execution-first/);

    const showResult = await runCommand(
      parseArgs(["preset", "show", "--name", "conservative-review"]),
      { repository },
    );
    assert.equal(showResult.lines[0], "name=conservative-review");
    assert.match(showResult.lines[1] ?? "", /cautious trust management/i);
    assert.match(showResult.lines.join("\n"), /version=1.0.0/);
    assert.match(showResult.lines.join("\n"), /preferReviewerOnContested/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can diff built-in preset definitions", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-diff-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const diffResult = await runCommand(
      parseArgs([
        "preset",
        "diff",
        "--left", "builtin:execution-first",
        "--right", "builtin:conservative-review",
      ]),
      { repository },
    );

    const output = diffResult.lines.join("\n");
    assert.match(output, /left=execution-first@1.0.0/);
    assert.match(output, /right=conservative-review@1.0.0/);
    assert.match(output, /metadataChanges=/);
    assert.match(output, /settingChanges=/);
    assert.match(output, /settings\.routing\.preferExecutorOnActionable/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can export a preset file and apply it to a new space", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-file-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const repository = createRepository(databasePath);

  try {
    const exportResult = await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    assert.equal(exportResult.lines[0], "Preset exported.");

    const showResult = await runCommand(
      parseArgs(["preset", "show", "--input", presetPath]),
      { repository },
    );
    assert.equal(showResult.lines[0], "name=execution-first");

    const createSpaceResult = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Preset File Space",
        "--preset-file", presetPath,
      ]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const spaceShowResult = await runCommand(
      parseArgs(["space", "show", "--id", spaceId]),
      { repository },
    );
    assert.match(spaceShowResult.lines.join("\n"), /preferExecutorOnActionable/);
    assert.match(spaceShowResult.lines.join("\n"), /"preferPlannerOnDistilled":false/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can register a local preset and reuse it by name", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-registry-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );

    const registerResult = await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--author", "GlialNode Test",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.equal(registerResult.lines[0], "Preset registered.");

    const listResult = await runCommand(
      parseArgs(["preset", "local-list", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(listResult.lines[0], "presets=1");
    assert.match(listResult.lines[1] ?? "", /team-executor/);

    const createSpaceResult = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Registered Preset Space",
        "--preset-local", "team-executor",
        "--preset-directory", presetDirectory,
      ]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const showResult = await runCommand(
      parseArgs(["space", "show", "--id", spaceId]),
      { repository },
    );
    assert.match(showResult.lines.join("\n"), /preferExecutorOnActionable/);
    assert.match(showResult.lines.join("\n"), /"preferPlannerOnDistilled":false/);

    const presetShowResult = await runCommand(
      parseArgs(["preset", "local-show", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(presetShowResult.lines.join("\n"), /version=2.1.0/);
    assert.match(presetShowResult.lines.join("\n"), /author=GlialNode Test/);
    assert.match(presetShowResult.lines.join("\n"), /source=.*execution-first\.json/);

    const historyResult = await runCommand(
      parseArgs(["preset", "history", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(historyResult.lines[0], "versions=1");
    assert.match(historyResult.lines.join("\n"), /2.1.0/);
    assert.match(historyResult.lines.join("\n"), /author=GlialNode Test/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can manage local signing keys", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-signing-keys-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const publicKeyPath = join(tempDirectory, "team-executor.public.pem");
  const repository = createRepository(databasePath);

  try {
    const generated = await runCommand(
      parseArgs(["preset", "keygen", "--name", "team-executor", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(generated.lines[0], "Signing key generated.");
    assert.doesNotMatch(generated.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);
    const keyId = generated.lines.find((line) => line.startsWith("keyId="))?.slice(6);
    assert.ok(keyId);

    const listed = await runCommand(
      parseArgs(["preset", "key-list", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(listed.lines.join("\n"), /keys=1/);
    assert.match(listed.lines.join("\n"), /team-executor/);
    assert.doesNotMatch(listed.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const shown = await runCommand(
      parseArgs(["preset", "key-show", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(shown.lines.join("\n"), /algorithm=ed25519/);
    assert.match(shown.lines.join("\n"), /signer=GlialNode Test/);
    assert.doesNotMatch(shown.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const keyPath = join(presetDirectory, ".keys", "team-executor.json");
    assert.match(readFileSync(keyPath, "utf8"), /BEGIN PRIVATE KEY/);
    if (process.platform !== "win32") {
      const keyDirectoryMode = statSync(join(presetDirectory, ".keys")).mode & 0o777;
      assert.equal(keyDirectoryMode & 0o077, 0, `expected private key directory to hide group/other bits, got ${keyDirectoryMode.toString(8)}`);
      const mode = statSync(keyPath).mode & 0o777;
      assert.equal(mode & 0o077, 0, `expected private key file to hide group/other bits, got ${mode.toString(8)}`);
    }

    const exported = await runCommand(
      parseArgs(["preset", "key-export", "--name", "team-executor", "--output", publicKeyPath, "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(exported.lines[0], "Signing public key exported.");
    assert.doesNotMatch(exported.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);
    assert.match(readFileSync(publicKeyPath, "utf8"), /BEGIN PUBLIC KEY/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can manage trusted signers", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-trusted-signers-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const publicKeyPath = join(tempDirectory, "team-executor.public.pem");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "keygen", "--name", "team-executor-key", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    const trustedFromLocal = await runCommand(
      parseArgs(["preset", "trust-local-key", "--name", "team-executor-key", "--trust-name", "team-anchor", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(trustedFromLocal.lines[0], "Trusted signer registered from local key.");
    assert.doesNotMatch(trustedFromLocal.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    await runCommand(
      parseArgs(["preset", "key-export", "--name", "team-executor-key", "--output", publicKeyPath, "--directory", presetDirectory]),
      { repository },
    );
    const trustedFromFile = await runCommand(
      parseArgs(["preset", "trust-register", "--input", publicKeyPath, "--name", "team-public", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(trustedFromFile.lines[0], "Trusted signer registered.");
    assert.doesNotMatch(trustedFromFile.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const listed = await runCommand(
      parseArgs(["preset", "trust-list", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(listed.lines.join("\n"), /trustedSigners=2/);
    assert.match(listed.lines.join("\n"), /team-anchor/);
    assert.match(listed.lines.join("\n"), /team-public/);
    assert.doesNotMatch(listed.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const shown = await runCommand(
      parseArgs(["preset", "trust-show", "--name", "team-anchor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(shown.lines.join("\n"), /algorithm=ed25519/);
    assert.match(shown.lines.join("\n"), /source=signing-key:team-executor-key/);
    assert.doesNotMatch(shown.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const trustedPath = join(presetDirectory, ".trusted", "team-anchor.json");
    assert.doesNotMatch(readFileSync(trustedPath, "utf8"), /BEGIN PRIVATE KEY/);
    if (process.platform !== "win32") {
      const trustedDirectoryMode = statSync(join(presetDirectory, ".trusted")).mode & 0o777;
      assert.equal(trustedDirectoryMode & 0o022, 0, `expected trusted signer directory to avoid group/other write bits, got ${trustedDirectoryMode.toString(8)}`);
      const mode = statSync(trustedPath).mode & 0o777;
      assert.equal(mode & 0o022, 0, `expected trusted signer file to avoid group/other write bits, got ${mode.toString(8)}`);
    }

    const rotated = await runCommand(
      parseArgs([
        "preset", "trust-rotate",
        "--name", "team-anchor",
        "--input", publicKeyPath,
        "--next-name", "team-anchor-v2",
        "--signer", "GlialNode Test",
        "--source", "rotation-test",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.equal(rotated.lines[0], "Trusted signer rotated.");
    assert.doesNotMatch(rotated.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);

    const revokedShow = await runCommand(
      parseArgs(["preset", "trust-show", "--name", "team-anchor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(revokedShow.lines.join("\n"), /replacedBy=team-anchor-v2/);
    assert.match(revokedShow.lines.join("\n"), /revokedAt=/);

    const revoked = await runCommand(
      parseArgs(["preset", "trust-revoke", "--name", "team-public", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(revoked.lines[0], "Trusted signer revoked.");
    assert.doesNotMatch(revoked.lines.join("\n"), /BEGIN (PRIVATE|PUBLIC) KEY/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI lists trust profiles", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-trust-profiles-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const result = await runCommand(
      parseArgs(["preset", "trust-profile-list"]),
      { repository },
    );
    assert.match(result.lines.join("\n"), /profiles=3/);
    assert.match(result.lines.join("\n"), /permissive/);
    assert.match(result.lines.join("\n"), /signed/);
    assert.match(result.lines.join("\n"), /anchored/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can manage trust policy packs and apply them to bundle validation", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-trust-packs-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs(["preset", "keygen", "--name", "team-executor-key", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "bundle-export",
        "--name", "team-executor",
        "--output", bundlePath,
        "--directory", presetDirectory,
        "--origin", "local-dev",
        "--signing-key", "team-executor-key",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "preset", "trust-pack-register",
        "--name", "strict-signed",
        "--base-profile", "signed",
        "--allow-origin", "production",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-pack-register",
        "--name", "strict-signed-anchor",
        "--inherits", "strict-signed",
        "--trust-signer", "team-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const listed = await runCommand(
      parseArgs(["preset", "trust-pack-list", "--directory", presetDirectory, "--json"]),
      { repository },
    );
    const parsedList = JSON.parse(listed.lines.join("\n")) as {
      count: number;
      packs: Array<{ name: string }>;
    };
    assert.equal(parsedList.count, 2);
    assert.ok(parsedList.packs.some((pack) => pack.name === "strict-signed"));
    assert.ok(parsedList.packs.some((pack) => pack.name === "strict-signed-anchor"));

    const shown = await runCommand(
      parseArgs(["preset", "trust-pack-show", "--name", "strict-signed-anchor", "--directory", presetDirectory, "--json"]),
      { repository },
    );
    const parsedShow = JSON.parse(shown.lines.join("\n")) as {
      baseProfile?: string;
      policy: { allowedOrigins?: string[]; trustedSignerNames?: string[] };
    };
    assert.equal(parsedShow.baseProfile, "signed");
    assert.deepEqual(parsedShow.policy.allowedOrigins, ["production"]);
    assert.deepEqual(parsedShow.policy.trustedSignerNames, ["team-anchor"]);

    const failed = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--trust-pack", "strict-signed",
        "--trust-explain",
        "--json",
      ]),
      { repository },
    );
    const failedPayload = JSON.parse(failed.lines.join("\n")) as {
      validation: {
        trusted: boolean;
        report: { policyFailures: string[] };
      };
    };
    assert.equal(failedPayload.validation.trusted, false);
    assert.ok(failedPayload.validation.report.policyFailures.some((failure) => /origin is not allowed/i.test(failure)));

    const passed = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--trust-pack", "strict-signed",
        "--allow-origin", "local-dev",
      ]),
      { repository },
    );
    assert.match(passed.lines.join("\n"), /trusted=true/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can roll back a local preset to an earlier version", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-rollback-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    await runCommand(
      parseArgs(["preset", "export", "--name", "planning-heavy", "--output", alternatePresetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", alternatePresetPath,
        "--name", "team-executor",
        "--version", "2.2.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const rollbackResult = await runCommand(
      parseArgs([
        "preset", "rollback",
        "--name", "team-executor",
        "--to-version", "2.1.0",
        "--author", "Rollback Test",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.equal(rollbackResult.lines[0], "Preset rolled back.");
    assert.match(rollbackResult.lines.join("\n"), /version=2.1.0/);
    assert.match(rollbackResult.lines.join("\n"), /source=rollback:2.1.0/);

    const current = await runCommand(
      parseArgs(["preset", "local-show", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(current.lines.join("\n"), /version=2.1.0/);
    assert.match(current.lines.join("\n"), /source=rollback:2.1.0/);

    const history = await runCommand(
      parseArgs(["preset", "history", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(history.lines.join("\n"), /2.2.0/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can promote preset versions into named channels", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-channel-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    await runCommand(
      parseArgs(["preset", "export", "--name", "planning-heavy", "--output", alternatePresetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", alternatePresetPath,
        "--name", "team-executor",
        "--version", "2.2.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const promoteStable = await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "stable",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.equal(promoteStable.lines[0], "Preset promoted.");

    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "candidate",
        "--version", "2.2.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const channels = await runCommand(
      parseArgs(["preset", "channel-list", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(channels.lines.join("\n"), /stable=2.1.0/);
    assert.match(channels.lines.join("\n"), /candidate=2.2.0/);

    const showStable = await runCommand(
      parseArgs([
        "preset", "channel-show",
        "--name", "team-executor",
        "--channel", "stable",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.match(showStable.lines.join("\n"), /version=2.1.0/);
    assert.match(showStable.lines.join("\n"), /"preferPlannerOnDistilled":false/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can create and configure spaces from preset channels", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-preset-channel-space-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const alternatePresetPath = join(tempDirectory, "planning-heavy.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "stable",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const createSpaceResult = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Channel Space",
        "--preset-local", "team-executor",
        "--preset-channel", "stable",
        "--preset-directory", presetDirectory,
      ]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const createdSpace = await runCommand(
      parseArgs(["space", "show", "--id", spaceId]),
      { repository },
    );
    assert.match(createdSpace.lines.join("\n"), /"preferPlannerOnDistilled":false/);

    await runCommand(
      parseArgs(["preset", "export", "--name", "planning-heavy", "--output", alternatePresetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", alternatePresetPath,
        "--name", "team-executor",
        "--version", "2.2.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "candidate",
        "--version", "2.2.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const configured = await runCommand(
      parseArgs([
        "space", "configure",
        "--id", spaceId,
        "--preset-local", "team-executor",
        "--preset-channel", "candidate",
        "--preset-directory", presetDirectory,
      ]),
      { repository },
    );
    assert.match(configured.lines.join("\n"), /"preferPlannerOnDistilled":true/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can use a preset default channel for space setup", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-default-channel-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "stable",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const defaultResult = await runCommand(
      parseArgs([
        "preset", "channel-default",
        "--name", "team-executor",
        "--channel", "stable",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.equal(defaultResult.lines[0], "Preset default channel set.");

    const channelList = await runCommand(
      parseArgs(["preset", "channel-list", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(channelList.lines.join("\n"), /defaultChannel=stable/);

    const channelShow = await runCommand(
      parseArgs(["preset", "channel-show", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(channelShow.lines.join("\n"), /channel=stable/);

    const createSpaceResult = await runCommand(
      parseArgs([
        "space", "create",
        "--name", "Default Channel Space",
        "--preset-local", "team-executor",
        "--preset-directory", presetDirectory,
      ]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const createdSpace = await runCommand(
      parseArgs(["space", "show", "--id", spaceId]),
      { repository },
    );
    assert.match(createdSpace.lines.join("\n"), /"preferPlannerOnDistilled":false/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can export and import preset channel manifests", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-channel-io-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const manifestPath = join(tempDirectory, "channels.json");
  const sourcePresetDirectory = join(tempDirectory, "source-presets");
  const targetPresetDirectory = join(tempDirectory, "target-presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "stable",
        "--version", "2.1.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "channel-default",
        "--name", "team-executor",
        "--channel", "stable",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );

    const exported = await runCommand(
      parseArgs([
        "preset", "channel-export",
        "--name", "team-executor",
        "--output", manifestPath,
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    assert.equal(exported.lines[0], "Preset channels exported.");

    const imported = await runCommand(
      parseArgs([
        "preset", "channel-import",
        "--input", manifestPath,
        "--name", "team-executor-copy",
        "--directory", targetPresetDirectory,
      ]),
      { repository },
    );
    assert.equal(imported.lines[0], "Preset channels imported.");
    assert.match(imported.lines.join("\n"), /defaultChannel=stable/);

    const listed = await runCommand(
      parseArgs(["preset", "channel-list", "--name", "team-executor-copy", "--directory", targetPresetDirectory]),
      { repository },
    );
    assert.match(listed.lines.join("\n"), /defaultChannel=stable/);
    assert.match(listed.lines.join("\n"), /stable=2.1.0/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can export and import full preset bundles", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-bundle-io-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const altPresetPath = join(tempDirectory, "planning-heavy.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const sourcePresetDirectory = join(tempDirectory, "source-presets");
  const targetPresetDirectory = join(tempDirectory, "target-presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs(["preset", "export", "--name", "planning-heavy", "--output", altPresetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", altPresetPath,
        "--name", "team-executor",
        "--version", "2.2.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "stable",
        "--version", "2.1.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "promote",
        "--name", "team-executor",
        "--channel", "candidate",
        "--version", "2.2.0",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "channel-default",
        "--name", "team-executor",
        "--channel", "stable",
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );

    const exported = await runCommand(
      parseArgs([
        "preset", "bundle-export",
        "--name", "team-executor",
        "--output", bundlePath,
        "--directory", sourcePresetDirectory,
      ]),
      { repository },
    );
    assert.equal(exported.lines[0], "Preset bundle exported.");

    const imported = await runCommand(
      parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--name", "team-executor-copy",
        "--directory", targetPresetDirectory,
      ]),
      { repository },
    );
    assert.equal(imported.lines[0], "Preset bundle imported.");
    assert.match(imported.lines.join("\n"), /defaultChannel=stable/);

    const localShow = await runCommand(
      parseArgs(["preset", "local-show", "--name", "team-executor-copy", "--directory", targetPresetDirectory]),
      { repository },
    );
    assert.match(localShow.lines.join("\n"), /version=2.2.0/);

    const history = await runCommand(
      parseArgs(["preset", "history", "--name", "team-executor-copy", "--directory", targetPresetDirectory]),
      { repository },
    );
    assert.match(history.lines.join("\n"), /2.1.0/);
    assert.match(history.lines.join("\n"), /2.2.0/);

    const channels = await runCommand(
      parseArgs(["preset", "channel-list", "--name", "team-executor-copy", "--directory", targetPresetDirectory]),
      { repository },
    );
    assert.match(channels.lines.join("\n"), /stable=2.1.0/);
    assert.match(channels.lines.join("\n"), /candidate=2.2.0/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI preset bundle import enforces explicit collision policy", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-bundle-collision-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const presetDirectory = join(tempDirectory, "presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs(["preset", "register", "--input", presetPath, "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    await runCommand(
      parseArgs(["preset", "bundle-export", "--name", "team-executor", "--output", bundlePath, "--directory", presetDirectory]),
      { repository },
    );

    await assert.rejects(
      () => runCommand(
        parseArgs(["preset", "bundle-import", "--input", bundlePath, "--directory", presetDirectory]),
        { repository },
      ),
      /Preset already exists: team-executor\. Use collisionPolicy=overwrite or collisionPolicy=rename\./,
    );

    const overwritten = await runCommand(
      parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--collision", "overwrite",
      ]),
      { repository },
    );
    assert.match(overwritten.lines.join("\n"), /collisionPolicy=overwrite/);

    const renamed = await runCommand(
      parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--directory", presetDirectory,
        "--collision", "rename",
      ]),
      { repository },
    );
    assert.match(renamed.lines.join("\n"), /name=team-executor imported/);
    assert.match(renamed.lines.join("\n"), /collisionPolicy=rename/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI validates preset bundle metadata and rejects unsupported formats", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-bundle-validation-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetPath = join(tempDirectory, "execution-first.json");
  const bundlePath = join(tempDirectory, "team-executor.bundle.json");
  const invalidBundlePath = join(tempDirectory, "team-executor.invalid.bundle.json");
  const tamperedBundlePath = join(tempDirectory, "team-executor.tampered.bundle.json");
  const invalidSignatureBundlePath = join(tempDirectory, "team-executor.invalid-signature.bundle.json");
  const presetDirectory = join(tempDirectory, "source-presets");
  const repository = createRepository(databasePath);

  try {
    await runCommand(
      parseArgs(["preset", "export", "--name", "execution-first", "--output", presetPath]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "register",
        "--input", presetPath,
        "--name", "team-executor",
        "--version", "2.1.0",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    const generatedKey = await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "team-executor-key",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    const signerKeyId = generatedKey.lines.find((line) => line.startsWith("keyId="))?.slice(6);
    assert.ok(signerKeyId);

    const exported = await runCommand(
      parseArgs([
        "preset", "bundle-export",
        "--name", "team-executor",
        "--output", bundlePath,
        "--directory", presetDirectory,
        "--origin", "local-dev",
        "--signing-key", "team-executor-key",
      ]),
      { repository },
    );
    assert.equal(exported.lines[0], "Preset bundle exported.");
    assert.match(exported.lines.join("\n"), /checksum=/);

    const shown = await runCommand(
      parseArgs(["preset", "bundle-show", "--input", bundlePath, "--trust-profile", "signed"]),
      { repository },
    );
    assert.match(shown.lines.join("\n"), /bundleFormatVersion=1/);
    assert.match(shown.lines.join("\n"), /warnings=0/);
    assert.match(shown.lines.join("\n"), /origin=local-dev/);
    assert.match(shown.lines.join("\n"), /signer=GlialNode Test/);
    assert.match(shown.lines.join("\n"), /checksumAlgorithm=sha256/);
    assert.match(shown.lines.join("\n"), /signatureAlgorithm=ed25519/);
    assert.match(shown.lines.join("\n"), new RegExp(`signerKeyId=${signerKeyId}`));
    assert.match(shown.lines.join("\n"), /signed=true/);
    assert.match(shown.lines.join("\n"), /trusted=true/);
    assert.match(shown.lines.join("\n"), /trustProfile=signed/);
    assert.match(shown.lines.join("\n"), new RegExp(`reportSignerKeyId=${signerKeyId}`));

    const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
      metadata: { bundleFormatVersion: number };
    };
    bundle.metadata.bundleFormatVersion = 999;
    writeFileSync(invalidBundlePath, JSON.stringify(bundle, null, 2), "utf8");

    await assert.rejects(
      () => runCommand(parseArgs(["preset", "bundle-show", "--input", invalidBundlePath]), { repository }),
      /Unsupported preset bundle format: 999/,
    );
    await assert.rejects(
      () => runCommand(parseArgs(["preset", "bundle-import", "--input", invalidBundlePath]), { repository }),
      /Unsupported preset bundle format: 999/,
    );

    const tamperedBundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
      preset: { summary: string };
    };
    tamperedBundle.preset.summary = "tampered";
    writeFileSync(tamperedBundlePath, JSON.stringify(tamperedBundle, null, 2), "utf8");

    await assert.rejects(
      () => runCommand(parseArgs(["preset", "bundle-show", "--input", tamperedBundlePath]), { repository }),
      /Preset bundle checksum verification failed/,
    );

    await assert.rejects(
      () => runCommand(parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--allow-origin", "production",
      ]), { repository }),
      /Preset bundle trust validation failed: Preset bundle origin is not allowed: local-dev/,
    );

    await assert.rejects(
      () => runCommand(parseArgs([
        "preset", "bundle-import",
        "--input", bundlePath,
        "--require-signer",
        "--require-signature",
        "--allow-signer", "Trusted CI",
      ]), { repository }),
      /Preset bundle trust validation failed: Preset bundle signer is not allowed: GlialNode Test/,
    );
    await assert.rejects(
      () => runCommand(parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--allow-key-id", "deadbeef",
      ]), { repository }),
      new RegExp(`Preset bundle trust validation failed: Preset bundle signer key id is not allowed: ${signerKeyId}`),
    );

    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "team-executor-key",
        "--trust-name", "team-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    const trustedByName = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--trust-profile", "anchored",
        "--require-signature",
        "--trust-signer", "team-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.match(trustedByName.lines.join("\n"), /trusted=true/);
    assert.match(trustedByName.lines.join("\n"), /matchedTrustedSigners=team-anchor/);
    assert.match(trustedByName.lines.join("\n"), /requestedTrustedSigners=team-anchor/);
    assert.match(trustedByName.lines.join("\n"), /unmatchedTrustedSigners=/);
    assert.match(trustedByName.lines.join("\n"), /policyFailures=0/);
    assert.match(trustedByName.lines.join("\n"), /effectivePolicy=/);

    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "alternate-executor-key",
        "--signer", "Another Signer",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "alternate-executor-key",
        "--trust-name", "other-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    const multiAnchorTrust = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--trust-profile", "anchored",
        "--require-signature",
        "--trust-signer", "team-anchor,other-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    assert.match(multiAnchorTrust.lines.join("\n"), /matchedTrustedSigners=team-anchor/);
    assert.match(multiAnchorTrust.lines.join("\n"), /requestedTrustedSigners=team-anchor,other-anchor/);
    assert.match(multiAnchorTrust.lines.join("\n"), /unmatchedTrustedSigners=other-anchor/);

    const explainedOriginFailure = await runCommand(
      parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--allow-origin", "production",
        "--trust-explain",
        "--json",
      ]),
      { repository },
    );
    const parsedOriginFailure = JSON.parse(explainedOriginFailure.lines.join("\n")) as {
      validation: {
        trusted: boolean;
        report: {
          policyFailures: string[];
        };
      };
    };
    assert.equal(parsedOriginFailure.validation.trusted, false);
    assert.ok(parsedOriginFailure.validation.report.policyFailures.some((failure) => /origin is not allowed/i.test(failure)));

    await assert.rejects(
      () => runCommand(parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--trust-profile", "anchored",
        "--directory", presetDirectory,
      ]), { repository }),
      /Trust profile 'anchored' requires trusted signers or allowed signer key ids\./,
    );

    await runCommand(
      parseArgs([
        "preset", "trust-revoke",
        "--name", "team-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await assert.rejects(
      () => runCommand(parseArgs([
        "preset", "bundle-show",
        "--input", bundlePath,
        "--require-signature",
        "--trust-signer", "team-anchor",
        "--directory", presetDirectory,
      ]), { repository }),
      /Trusted signers are revoked: team-anchor/,
    );

    const invalidSignatureBundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
      metadata: { signature: string };
    };
    invalidSignatureBundle.metadata.signature = "invalid-signature";
    writeFileSync(invalidSignatureBundlePath, JSON.stringify(invalidSignatureBundle, null, 2), "utf8");

    await assert.rejects(
      () => runCommand(parseArgs(["preset", "bundle-show", "--input", invalidSignatureBundlePath]), { repository }),
      /Preset bundle signature verification failed/,
    );
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI supports compact memory content for retrieval and inspection", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-compact-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Compact Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "writer"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "decision",
        "--content",
        "Prefer lexical retrieval first for normal user-facing search.",
        "--summary",
        "Lexical retrieval decision",
        "--compact-content",
        "U:req retrieval=lexical_first;keep mobile",
      ]),
      { repository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    const searchResult = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "lexical_first"]),
      { repository },
    );
    assert.equal(searchResult.lines[0], "records=1");

    const showResult = await runCommand(
      parseArgs(["memory", "show", "--record-id", recordId]),
      { repository },
    );
    assert.match(showResult.lines.join("\n"), /compactContent=U:req retrieval=lexical_first;keep mobile/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("Retention sweep expires records according to per-space policy", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-retention-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Retention Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id",
        spaceId,
        "--retention-short-days",
        "0",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Expire me quickly.",
        "--summary", "Retention candidate",
      ]),
      { repository },
    );

    const dryRun = await runCommand(
      parseArgs(["memory", "retain", "--space-id", spaceId]),
      { repository },
    );
    assert.equal(dryRun.lines[0], "Retention dry run.");
    assert.equal(dryRun.lines[1], "expired=1");

    const applied = await runCommand(
      parseArgs(["memory", "retain", "--space-id", spaceId, "--apply"]),
      { repository },
    );
    assert.equal(applied.lines[0], "Retention applied.");

    const listResult = await runCommand(
      parseArgs(["memory", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository },
    );
    assert.match(listResult.lines.join("\n"), /short task expired Retention candidate/);
    assert.match(listResult.lines.join("\n"), /mid summary active Retention summary/);

    const eventList = await runCommand(
      parseArgs(["event", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository },
    );
    assert.match(eventList.lines.join("\n"), /memory_expired/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI commands append events and export a full space snapshot", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-export-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const exportPath = join(tempDirectory, "space-export.json");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Export Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "event",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--actor-type",
        "agent",
        "--actor-id",
        "planner-1",
        "--event-type",
        "decision_made",
        "--summary",
        "Chose space-local export support.",
        "--payload",
        "{\"format\":\"json\"}",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "export",
        "--space-id",
        spaceId,
        "--output",
        exportPath,
      ]),
      { repository },
    );

    const exported = JSON.parse(readFileSync(exportPath, "utf8")) as {
      metadata: { snapshotFormatVersion: number; checksum: string };
      space: { id: string };
      scopes: Array<{ id: string }>;
      events: Array<{ type: string }>;
      records: unknown[];
    };

    assert.equal(exported.metadata.snapshotFormatVersion, 1);
    assert.ok(exported.metadata.checksum);
    assert.equal(exported.space.id, spaceId);
    assert.equal(exported.scopes.length, 1);
    assert.equal(exported.events[0]?.type, "decision_made");
    assert.equal(exported.records.length, 0);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI commands import exported data and support record promotion and archiving", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-import-"));
  const sourceDbPath = join(tempDirectory, "source.sqlite");
  const targetDbPath = join(tempDirectory, "target.sqlite");
  const exportPath = join(tempDirectory, "space-export.json");
  const sourceRepository = createRepository(sourceDbPath);
  const targetRepository = createRepository(targetDbPath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Lifecycle Space"]),
      { repository: sourceRepository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository: sourceRepository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "short",
        "--kind",
        "task",
        "--content",
        "Promote this record after review.",
        "--summary",
        "Promotion candidate",
      ]),
      { repository: sourceRepository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    await runCommand(parseArgs(["memory", "promote", "--record-id", recordId]), {
      repository: sourceRepository,
    });
    await runCommand(parseArgs(["memory", "archive", "--record-id", recordId]), {
      repository: sourceRepository,
    });

    const listResult = await runCommand(
      parseArgs(["memory", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository: sourceRepository },
    );

    assert.match(listResult.lines[1] ?? "", /mid task archived Promotion candidate/);

    await runCommand(parseArgs(["export", "--space-id", spaceId, "--output", exportPath]), {
      repository: sourceRepository,
    });

    const importResult = await runCommand(parseArgs(["import", "--input", exportPath]), {
      repository: targetRepository,
    });

    assert.equal(importResult.lines[0], "Import completed.");
    assert.match(importResult.lines.join("\n"), /snapshotFormatVersion=1/);
    assert.match(importResult.lines.join("\n"), /trusted=true/);

    const importedSearch = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--status", "archived", "--text", "Promote"]),
      { repository: targetRepository },
    );

    assert.equal(importedSearch.lines[0], "records=1");
    assert.match(importedSearch.lines[1] ?? "", /Promotion candidate/);
  } finally {
    sourceRepository.close();
    targetRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI snapshot import enforces explicit collision policy", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-import-collision-"));
  const sourceDbPath = join(tempDirectory, "source.sqlite");
  const targetDbPath = join(tempDirectory, "target.sqlite");
  const exportPath = join(tempDirectory, "space-export.json");
  const sourceRepository = createRepository(sourceDbPath);
  const targetRepository = createRepository(targetDbPath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Collision Space"]),
      { repository: sourceRepository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository: sourceRepository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Snapshot imports should not overwrite silently.",
        "--summary", "Collision rule",
      ]),
      { repository: sourceRepository },
    );

    await runCommand(
      parseArgs(["export", "--space-id", spaceId, "--output", exportPath]),
      { repository: sourceRepository },
    );

    await runCommand(parseArgs(["import", "--input", exportPath]), {
      repository: targetRepository,
    });

    const previewConflict = await runCommand(
      parseArgs(["import", "--input", exportPath, "--preview", "--json"]),
      { repository: targetRepository },
    );
    const parsedPreviewConflict = JSON.parse(previewConflict.lines.join("\n")) as {
      applyAllowed: boolean;
      blockingIssues: string[];
    };
    assert.equal(parsedPreviewConflict.applyAllowed, false);
    assert.ok(parsedPreviewConflict.blockingIssues.some((issue) => /Space already exists:/i.test(issue)));

    await assert.rejects(
      () => runCommand(parseArgs(["import", "--input", exportPath]), {
        repository: targetRepository,
      }),
      /Space already exists: .*Use collisionPolicy=overwrite or collisionPolicy=rename\./,
    );

    const overwritten = await runCommand(
      parseArgs(["import", "--input", exportPath, "--collision", "overwrite"]),
      { repository: targetRepository },
    );
    assert.match(overwritten.lines.join("\n"), /collisionPolicy=overwrite/);

    const renamed = await runCommand(
      parseArgs(["import", "--input", exportPath, "--collision", "rename", "--json"]),
      { repository: targetRepository },
    );
    const parsed = JSON.parse(renamed.lines.join("\n")) as {
      spaceId: string;
      spaceName: string;
      collisionPolicy: string;
    };
    assert.equal(parsed.collisionPolicy, "rename");
    assert.equal(parsed.spaceName, "Collision Space (imported)");
    assert.notEqual(parsed.spaceId, spaceId);

    const previewRename = await runCommand(
      parseArgs(["import", "--input", exportPath, "--collision", "rename", "--preview", "--json"]),
      { repository: targetRepository },
    );
    const parsedPreviewRename = JSON.parse(previewRename.lines.join("\n")) as {
      applyAllowed: boolean;
      identityRemapped: boolean;
      targetSpace: { name: string };
    };
    assert.equal(parsedPreviewRename.applyAllowed, true);
    assert.equal(parsedPreviewRename.identityRemapped, true);
    assert.equal(parsedPreviewRename.targetSpace.name, "Collision Space (imported)");
  } finally {
    sourceRepository.close();
    targetRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI export and import can sign and trust a snapshot", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-snapshot-trust-"));
  const sourceDbPath = join(tempDirectory, "source.sqlite");
  const targetDbPath = join(tempDirectory, "target.sqlite");
  const exportPath = join(tempDirectory, "signed-space-export.json");
  const presetDirectory = join(tempDirectory, "presets");
  const sourceRepository = createRepository(sourceDbPath);
  const targetRepository = createRepository(targetDbPath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Signed Lifecycle Space"]),
      { repository: sourceRepository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository: sourceRepository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Snapshots should support trust validation.",
        "--summary", "Signed snapshot preference",
      ]),
      { repository: sourceRepository },
    );

    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "snapshot-key",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "snapshot-key",
        "--trust-name", "snapshot-anchor",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );

    await runCommand(
      parseArgs([
        "export",
        "--space-id", spaceId,
        "--output", exportPath,
        "--origin", "cli-test",
        "--signing-key", "snapshot-key",
        "--preset-directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );

    const importResult = await runCommand(
      parseArgs([
        "import",
        "--input", exportPath,
        "--trust-profile", "anchored",
        "--trust-signer", "snapshot-anchor",
        "--preset-directory", presetDirectory,
        "--json",
      ]),
      { repository: targetRepository },
    );

    const parsedImport = JSON.parse(importResult.lines.join("\n")) as {
      spaceId: string;
      validation: {
        trusted: boolean;
        report: { signed: boolean; matchedTrustedSignerNames: string[] };
      };
    };
    assert.equal(parsedImport.spaceId, spaceId);
    assert.equal(parsedImport.validation.trusted, true);
    assert.equal(parsedImport.validation.report.signed, true);
    assert.deepEqual(parsedImport.validation.report.matchedTrustedSignerNames, ["snapshot-anchor"]);

    const failingPreview = await runCommand(
      parseArgs([
        "import",
        "--input", exportPath,
        "--allow-origin", "production",
        "--preview",
        "--json",
      ]),
      { repository: targetRepository },
    );
    const parsedFailingPreview = JSON.parse(failingPreview.lines.join("\n")) as {
      applyAllowed: boolean;
      blockingIssues: string[];
    };
    assert.equal(parsedFailingPreview.applyAllowed, false);
    assert.ok(parsedFailingPreview.blockingIssues.some((issue) => /origin is not allowed/i.test(issue)));
  } finally {
    sourceRepository.close();
    targetRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI snapshot trust enforces rotated anchors and rejects revoked ones", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-snapshot-trust-rotation-"));
  const sourceDbPath = join(tempDirectory, "source.sqlite");
  const targetDbPath = join(tempDirectory, "target.sqlite");
  const exportPathV1 = join(tempDirectory, "signed-space-export-v1.json");
  const exportPathV2 = join(tempDirectory, "signed-space-export-v2.json");
  const rotatedPublicKeyPath = join(tempDirectory, "snapshot-key-v2.public.pem");
  const presetDirectory = join(tempDirectory, "presets");
  const sourceRepository = createRepository(sourceDbPath);
  const targetRepository = createRepository(targetDbPath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Signed Rotation Space"]),
      { repository: sourceRepository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository: sourceRepository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Rotated trust anchors should control snapshot imports.",
        "--summary", "Signed rotation preference",
      ]),
      { repository: sourceRepository },
    );

    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "snapshot-key-v1",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "snapshot-key-v1",
        "--trust-name", "snapshot-anchor",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );
    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "snapshot-key-v2",
        "--signer", "GlialNode Test",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );
    await runCommand(
      parseArgs([
        "preset", "key-export",
        "--name", "snapshot-key-v2",
        "--output", rotatedPublicKeyPath,
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-rotate",
        "--name", "snapshot-anchor",
        "--input", rotatedPublicKeyPath,
        "--next-name", "snapshot-anchor-v2",
        "--directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );

    await runCommand(
      parseArgs([
        "export",
        "--space-id", spaceId,
        "--output", exportPathV1,
        "--origin", "cli-test",
        "--signing-key", "snapshot-key-v1",
        "--preset-directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );

    await assert.rejects(
      () => runCommand(
        parseArgs([
          "import",
          "--input", exportPathV1,
          "--trust-profile", "anchored",
          "--trust-signer", "snapshot-anchor",
          "--preset-directory", presetDirectory,
        ]),
        { repository: targetRepository },
      ),
      /Trusted signers are revoked: snapshot-anchor/,
    );

    await runCommand(
      parseArgs([
        "export",
        "--space-id", spaceId,
        "--output", exportPathV2,
        "--origin", "cli-test",
        "--signing-key", "snapshot-key-v2",
        "--preset-directory", presetDirectory,
      ]),
      { repository: sourceRepository },
    );

    const importResult = await runCommand(
      parseArgs([
        "import",
        "--input", exportPathV2,
        "--trust-profile", "anchored",
        "--trust-signer", "snapshot-anchor-v2",
        "--preset-directory", presetDirectory,
        "--json",
      ]),
      { repository: targetRepository },
    );
    const parsedImport = JSON.parse(importResult.lines.join("\n")) as {
      spaceId: string;
      validation: {
        trusted: boolean;
        report: { matchedTrustedSignerNames: string[] };
      };
    };
    assert.equal(parsedImport.spaceId, spaceId);
    assert.equal(parsedImport.validation.trusted, true);
    assert.deepEqual(parsedImport.validation.report.matchedTrustedSignerNames, ["snapshot-anchor-v2"]);
  } finally {
    sourceRepository.close();
    targetRepository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can export a space graph for topology inspection", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-graph-export-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const outputPath = join(tempDirectory, "space.graph.json");
  const dotPath = join(tempDirectory, "space.graph.dot");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Graph Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "writer"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "event", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--actor-type", "agent",
        "--actor-id", "writer-1",
        "--event-type", "decision_made",
        "--summary", "Captured graph event.",
      ]),
      { repository },
    );

    const first = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "First graph node.",
        "--summary", "First node",
      ]),
      { repository },
    );
    const firstId = first.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(firstId);

    const second = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "summary",
        "--content", "Second graph node.",
        "--summary", "Second node",
      ]),
      { repository },
    );
    const secondId = second.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(secondId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", firstId,
        "--to-record-id", secondId,
        "--type", "supports",
      ]),
      { repository },
    );

    const graphResult = await runCommand(
      parseArgs(["space", "graph-export", "--id", spaceId, "--json"]),
      { repository },
    );
    const graph = JSON.parse(graphResult.lines.join("\n")) as {
      metadata: { schemaVersion: number; spaceId: string; options: { includeEvents: boolean; includeScopes: boolean } };
      nodes: Array<{ type: string; id: string }>;
      edges: Array<{ type: string; relation?: string; toId: string }>;
    };
    assert.equal(graph.metadata.schemaVersion, 1);
    assert.equal(graph.metadata.spaceId, spaceId);
    assert.equal(graph.metadata.options.includeEvents, true);
    assert.equal(graph.metadata.options.includeScopes, true);
    assert.ok(graph.nodes.some((node) => node.type === "scope" && node.id === scopeId));
    assert.ok(graph.nodes.some((node) => node.type === "event"));
    assert.ok(graph.edges.some((edge) => edge.type === "record_link" && edge.relation === "supports"));

    const cytoscapeResult = await runCommand(
      parseArgs(["space", "graph-export", "--id", spaceId, "--format", "cytoscape", "--json"]),
      { repository },
    );
    const cytoscape = JSON.parse(cytoscapeResult.lines.join("\n")) as {
      elements: {
        nodes: Array<{ data: { type: string } }>;
        edges: Array<{ data: { type: string } }>;
      };
    };
    assert.ok(cytoscape.elements.nodes.some((node) => node.data.type === "scope"));
    assert.ok(cytoscape.elements.edges.some((edge) => edge.data.type === "record_link"));

    const dotResult = await runCommand(
      parseArgs(["space", "graph-export", "--id", spaceId, "--format", "dot", "--json"]),
      { repository },
    );
    const dotPayload = JSON.parse(dotResult.lines.join("\n")) as {
      format: string;
      dot: string;
    };
    assert.equal(dotPayload.format, "dot");
    assert.match(dotPayload.dot, /^digraph /);
    assert.match(dotPayload.dot, /label="supports"/);

    const minimal = await runCommand(
      parseArgs([
        "space", "graph-export",
        "--id", spaceId,
        "--include-events", "false",
        "--include-scopes", "false",
        "--output", outputPath,
        "--json",
      ]),
      { repository },
    );
    const parsedMinimal = JSON.parse(minimal.lines.join("\n")) as {
      output: string;
      metadata: { options: { includeEvents: boolean; includeScopes: boolean } };
    };
    assert.equal(parsedMinimal.output, outputPath);
    assert.equal(parsedMinimal.metadata.options.includeEvents, false);
    assert.equal(parsedMinimal.metadata.options.includeScopes, false);
    const stored = JSON.parse(readFileSync(outputPath, "utf8")) as {
      metadata: { options: { includeEvents: boolean; includeScopes: boolean } };
      nodes: Array<{ type: string }>;
    };
    assert.equal(stored.metadata.options.includeEvents, false);
    assert.equal(stored.metadata.options.includeScopes, false);
    assert.equal(stored.nodes.some((node) => node.type === "event"), false);
    assert.equal(stored.nodes.some((node) => node.type === "scope"), false);

    await runCommand(
      parseArgs([
        "space", "graph-export",
        "--id", spaceId,
        "--format", "dot",
        "--output", dotPath,
      ]),
      { repository },
    );
    const dotFile = readFileSync(dotPath, "utf8");
    assert.match(dotFile, /^digraph /);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can export a standalone space inspector HTML artifact", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-cli-space-inspector-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const presetDirectory = join(tempDirectory, "presets");
  const outputPath = join(tempDirectory, "space-inspector.html");
  const snapshotOutputPath = join(tempDirectory, "space-inspector.snapshot.json");
  const indexOutputPath = join(tempDirectory, "space-inspector-index.html");
  const indexSnapshotOutputPath = join(tempDirectory, "space-inspector-index.snapshot.json");
  const packOutputDirectory = join(tempDirectory, "space-inspector-pack");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Inspector CLI Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "inspector"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Inspector exports should be stable and reviewable.",
        "--summary", "Inspector export record",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "preset", "keygen",
        "--name", "inspector-key",
        "--signer", "Inspector",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-local-key",
        "--name", "inspector-key",
        "--trust-name", "inspector-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "preset", "trust-pack-register",
        "--name", "inspector-pack",
        "--base-profile", "anchored",
        "--trust-signer", "inspector-anchor",
        "--directory", presetDirectory,
      ]),
      { repository },
    );

    const result = await runCommand(
      parseArgs([
        "space", "inspect-export",
        "--id", spaceId,
        "--output", outputPath,
        "--query-text", "stable reviewable",
        "--query-limit", "2",
        "--query-support-limit", "2",
        "--query-bundle-consumer", "reviewer",
        "--directory", presetDirectory,
        "--json",
      ]),
      { repository },
    );
    const parsed = JSON.parse(result.lines.join("\n")) as {
      output: string;
      space: { id: string; name: string };
      graph: { nodes: number; edges: number };
      recall: { query: { text?: string }; traceCount: number } | null;
      trustRegistryIncluded: boolean;
    };
    assert.equal(parsed.output, outputPath);
    assert.equal(parsed.space.id, spaceId);
    assert.equal(parsed.space.name, "Inspector CLI Space");
    assert.ok(parsed.graph.nodes >= 2);
    assert.equal(parsed.recall?.query.text, "stable reviewable");
    assert.equal(parsed.recall?.traceCount, 1);
    assert.equal(parsed.trustRegistryIncluded, true);

    const html = readFileSync(outputPath, "utf8");
    assert.match(html, /GlialNode Space Inspector/);
    assert.match(html, /Inspector CLI Space/);
    assert.match(html, /snapshot-data/);

    const snapshotResult = await runCommand(
      parseArgs([
        "space", "inspect-snapshot",
        "--id", spaceId,
        "--output", snapshotOutputPath,
        "--query-text", "stable reviewable",
        "--query-limit", "2",
        "--directory", presetDirectory,
        "--json",
      ]),
      { repository },
    );
    const parsedSnapshot = JSON.parse(snapshotResult.lines.join("\n")) as {
      output: string;
      risk: { riskLevel: string };
      recall: { traceCount: number } | null;
    };
    assert.equal(parsedSnapshot.output, snapshotOutputPath);
    assert.equal(parsedSnapshot.risk.riskLevel, "moderate");
    assert.equal(parsedSnapshot.recall?.traceCount, 1);
    const snapshotFile = JSON.parse(readFileSync(snapshotOutputPath, "utf8")) as {
      space: { id: string };
      risk: { maintenanceStale: boolean };
    };
    assert.equal(snapshotFile.space.id, spaceId);
    assert.equal(snapshotFile.risk.maintenanceStale, true);

    await runCommand(
      parseArgs(["space", "create", "--name", "Inspector CLI Space B"]),
      { repository },
    );

    const indexResult = await runCommand(
      parseArgs([
        "space", "inspect-index-export",
        "--output", indexOutputPath,
        "--directory", presetDirectory,
        "--json",
      ]),
      { repository },
    );
    const indexParsed = JSON.parse(indexResult.lines.join("\n")) as {
      output: string;
      totals: { records: number; graphNodes: number };
      spaceCount: number;
      trustRegistryIncluded: boolean;
    };
    assert.equal(indexParsed.output, indexOutputPath);
    assert.ok(indexParsed.spaceCount >= 2);
    assert.ok(indexParsed.totals.records >= 1);
    assert.ok(indexParsed.totals.graphNodes >= 2);
    assert.equal(indexParsed.trustRegistryIncluded, true);

    const indexHtml = readFileSync(indexOutputPath, "utf8");
    assert.match(indexHtml, /GlialNode Space Inspector Index/);
    assert.match(indexHtml, /Inspector CLI Space B/);

    const indexSnapshotResult = await runCommand(
      parseArgs([
        "space", "inspect-index-snapshot",
        "--output", indexSnapshotOutputPath,
        "--directory", presetDirectory,
        "--json",
      ]),
      { repository },
    );
    const parsedIndexSnapshot = JSON.parse(indexSnapshotResult.lines.join("\n")) as {
      output: string;
      totals: { spacesNeedingTrustReview: number };
      spaceCount: number;
    };
    assert.equal(parsedIndexSnapshot.output, indexSnapshotOutputPath);
    assert.ok(parsedIndexSnapshot.spaceCount >= 2);
    assert.ok(parsedIndexSnapshot.totals.spacesNeedingTrustReview >= 0);
    const indexSnapshotFile = JSON.parse(readFileSync(indexSnapshotOutputPath, "utf8")) as {
      totals: { spacesWithStaleMemory: number };
      spaces: Array<{ risk: { riskLevel: string } }>;
    };
    assert.ok(indexSnapshotFile.totals.spacesWithStaleMemory >= 0);
    assert.ok(indexSnapshotFile.spaces.some((spaceEntry) => spaceEntry.risk.riskLevel === "moderate"));

    const packResult = await runCommand(
      parseArgs([
        "space", "inspect-pack-export",
        "--output-dir", packOutputDirectory,
        "--directory", presetDirectory,
        "--query-text", "stable",
        "--query-limit", "1",
        "--json",
      ]),
      { repository },
    );
    const parsedPack = JSON.parse(packResult.lines.join("\n")) as {
      outputDirectory: string;
      manifestPath: string;
      spaceCount: number;
      screenshotsCaptured: boolean;
      totals: { records: number };
    };
    assert.equal(parsedPack.outputDirectory, packOutputDirectory);
    assert.ok(parsedPack.spaceCount >= 2);
    assert.equal(parsedPack.screenshotsCaptured, false);
    assert.ok(parsedPack.totals.records >= 1);
    const manifestFile = JSON.parse(readFileSync(parsedPack.manifestPath, "utf8")) as {
      files: { indexHtml: string; indexSnapshot: string; indexScreenshot?: string };
      spaces: Array<{ html: string; snapshot: string; screenshot?: string }>;
    };
    assert.match(readFileSync(manifestFile.files.indexHtml, "utf8"), /GlialNode Space Inspector Index/);
    assert.equal(manifestFile.files.indexScreenshot, undefined);
    assert.ok(manifestFile.spaces.length >= 2);
    assert.ok(manifestFile.spaces.every((entry) => /[\\/]spaces[\\/]/.test(entry.html)));
    assert.ok(manifestFile.spaces.every((entry) => entry.screenshot === undefined));

    const serveResult = await runCommand(
      parseArgs([
        "space", "inspect-pack-serve",
        "--input-dir", packOutputDirectory,
        "--duration-ms", "25",
        "--port", "0",
        "--probe-path", "/index.html",
        "--json",
      ]),
      { repository },
    );
    const parsedServe = JSON.parse(serveResult.lines.join("\n")) as {
      directory: string;
      baseUrl: string;
      port: number;
      durationMs: number;
      probePath?: string;
      probeStatus?: number;
    };
    assert.equal(parsedServe.directory, packOutputDirectory);
    assert.match(parsedServe.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(parsedServe.port > 0);
    assert.equal(parsedServe.durationMs, 25);
    assert.equal(parsedServe.probePath, "/index.html");
    assert.equal(parsedServe.probeStatus, 200);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI commands support linking records and showing provenance details", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-links-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const exportPath = join(tempDirectory, "links-export.json");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Link Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const sourceRecordResult = await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "fact",
        "--content",
        "Source memory record.",
        "--summary",
        "Source record",
      ]),
      { repository },
    );
    const fromRecordId = sourceRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(fromRecordId);

    const targetRecordResult = await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id",
        spaceId,
        "--scope-id",
        scopeId,
        "--scope-type",
        "agent",
        "--tier",
        "mid",
        "--kind",
        "summary",
        "--content",
        "Derived summary memory record.",
        "--summary",
        "Summary record",
      ]),
      { repository },
    );
    const toRecordId = targetRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(toRecordId);

    await runCommand(
      parseArgs([
        "link",
        "add",
        "--space-id",
        spaceId,
        "--from-record-id",
        fromRecordId,
        "--to-record-id",
        toRecordId,
        "--type",
        "derived_from",
      ]),
      { repository },
    );

    const detailResult = await runCommand(parseArgs(["memory", "show", "--record-id", toRecordId]), {
      repository,
    });
    assert.equal(detailResult.lines.find((line) => line.startsWith("links=")), "links=1");
    assert.match(detailResult.lines.at(-1) ?? "", /derived_from/);

    await runCommand(parseArgs(["export", "--space-id", spaceId, "--output", exportPath]), {
      repository,
    });

    const exported = JSON.parse(readFileSync(exportPath, "utf8")) as {
      links: Array<{ type: string }>;
    };
    assert.equal(exported.links.length, 1);
    assert.equal(exported.links[0]?.type, "derived_from");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI compaction dry-run and apply behave predictably", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-compact-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Compact Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "High-signal task memory.",
        "--summary", "Promotable record",
        "--importance", "0.9",
        "--confidence", "0.9",
        "--freshness", "0.6",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "task",
        "--content", "Low-value scratch note.",
        "--summary", "Archivable record",
        "--importance", "0.2",
        "--confidence", "0.3",
        "--freshness", "0.2",
      ]),
      { repository },
    );

    const dryRunResult = await runCommand(
      parseArgs(["memory", "compact", "--space-id", spaceId]),
      { repository },
    );

    assert.equal(dryRunResult.lines[0], "Compaction dry run.");
    assert.equal(dryRunResult.lines[1], "promotions=1");
    assert.equal(dryRunResult.lines[2], "archives=1");
    assert.equal(dryRunResult.lines[3], "refreshed=0");

    const beforeList = await runCommand(
      parseArgs(["memory", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository },
    );
    assert.match(beforeList.lines.join("\n"), /short task active Promotable record/);
    assert.match(beforeList.lines.join("\n"), /mid task active Archivable record/);

    const applyResult = await runCommand(
      parseArgs(["memory", "compact", "--space-id", spaceId, "--apply"]),
      { repository },
    );

    assert.equal(applyResult.lines[0], "Compaction applied.");

    const afterList = await runCommand(
      parseArgs(["memory", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository },
    );
    assert.match(afterList.lines.join("\n"), /mid task active Promotable record/);
    assert.match(afterList.lines.join("\n"), /mid task archived Archivable record/);
    assert.match(afterList.lines.join("\n"), /mid summary active Compaction summary/);

    const eventList = await runCommand(
      parseArgs(["event", "list", "--space-id", spaceId, "--limit", "10"]),
      { repository },
    );
    assert.match(eventList.lines.join("\n"), /memory_promoted/);
    assert.match(eventList.lines.join("\n"), /memory_archived/);

    const summaryLine = afterList.lines.find((line) => /Compaction summary/.test(line));
    const summaryRecordId = summaryLine?.split(" ")[0];
    assert.ok(summaryRecordId);

    const summaryDetails = await runCommand(
      parseArgs(["memory", "show", "--record-id", summaryRecordId]),
      { repository },
    );
    assert.equal(summaryDetails.lines.find((line) => line.startsWith("links=")), "links=2");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("Space policy settings can change compaction behavior", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-policy-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Policy Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id",
        spaceId,
        "--short-promote-importance-min",
        "0.95",
        "--short-promote-confidence-min",
        "0.95",
      ]),
      { repository },
    );

    const spaceShow = await runCommand(parseArgs(["space", "show", "--id", spaceId]), {
      repository,
    });
    assert.match(spaceShow.lines.join("\n"), /shortPromoteImportanceMin/);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Borderline promotable note.",
        "--summary", "Borderline note",
        "--importance", "0.9",
        "--confidence", "0.9",
        "--freshness", "0.8",
      ]),
      { repository },
    );

    const compactResult = await runCommand(
      parseArgs(["memory", "compact", "--space-id", spaceId]),
      { repository },
    );

    assert.equal(compactResult.lines[1], "promotions=0");
    assert.equal(compactResult.lines[2], "archives=0");
    assert.equal(compactResult.lines[3], "refreshed=0");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("Space report summarizes records, links, and lifecycle activity", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-report-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Report Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id",
        spaceId,
        "--retention-short-days",
        "0",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const recordAResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Promotable note.",
        "--summary", "Promotable",
        "--importance", "0.95",
        "--confidence", "0.9",
        "--freshness", "0.8",
      ]),
      { repository },
    );
    const recordAId = recordAResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordAId);

    const recordBResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Retention note.",
        "--summary", "Expires",
      ]),
      { repository },
    );
    const recordBId = recordBResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordBId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", recordAId,
        "--to-record-id", recordBId,
        "--type", "references",
      ]),
      { repository },
    );

    await runCommand(parseArgs(["memory", "compact", "--space-id", spaceId, "--apply"]), { repository });
    await runCommand(parseArgs(["memory", "retain", "--space-id", spaceId, "--apply"]), { repository });

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "5"]),
      { repository },
    );

    const output = report.lines.join("\n");
    assert.match(output, /^records=/m);
    assert.match(output, /^events=/m);
    assert.match(output, /^links=/m);
    assert.match(output, /tiers=/);
    assert.match(output, /statuses=/);
    assert.match(output, /eventTypes=/);
    assert.match(output, /provenanceSummaryRecords=/);
    assert.match(output, /maintenanceLatestRunAt=/);
    assert.match(output, /maintenanceLatestCompactionAt=/);
    assert.match(output, /maintenanceLatestRetentionAt=/);
    assert.match(output, /maintenanceLatestDecayAt=/);
    assert.match(output, /maintenanceLatestReinforcementAt=/);
    assert.match(output, /maintenanceCompactionDelta=/);
    assert.match(output, /maintenanceRetentionDelta=/);
    assert.match(output, /maintenanceDecayDelta=/);
    assert.match(output, /maintenanceReinforcementDelta=/);
    assert.match(output, /effectiveSettings=/);
    assert.match(output, /settingsOrigin=/);
    assert.match(output, /recentLifecycleEvents=/);
    assert.match(output, /memory_promoted|memory_expired|memory_archived/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("Space maintain runs compaction and retention in one workflow", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-maintain-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Maintain Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id",
        spaceId,
        "--retention-short-days",
        "0",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Promote me during maintenance.",
        "--summary", "Maintain promote",
        "--importance", "0.95",
        "--confidence", "0.9",
        "--freshness", "0.8",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "short",
        "--kind", "task",
        "--content", "Expire me during maintenance.",
        "--summary", "Maintain expire",
      ]),
      { repository },
    );

    const dryRun = await runCommand(
      parseArgs(["space", "maintain", "--id", spaceId]),
      { repository },
    );
    const dryRunOutput = dryRun.lines.join("\n");
    assert.match(dryRunOutput, /Maintenance dry run\./);
    assert.match(dryRunOutput, /phase=compaction/);
    assert.match(dryRunOutput, /phase=retention/);

    const applied = await runCommand(
      parseArgs(["space", "maintain", "--id", spaceId, "--apply"]),
      { repository },
    );
    const appliedOutput = applied.lines.join("\n");
    assert.match(appliedOutput, /Maintenance applied\./);

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    const reportOutput = report.lines.join("\n");
    assert.match(reportOutput, /memory_promoted/);
    assert.match(reportOutput, /memory_expired/);
    assert.match(reportOutput, /maintenanceCompactionDelta=\{"promoted":\d+/);
    assert.match(reportOutput, /maintenanceRetentionDelta=\{"expired":\d+\}/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI compaction distills related records into a summary record with provenance", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-distill-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Distill Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for standard search flows.",
        "--summary", "Lexical retrieval first",
        "--tags", "retrieval,search",
        "--importance", "0.82",
        "--confidence", "0.8",
        "--freshness", "0.7",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "memory",
        "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical search remains the most reliable default for user-facing memory recall.",
        "--summary", "Lexical search reliability",
        "--tags", "retrieval,ranking",
        "--importance", "0.78",
        "--confidence", "0.76",
        "--freshness", "0.68",
      ]),
      { repository },
    );

    const dryRun = await runCommand(
      parseArgs(["memory", "compact", "--space-id", spaceId]),
      { repository },
    );
    assert.equal(dryRun.lines[4], "distilled=1");
    assert.equal(dryRun.lines[5], "superseded=2");

    const apply = await runCommand(
      parseArgs(["memory", "compact", "--space-id", spaceId, "--apply"]),
      { repository },
    );
    assert.equal(apply.lines[0], "Compaction applied.");

    const search = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "Distilled retrieval memory"]),
      { repository },
    );
    assert.equal(search.lines[0], "records=1");

    const distilledRecordId = search.lines[1]?.split(" ")[0];
    assert.ok(distilledRecordId);

    const show = await runCommand(
      parseArgs(["memory", "show", "--record-id", distilledRecordId]),
      { repository },
    );
    assert.equal(show.lines.find((line) => line.startsWith("links=")), "links=5");
    assert.match(show.lines.join("\n"), /derived_from/);
    assert.match(show.lines.join("\n"), /supersedes/);

    const defaultSearch = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--text", "lexical retrieval"]),
      { repository },
    );
    assert.equal(defaultSearch.lines[0], "records=1");

    const supersededSearch = await runCommand(
      parseArgs(["memory", "search", "--space-id", spaceId, "--status", "superseded", "--text", "lexical retrieval"]),
      { repository },
    );
    assert.equal(supersededSearch.lines[0], "records=2");

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /memory_superseded/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI memory add detects contradictory durable memory", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-conflict-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Conflict Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const firstResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for search flows.",
        "--summary", "Prefer lexical retrieval",
        "--tags", "retrieval,search",
        "--confidence", "0.9",
        "--freshness", "0.8",
        "--importance", "0.85",
      ]),
      { repository },
    );
    const firstId = firstResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(firstId);

    const secondResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Avoid lexical retrieval first for search flows.",
        "--summary", "Avoid lexical retrieval",
        "--tags", "retrieval,search",
        "--confidence", "0.88",
        "--freshness", "0.78",
        "--importance", "0.84",
      ]),
      { repository },
    );
    assert.equal(secondResult.lines.at(-1), "conflicts=1");

    const firstShow = await runCommand(
      parseArgs(["memory", "show", "--record-id", firstId]),
      { repository },
    );
    assert.match(firstShow.lines.join("\n"), /links=1|links=2/);

    const linkList = await runCommand(
      parseArgs(["link", "list", "--record-id", secondResult.lines.find((line) => line.startsWith("id="))?.slice(3) ?? ""]),
      { repository },
    );
    assert.match(linkList.lines.join("\n"), /contradicts/);

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /memory_conflicted/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI decay reduces stale durable memory trust and reports it", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-decay-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Decay Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id", spaceId,
        "--decay-min-age-days", "0",
        "--decay-confidence-per-day", "0.05",
        "--decay-freshness-per-day", "0.1",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "fact",
        "--content", "Lexical retrieval is the default memory strategy.",
        "--summary", "Retrieval default",
        "--tags", "retrieval",
        "--confidence", "0.9",
        "--freshness", "0.8",
        "--importance", "0.85",
      ]),
      { repository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    const staleRecord = await repository.getRecord(recordId);
    assert.ok(staleRecord);
    staleRecord.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await repository.writeRecord(staleRecord);

    const dryRun = await runCommand(
      parseArgs(["memory", "decay", "--space-id", spaceId]),
      { repository },
    );
    assert.equal(dryRun.lines[0], "Decay dry run.");
    assert.equal(dryRun.lines[1], "decayed=1");

    const applied = await runCommand(
      parseArgs(["memory", "decay", "--space-id", spaceId, "--apply"]),
      { repository },
    );
    assert.equal(applied.lines[0], "Decay applied.");

    const show = await runCommand(
      parseArgs(["memory", "show", "--record-id", recordId]),
      { repository },
    );
    assert.match(show.lines.join("\n"), /links=1|links=2/);

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /memory_decayed/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI reinforcement strengthens a record and surfaces the lifecycle event", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-reinforce-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Reinforcement Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id", spaceId,
        "--reinforcement-confidence-boost", "0.05",
        "--reinforcement-freshness-boost", "0.1",
        "--reinforcement-max-confidence", "0.9",
        "--reinforcement-max-freshness", "0.95",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "fact",
        "--content", "Lexical retrieval is still the confirmed default.",
        "--summary", "Retrieval default",
        "--confidence", "0.7",
        "--freshness", "0.5",
        "--importance", "0.82",
      ]),
      { repository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    const reinforce = await runCommand(
      parseArgs([
        "memory", "reinforce",
        "--record-id", recordId,
        "--strength", "2",
        "--reason", "manual-confirmation",
      ]),
      { repository },
    );
    assert.equal(reinforce.lines[0], "Reinforcement applied.");
    assert.equal(reinforce.lines[1], "reinforced=1");

    const show = await runCommand(
      parseArgs(["memory", "show", "--record-id", recordId]),
      { repository },
    );
    assert.match(show.lines.join("\n"), /links=1|links=2/);

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /memory_reinforced/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can reinforce successful search matches when explicitly requested", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-search-reinforce-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Search Reinforcement Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space",
        "configure",
        "--id", spaceId,
        "--reinforcement-confidence-boost", "0.04",
        "--reinforcement-freshness-boost", "0.08",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "fact",
        "--content", "Lexical retrieval remains the preferred default for confirmed search flows.",
        "--summary", "Preferred retrieval default",
        "--confidence", "0.7",
        "--freshness", "0.4",
        "--importance", "0.84",
      ]),
      { repository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    const searchResult = await runCommand(
      parseArgs([
        "memory", "search",
        "--space-id", spaceId,
        "--text", "preferred retrieval default",
        "--reinforce",
        "--reinforce-limit", "1",
        "--reinforce-strength", "2",
      ]),
      { repository },
    );
    assert.equal(searchResult.lines[0], "records=1");

    const report = await runCommand(
      parseArgs(["space", "report", "--id", spaceId, "--recent-events", "10"]),
      { repository },
    );
    assert.match(report.lines.join("\n"), /memory_reinforced/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI can emit a JSON learning loop plan without mutating records", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-learn-plan-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Learning Loop CLI Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const addRecordResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Keep lexical retrieval as the default memory search mode.",
        "--summary", "Lexical retrieval default",
        "--confidence", "0.72",
        "--freshness", "0.62",
      ]),
      { repository },
    );
    const recordId = addRecordResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(recordId);

    await runCommand(
      parseArgs(["memory", "reinforce", "--record-id", recordId, "--reason", "successful-retrieval"]),
      { repository },
    );
    await runCommand(
      parseArgs(["memory", "reinforce", "--record-id", recordId, "--reason", "successful-retrieval"]),
      { repository },
    );

    const result = await runCommand(
      parseArgs([
        "memory", "learn-plan",
        "--space-id", spaceId,
        "--min-successful-uses", "2",
        "--json",
      ]),
      { repository },
    );
    const parsed = JSON.parse(result.lines.join("\n")) as {
      spaceId: string;
      plan: {
        summary: { suggestions: number };
        suggestions: Array<{ type: string; recordId: string; recommendedAction: string }>;
      };
    };

    assert.equal(parsed.spaceId, spaceId);
    assert.ok(parsed.plan.summary.suggestions >= 1);
    assert.ok(parsed.plan.suggestions.some((suggestion) =>
      suggestion.type === "reinforce_repeated_success" &&
      suggestion.recordId === recordId &&
      suggestion.recommendedAction === "reinforce",
    ));
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI recall returns a primary memory with supporting context", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-recall-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Recall Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const primaryResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable search flows.",
        "--summary", "Lexical retrieval decision",
        "--tags", "retrieval,search",
        "--confidence", "0.84",
        "--freshness", "0.78",
        "--importance", "0.88",
      ]),
      { repository },
    );
    const primaryId = primaryResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(primaryId);

    const supportResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval is easier to debug than a heavier semantic stack.",
        "--summary", "Lexical debugging benefit",
        "--tags", "retrieval,debugging",
        "--importance", "0.45",
        "--confidence", "0.55",
        "--freshness", "0.45",
      ]),
      { repository },
    );
    const supportId = supportResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(supportId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", primaryId,
        "--to-record-id", supportId,
        "--type", "supports",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "summary",
        "--content", "Distilled retrieval memory for lexical-first search defaults.",
        "--summary", "Distilled retrieval memory",
        "--tags", "retrieval,distilled",
        "--importance", "0.6",
        "--confidence", "0.65",
        "--freshness", "0.55",
      ]),
      { repository },
    );

    const recall = await runCommand(
      parseArgs([
        "memory", "recall",
        "--space-id", spaceId,
        "--text", "lexical retrieval",
        "--limit", "1",
        "--support-limit", "3",
      ]),
      { repository },
    );

    const output = recall.lines.join("\n");
    assert.match(output, /^packs=1/m);
    assert.match(output, /(primary|support)=.*Lexical retrieval decision/);
    assert.match(output, /(primary|support)=.*Lexical debugging benefit/);
    assert.match(output, /(primary|support)=.*Distilled retrieval memory/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI trace returns structured recall citations", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-trace-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Trace Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const primaryResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable search flows.",
        "--summary", "Lexical retrieval decision",
        "--tags", "retrieval,search",
      ]),
      { repository },
    );
    const primaryId = primaryResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(primaryId);

    const supportResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval is easier to debug than a heavier semantic stack.",
        "--summary", "Lexical debugging benefit",
        "--tags", "retrieval,debugging",
      ]),
      { repository },
    );
    const supportId = supportResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(supportId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", primaryId,
        "--to-record-id", supportId,
        "--type", "supports",
      ]),
      { repository },
    );

    const trace = await runCommand(
      parseArgs([
        "memory", "trace",
        "--space-id", spaceId,
        "--text", "lexical retrieval",
        "--limit", "1",
        "--support-limit", "3",
      ]),
      { repository },
    );

    const output = trace.lines.join("\n");
    assert.match(output, /^traces=1/m);
    assert.match(output, /^summary=Recalled/m);
    assert.match(output, new RegExp(`cite=(primary|supporting):${primaryId}`));
    assert.match(output, new RegExp(`cite=(primary|supporting):${supportId}(?::supports)?`));
    assert.match(output, /supports/);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle returns a reusable memory bundle payload", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const primaryResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable search flows.",
        "--summary", "Lexical retrieval decision",
        "--compact-content", "U:req retrieval=lexical_first",
        "--tags", "retrieval,search",
      ]),
      { repository },
    );
    const primaryId = primaryResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(primaryId);

    const supportResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval is easier to debug than a heavier semantic stack.",
        "--summary", "Lexical debugging benefit",
        "--compact-content", "F:retrieval debug=easy",
        "--tags", "retrieval,debugging",
      ]),
      { repository },
    );
    const supportId = supportResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(supportId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", primaryId,
        "--to-record-id", supportId,
        "--type", "supports",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "lexical retrieval",
        "--limit", "1",
        "--support-limit", "3",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      trace: { summary: string };
      primary: { compactContent?: string; recordId: string; annotations: string[] };
      supporting: Array<{ recordId: string; annotations: string[] }>;
      links: Array<{ type: string }>;
      hints: string[];
    }>;

    assert.equal(parsed.length, 1);
    assert.match(parsed[0]?.trace.summary ?? "", /Recalled/);
    assert.ok(parsed[0]?.primary.compactContent);
    assert.ok(
      parsed[0]?.primary.annotations.includes("actionable") ||
      parsed[0]?.supporting.some((entry) => entry.annotations.includes("actionable")),
    );
    assert.ok(
      parsed[0]?.primary.recordId === supportId ||
      parsed[0]?.supporting.some((entry) => entry.recordId === supportId),
    );
    assert.ok(parsed[0]?.links.some((link) => link.type === "supports"));
    assert.ok(
      parsed[0]?.hints.includes("actionable_primary") ||
      parsed[0]?.primary.annotations.includes("actionable") ||
      parsed[0]?.supporting.some((entry) => entry.annotations.includes("actionable")),
    );
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle policies can prune payload size for executor handoff", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-policy-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Policy Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable search flows and operational debugging.",
        "--summary", "Lexical retrieval decision",
        "--compact-content", "U:req retrieval=lexical_first",
        "--tags", "retrieval,search",
      ]),
      { repository },
    );

    const distilledResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval remains easier to debug than a heavier semantic stack.",
        "--summary", "Lexical debugging benefit",
        "--compact-content", "F:retrieval debug=easy",
        "--tags", "retrieval,debugging",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "fact",
        "--content", "Lexical retrieval uses simpler ranking signals and predictable filters.",
        "--summary", "Lexical ranking simplicity",
        "--compact-content", "F:retrieval ranking=simple",
        "--tags", "retrieval,ranking",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "lexical retrieval",
        "--limit", "1",
        "--support-limit", "4",
        "--bundle-profile", "executor",
        "--bundle-max-supporting", "1",
        "--bundle-max-content-chars", "18",
        "--bundle-prefer-compact", "true",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      primary: { content: string };
      supporting: Array<{ content: string }>;
    }>;

    assert.equal(parsed.length, 1);
    assert.ok((parsed[0]?.supporting.length ?? 0) <= 1);
    assert.ok((parsed[0]?.primary.content.length ?? 0) <= 18);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle annotations expose stale and contested hints", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-annotation-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Annotation Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const distilledResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "summary",
        "--content", "Distilled retrieval memory with stale confidence.",
        "--summary", "Distilled retrieval memory",
        "--tags", "retrieval,distilled",
        "--confidence", "0.3",
        "--freshness", "0.3",
      ]),
      { repository },
    );
    const distilledId = distilledResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(distilledId);

    const supersededResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Legacy retrieval decision that is now superseded.",
        "--summary", "Legacy retrieval decision",
        "--status", "superseded",
        "--tags", "retrieval",
      ]),
      { repository },
    );
    const supersededId = supersededResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(supersededId);

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", distilledId,
        "--to-record-id", supersededId,
        "--type", "references",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "retrieval",
        "--limit", "1",
        "--support-limit", "4",
        "--status", "superseded",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      hints: string[];
      primary: { annotations: string[]; recordId: string };
      supporting: Array<{ annotations: string[]; recordId: string }>;
    }>;

    assert.equal(parsed.length, 1);
    assert.ok(parsed[0]?.hints.includes("contains_stale_memory"));
    assert.ok(parsed[0]?.hints.includes("contains_superseded_memory"));
    assert.ok(
      parsed[0]?.primary.annotations.includes("distilled") ||
      parsed[0]?.supporting.some((entry) => entry.annotations.includes("distilled")),
    );
    assert.ok(
      parsed[0]?.primary.recordId === supersededId ||
      parsed[0]?.supporting.some((entry) => entry.recordId === supersededId),
    );
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle can auto-route actionable memory toward executor handoff", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-routing-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Routing Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable execution-time search.",
        "--summary", "Execution retrieval decision",
        "--tags", "retrieval,search",
        "--confidence", "0.86",
        "--freshness", "0.82",
        "--importance", "0.9",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "execution retrieval",
        "--limit", "1",
        "--bundle-consumer", "auto",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      route: {
        resolvedConsumer: string;
        profileUsed: string;
        source: string;
        emphasis: string;
      };
      hints: string[];
    }>;

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.route.resolvedConsumer, "executor");
    assert.equal(parsed[0]?.route.profileUsed, "executor");
    assert.equal(parsed[0]?.route.source, "auto");
    assert.equal(parsed[0]?.route.emphasis, "execution");
    assert.ok(parsed[0]?.hints.includes("actionable_primary"));
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle supports versioned JSON envelope output", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-envelope-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Envelope Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "decision",
        "--content", "Prefer lexical retrieval first for stable execution-time search.",
        "--summary", "Execution retrieval decision",
        "--tags", "retrieval,search",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "execution retrieval",
        "--limit", "1",
        "--bundle-consumer", "auto",
        "--json",
        "--json-envelope",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as {
      schemaVersion: string;
      command: string;
      generatedAt: string;
      data: {
        count: number;
        bundles: Array<{
          route: {
            resolvedConsumer: string;
          };
        }>;
      };
    };

    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.equal(parsed.command, "memory bundle");
    assert.equal(typeof parsed.generatedAt, "string");
    assert.equal(parsed.data.count, 1);
    assert.equal(parsed.data.bundles[0]?.route.resolvedConsumer, "executor");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle can auto-route provenance memory toward reviewer handoff", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-routing-provenance-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Provenance Routing Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "summary",
        "--content", "Bundle import audit for retrieval policy bundle review.",
        "--summary", "Bundle import audit",
        "--tags", "provenance,bundle,audit",
        "--confidence", "0.88",
        "--freshness", "0.82",
        "--importance", "0.72",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "Bundle import audit",
        "--limit", "1",
        "--bundle-consumer", "auto",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      trace: { summary: string };
      route: {
        resolvedConsumer: string;
        profileUsed: string;
        source: string;
        warnings: string[];
      };
    }>;

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.route.resolvedConsumer, "reviewer");
    assert.equal(parsed[0]?.route.profileUsed, "reviewer");
    assert.equal(parsed[0]?.route.source, "auto");
    assert.ok(parsed[0]?.route.warnings.includes("contains_provenance_memory"));
    assert.match(parsed[0]?.trace.summary ?? "", /Reviewer hint: includes 1 provenance memory item\(s\)\./);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI bundle provenance mode can keep executor handoffs lean while preserving one risky provenance item", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-provenance-mode-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Bundle Provenance Mode Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "executor"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "task",
        "--content", "Ship rollout checklist with signed artifact validation.",
        "--summary", "Ship rollout checklist",
        "--importance", "0.92",
        "--confidence", "0.93",
        "--freshness", "0.91",
      ]),
      { repository },
    );
    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "summary",
        "--content", "Bundle import audit for rollout trust review.",
        "--summary", "Bundle import audit",
        "--tags", "provenance,bundle,audit",
        "--importance", "0.7",
        "--confidence", "0.84",
        "--freshness", "0.88",
      ]),
      { repository },
    );

    const noRisk = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "rollout checklist",
        "--limit", "1",
        "--bundle-consumer", "executor",
        "--bundle-provenance-mode", "auto",
        "--bundle-max-supporting", "4",
      ]),
      { repository },
    );
    const parsedNoRisk = JSON.parse(noRisk.lines.join("\n")) as Array<{
      primary: { annotations: string[] };
      supporting: Array<{ annotations: string[] }>;
    }>;
    assert.equal(parsedNoRisk.length, 1);
    assert.equal(
      parsedNoRisk[0]?.supporting.some((entry) => entry.annotations.includes("provenance")),
      false,
    );

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "summary",
        "--content", "Secondary audit note with stale provenance risk for rollout checklist.",
        "--summary", "Secondary rollout provenance audit",
        "--tags", "provenance,bundle,audit",
        "--importance", "0.66",
        "--confidence", "0.82",
        "--freshness", "0.18",
      ]),
      { repository },
    );

    const risk = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "rollout checklist",
        "--limit", "1",
        "--bundle-consumer", "executor",
        "--bundle-provenance-mode", "auto",
        "--bundle-max-supporting", "5",
      ]),
      { repository },
    );
    const parsedRisk = JSON.parse(risk.lines.join("\n")) as Array<{
      primary: { annotations: string[] };
      route: { warnings: string[] };
      supporting: Array<{ annotations: string[] }>;
    }>;
    assert.equal(parsedRisk.length, 1);
    const provenanceSupporting = parsedRisk[0]?.supporting.filter((entry) => entry.annotations.includes("provenance")) ?? [];
    const primaryHasProvenance = parsedRisk[0]?.primary.annotations.includes("provenance") ?? false;
    const totalProvenanceItems = provenanceSupporting.length + (primaryHasProvenance ? 1 : 0);
    assert.ok(parsedRisk[0]?.route.warnings.includes("contains_stale_memory"));
    assert.ok(totalProvenanceItems >= 1);
    assert.ok(provenanceSupporting.length <= 1);
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("CLI space routing policy can override auto-routing defaults", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "glialnode-bundle-routing-policy-cli-"));
  const databasePath = join(tempDirectory, "glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const createSpaceResult = await runCommand(
      parseArgs(["space", "create", "--name", "Routing Policy Space"]),
      { repository },
    );
    const spaceId = createSpaceResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(spaceId);

    await runCommand(
      parseArgs([
        "space", "configure",
        "--id", spaceId,
        "--routing-prefer-reviewer-on-contested", "false",
        "--routing-prefer-reviewer-on-stale", "false",
        "--routing-prefer-reviewer-on-provenance", "false",
        "--routing-prefer-planner-on-distilled", "true",
      ]),
      { repository },
    );

    const addScopeResult = await runCommand(
      parseArgs(["scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner"]),
      { repository },
    );
    const scopeId = addScopeResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(scopeId);

    const primaryResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "long",
        "--kind", "summary",
        "--content", "Distilled retrieval memory that is stale but still useful for planning.",
        "--summary", "Distilled retrieval memory",
        "--tags", "retrieval,distilled",
        "--confidence", "0.3",
        "--freshness", "0.3",
      ]),
      { repository },
    );
    const primaryId = primaryResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(primaryId);

    const contestedResult = await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "decision",
        "--content", "Legacy retrieval decision that has been superseded.",
        "--summary", "Legacy retrieval decision",
        "--status", "superseded",
        "--tags", "retrieval",
      ]),
      { repository },
    );
    const contestedId = contestedResult.lines.find((line) => line.startsWith("id="))?.slice(3);
    assert.ok(contestedId);

    await runCommand(
      parseArgs([
        "memory", "add",
        "--space-id", spaceId,
        "--scope-id", scopeId,
        "--scope-type", "agent",
        "--tier", "mid",
        "--kind", "summary",
        "--content", "Bundle import audit for retrieval policy review.",
        "--summary", "Bundle import audit",
        "--tags", "provenance,bundle,audit",
        "--confidence", "0.9",
        "--freshness", "0.88",
        "--importance", "0.63",
      ]),
      { repository },
    );

    await runCommand(
      parseArgs([
        "link", "add",
        "--space-id", spaceId,
        "--from-record-id", primaryId,
        "--to-record-id", contestedId,
        "--type", "references",
      ]),
      { repository },
    );

    const bundle = await runCommand(
      parseArgs([
        "memory", "bundle",
        "--space-id", spaceId,
        "--text", "retrieval",
        "--limit", "1",
        "--bundle-consumer", "auto",
      ]),
      { repository },
    );

    const parsed = JSON.parse(bundle.lines.join("\n")) as Array<{
      route: { resolvedConsumer: string; profileUsed: string; source: string };
    }>;

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.route.resolvedConsumer, "planner");
    assert.equal(parsed[0]?.route.profileUsed, "planner");
    assert.equal(parsed[0]?.route.source, "auto");
  } finally {
    repository.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
