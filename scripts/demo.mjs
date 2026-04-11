import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeExecutable = process.execPath;
const tscPath = join(root, "node_modules", "typescript", "lib", "tsc.js");
const cliPath = join(root, "dist", "cli", "index.js");
const dbPath = join(root, ".glialnode", "demo.sqlite");
const exportPath = join(root, ".glialnode", "demo-export.json");

removeIfExists(dbPath);
removeIfExists(exportPath);
removeIfExists(join(root, "dist"));

logStep("Building GlialNode");
run(nodeExecutable, [tscPath, "-p", "tsconfig.json"]);

logStep("Creating Space");
const spaceOutput = run(nodeExecutable, [cliPath, "space", "create", "--name", "Demo Space", "--db", dbPath]);
process.stdout.write(spaceOutput);
const spaceId = readId(spaceOutput);

logStep("Configuring Policy");
process.stdout.write(
  run(nodeExecutable, [cliPath, "space", "configure", "--id", spaceId, "--retention-short-days", "0", "--db", dbPath]),
);

logStep("Adding Scope");
const scopeOutput = run(nodeExecutable, [cliPath, "scope", "add", "--space-id", spaceId, "--type", "agent", "--label", "planner", "--db", dbPath]);
process.stdout.write(scopeOutput);
const scopeId = readId(scopeOutput);

logStep("Writing Records");
process.stdout.write(
  run(nodeExecutable, [
    cliPath,
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
    "Promote this note.",
    "--summary",
    "Promote me",
    "--importance",
    "0.95",
    "--confidence",
    "0.9",
    "--freshness",
    "0.8",
    "--db",
    dbPath,
  ]),
);
process.stdout.write(
  run(nodeExecutable, [
    cliPath,
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
    "Expire this note.",
    "--summary",
    "Expire me",
    "--db",
    dbPath,
  ]),
);

logStep("Running Maintenance");
process.stdout.write(
  run(nodeExecutable, [cliPath, "space", "maintain", "--id", spaceId, "--apply", "--db", dbPath]),
);

logStep("Reporting");
process.stdout.write(
  run(nodeExecutable, [cliPath, "space", "report", "--id", spaceId, "--db", dbPath]),
);

logStep("Exporting");
process.stdout.write(
  run(nodeExecutable, [cliPath, "export", "--space-id", spaceId, "--output", exportPath, "--db", dbPath]),
);

console.log("");
console.log("Demo completed.");
console.log(`Database: ${dbPath}`);
console.log(`Export:   ${exportPath}`);

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
}

function readId(output) {
  const idLine = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("id="));

  if (!idLine) {
    throw new Error("Expected command output to contain an id= line.");
  }

  return idLine.slice(3);
}

function logStep(title) {
  console.log(`== ${title} ==`);
}

function removeIfExists(path) {
  const resolved = resolve(path);
  if (existsSync(resolved)) {
    const stats = lstatSync(resolved);
    rmSync(resolved, { force: true, recursive: stats.isDirectory() });
  }
}
