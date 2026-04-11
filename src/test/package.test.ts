import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageManifest = {
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  engines?: Record<string, string>;
};

test("compiled CLI keeps a portable shebang for package installs", () => {
  const cliEntry = readFileSync(join(process.cwd(), "dist", "cli", "index.js"), "utf8");
  assert.match(cliEntry, /^#!\/usr\/bin\/env node/);
});

test("package manifest exposes a publishable cross-platform surface", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as PackageManifest;

  assert.equal(manifest.bin?.glialnode, "dist/cli/index.js");
  assert.ok(manifest.exports?.["."]);
  assert.ok(manifest.exports?.["./cli"]);
  assert.ok(manifest.files?.includes("dist/**/*"));
  assert.ok(manifest.files?.includes("!dist/test/**/*"));
  assert.equal(manifest.engines?.node, ">=24");
});
