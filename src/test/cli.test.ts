import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.ok(settingsLine);
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

    assert.equal(settings.routing?.preferExecutorOnActionable, false);
    assert.equal(settings.routing?.preferPlannerOnDistilled, false);
    assert.equal(settings.reinforcement?.confidenceBoost, 0.1);
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
    const keyId = generated.lines.find((line) => line.startsWith("keyId="))?.slice(6);
    assert.ok(keyId);

    const listed = await runCommand(
      parseArgs(["preset", "key-list", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(listed.lines.join("\n"), /keys=1/);
    assert.match(listed.lines.join("\n"), /team-executor/);

    const shown = await runCommand(
      parseArgs(["preset", "key-show", "--name", "team-executor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(shown.lines.join("\n"), /algorithm=ed25519/);
    assert.match(shown.lines.join("\n"), /signer=GlialNode Test/);

    const exported = await runCommand(
      parseArgs(["preset", "key-export", "--name", "team-executor", "--output", publicKeyPath, "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(exported.lines[0], "Signing public key exported.");
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

    await runCommand(
      parseArgs(["preset", "key-export", "--name", "team-executor-key", "--output", publicKeyPath, "--directory", presetDirectory]),
      { repository },
    );
    const trustedFromFile = await runCommand(
      parseArgs(["preset", "trust-register", "--input", publicKeyPath, "--name", "team-public", "--signer", "GlialNode Test", "--directory", presetDirectory]),
      { repository },
    );
    assert.equal(trustedFromFile.lines[0], "Trusted signer registered.");

    const listed = await runCommand(
      parseArgs(["preset", "trust-list", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(listed.lines.join("\n"), /trustedSigners=2/);
    assert.match(listed.lines.join("\n"), /team-anchor/);
    assert.match(listed.lines.join("\n"), /team-public/);

    const shown = await runCommand(
      parseArgs(["preset", "trust-show", "--name", "team-anchor", "--directory", presetDirectory]),
      { repository },
    );
    assert.match(shown.lines.join("\n"), /algorithm=ed25519/);
    assert.match(shown.lines.join("\n"), /source=signing-key:team-executor-key/);

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
    assert.match(trustedByName.lines.join("\n"), /effectivePolicy=/);

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
      /Trusted signer is revoked: team-anchor/,
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
      space: { id: string };
      scopes: Array<{ id: string }>;
      events: Array<{ type: string }>;
      records: unknown[];
    };

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
