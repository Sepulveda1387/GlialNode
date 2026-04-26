import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const npmCliPath = process.env.npm_execpath;

if (!npmCliPath) {
  throw new Error("npm_execpath is not available; cannot run npm pack validation.");
}

const output = execFileSync(process.execPath, [npmCliPath, "pack", "--dry-run", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

const [result] = JSON.parse(output);

if (!result) {
  throw new Error("Expected npm pack --dry-run --json to return a result.");
}

const packagedFiles = new Set(result.files.map((file) => file.path));

for (const filePath of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/index.js",
  "dist/dashboard/index.js",
  "dist/dashboard/index.d.ts",
  "dist/execution-context/index.js",
  "dist/execution-context/index.d.ts",
  "dist/metrics/index.js",
  "dist/metrics/index.d.ts",
  "README.md",
  "LICENSE",
]) {
  assert.ok(packagedFiles.has(filePath), `Packaged tarball must include ${filePath}.`);
}

assert.ok(![...packagedFiles].some((path) => path.startsWith("dist/test/")), "Packaged tarball must not include dist/test artifacts.");

console.log(`Packaged files verified (${result.entryCount} entries).`);
