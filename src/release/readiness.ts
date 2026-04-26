import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { assertStorageAdapterContract } from "../storage/adapter.js";
import { sqliteAdapter } from "../storage/sqlite/sqlite-adapter.js";

export type ReleaseReadinessStatus = "pass" | "fail";

export interface ReleaseReadinessInputs {
  rootDirectory?: string;
  testsGreen?: boolean;
  packGreen?: boolean;
  demoGreen?: boolean;
  docsReviewed?: boolean;
  userApproved?: boolean;
  treeClean?: boolean;
  generatedAt?: string;
}

export interface ReleaseReadinessCheck {
  id: string;
  label: string;
  status: ReleaseReadinessStatus;
  summary: string;
}

export interface ReleaseReadinessReport {
  status: "ready" | "blocked";
  generatedAt: string;
  rootDirectory: string;
  checks: ReleaseReadinessCheck[];
  blockers: string[];
  manualInputs: {
    testsGreen: boolean;
    packGreen: boolean;
    demoGreen: boolean;
    docsReviewed: boolean;
    userApproved: boolean;
    treeClean: boolean;
  };
}

const REQUIRED_RELEASE_DOCS = [
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/live-roadmap.gnl.md",
  "docs/launch-checklist.md",
  "docs/publish-guide.md",
  "docs/operator-guide.md",
  "docs/compatibility.md",
  "docs/json-contract.md",
  "docs/decision-notes.md",
  "docs/graph-export.md",
  "docs/metrics.md",
  "docs/trust-packs.md",
  "docs/troubleshooting.md",
  "docs/storage-backends.md",
  "docs/release-readiness.md",
];

