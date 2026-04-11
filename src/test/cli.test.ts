import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
