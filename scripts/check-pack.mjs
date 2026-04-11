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

assert.ok(packagedFiles.has("dist/index.js"), "Packaged tarball must include dist/index.js.");
assert.ok(packagedFiles.has("dist/cli/index.js"), "Packaged tarball must include dist/cli/index.js.");
assert.ok(packagedFiles.has("dist/index.d.ts"), "Packaged tarball must include dist/index.d.ts.");
assert.ok(packagedFiles.has("README.md"), "Packaged tarball must include README.md.");
assert.ok(packagedFiles.has("LICENSE"), "Packaged tarball must include LICENSE.");
assert.ok(![...packagedFiles].some((path) => path.startsWith("dist/test/")), "Packaged tarball must not include dist/test artifacts.");

console.log(`Packaged files verified (${result.entryCount} entries).`);