export function buildReleaseReadinessReport(inputs: ReleaseReadinessInputs = {}): ReleaseReadinessReport {
  const rootDirectory = resolve(inputs.rootDirectory ?? process.cwd());
  const manualInputs = {
    testsGreen: inputs.testsGreen ?? false,
    packGreen: inputs.packGreen ?? false,
    demoGreen: inputs.demoGreen ?? false,
    docsReviewed: inputs.docsReviewed ?? false,
    userApproved: inputs.userApproved ?? false,
    treeClean: inputs.treeClean ?? false,
  };

  const checks: ReleaseReadinessCheck[] = [
    checkV1P0Roadmap(rootDirectory),
    checkPublishGate(rootDirectory),
    checkReleaseDocs(rootDirectory),
    checkPackageSurface(rootDirectory),
    checkStorageContract(),
    manualCheck("tests_green", "Tests confirmed green", manualInputs.testsGreen, "Run `npm test` and confirm it passes."),
    manualCheck("pack_green", "Package check confirmed green", manualInputs.packGreen, "Run `npm run pack:check` and confirm it passes."),
    manualCheck("demo_green", "Demo flows confirmed green", manualInputs.demoGreen, "Run `npm run demo` and `npm run demo:dashboard` and confirm they pass."),
    manualCheck("docs_reviewed", "Release docs reviewed", manualInputs.docsReviewed, "Review launch, publish, compatibility, operator, and storage docs."),
    manualCheck("tree_clean", "Git tree confirmed clean", manualInputs.treeClean, "Confirm there are no uncommitted release changes."),
    manualCheck("user_approved", "User approved publishing", manualInputs.userApproved, "Publishing remains blocked until explicitly approved."),
  ];

  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.summary}`);

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    generatedAt: inputs.generatedAt ?? new Date().toISOString(),
    rootDirectory,
    checks,
    blockers,
    manualInputs,
  };
}

function checkV1P0Roadmap(rootDirectory: string): ReleaseReadinessCheck {
  const roadmap = readText(rootDirectory, "docs/live-roadmap.gnl.md");

  if (!roadmap) {
    return fail("v1_p0_roadmap", "V1/P0 roadmap", "docs/live-roadmap.gnl.md is missing.");
  }

  const p0Lines = roadmap.split(/\r?\n/).filter((line) => line.startsWith("CK:V1.P0."));
  const openLines = p0Lines.filter((line) => !/\|\s*S:D\s*\|/.test(line));

  if (p0Lines.length === 0) {
    return fail("v1_p0_roadmap", "V1/P0 roadmap", "No V1/P0 checklist lines were found.");
  }

  if (openLines.length > 0) {
    return fail("v1_p0_roadmap", "V1/P0 roadmap", `${openLines.length} V1/P0 roadmap item(s) are not marked done.`);
  }

  return pass("v1_p0_roadmap", "V1/P0 roadmap", `${p0Lines.length} V1/P0 roadmap item(s) are marked done.`);
}

function checkPublishGate(rootDirectory: string): ReleaseReadinessCheck {
  const roadmap = readText(rootDirectory, "docs/live-roadmap.gnl.md");
  if (!roadmap) {
    return fail("publish_gate", "Publish gate", "Roadmap is missing, so GT:V1.PUB cannot be inspected.");
  }

  const gateLine = roadmap.split(/\r?\n/).find((line) => line.startsWith("GT:V1.PUB"));
  if (!gateLine) {
    return fail("publish_gate", "Publish gate", "GT:V1.PUB is missing from the live roadmap.");
  }

  if (!gateLine.includes("tests=green") || !gateLine.includes("pack=green") || !gateLine.includes("tree=clean")) {
    return fail("publish_gate", "Publish gate", "GT:V1.PUB does not mention tests, pack check, and clean tree requirements.");
  }

  return pass("publish_gate", "Publish gate", "GT:V1.PUB release gate is present with expected guardrails.");
}

function checkReleaseDocs(rootDirectory: string): ReleaseReadinessCheck {
  const missing = REQUIRED_RELEASE_DOCS.filter((relativePath) => !existsSync(join(rootDirectory, relativePath)));

  if (missing.length > 0) {
    return fail("release_docs", "Release docs", `Missing release doc(s): ${missing.join(", ")}.`);
  }

  return pass("release_docs", "Release docs", `${REQUIRED_RELEASE_DOCS.length} release document(s) are present.`);
}

function checkPackageSurface(rootDirectory: string): ReleaseReadinessCheck {
  const packageJsonText = readText(rootDirectory, "package.json");
  if (!packageJsonText) {
    return fail("package_surface", "Package surface", "package.json is missing.");
  }

  let manifest: {
    engines?: { node?: string };
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
  };

  try {
    manifest = JSON.parse(packageJsonText) as typeof manifest;
  } catch {
    return fail("package_surface", "Package surface", "package.json is not valid JSON.");
  }

  const missing = [];
  if (manifest.engines?.node !== ">=24") {
    missing.push("engines.node >=24");
  }
  if (manifest.bin?.glialnode !== "dist/cli/index.js") {
    missing.push("glialnode bin");
  }
  for (const fileEntry of ["dist/**/*", "README.md", "LICENSE"]) {
    if (!manifest.files?.includes(fileEntry)) {
      missing.push(`files includes ${fileEntry}`);
    }
  }
  for (const scriptName of ["check", "test", "pack:check", "demo", "demo:dashboard"]) {
    if (!manifest.scripts?.[scriptName]) {
      missing.push(`script ${scriptName}`);
    }
  }

  if (missing.length > 0) {
    return fail("package_surface", "Package surface", `Missing package release surface: ${missing.join(", ")}.`);
  }

  return pass("package_surface", "Package surface", "Package manifest exposes the expected release surface.");
}

function checkStorageContract(): ReleaseReadinessCheck {
  try {
    assertStorageAdapterContract(sqliteAdapter);
    return pass("storage_contract", "Storage contract", "SQLite storage adapter contract is valid.");
  } catch (error) {
    return fail("storage_contract", "Storage contract", error instanceof Error ? error.message : "Storage contract validation failed.");
  }
}

function manualCheck(id: string, label: string, confirmed: boolean, instruction: string): ReleaseReadinessCheck {
  return confirmed
    ? pass(id, label, "Confirmed.")
    : fail(id, label, `Not confirmed. ${instruction}`);
}

function readText(rootDirectory: string, relativePath: string): string | undefined {
  const absolutePath = join(rootDirectory, relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  return readFileSync(absolutePath, "utf8");
}

function pass(id: string, label: string, summary: string): ReleaseReadinessCheck {
  return { id, label, status: "pass", summary };
}

function fail(id: string, label: string, summary: string): ReleaseReadinessCheck {
  return { id, label, status: "fail", summary };
}
