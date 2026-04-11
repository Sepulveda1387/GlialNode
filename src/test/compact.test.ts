import test from "node:test";
import assert from "node:assert/strict";

import { buildCompactMemoryText, createMemoryRecord, promoteRecord, updateRecordStatus } from "../index.js";

test("compact memory text preserves structured signal in a token-efficient form", () => {
  const compact = buildCompactMemoryText({
    tier: "short",
    kind: "task",
    content: "Fix the login bug first and keep mobile support intact.",
    summary: "Login bug first",
    scope: {
      id: "planner-1",
      type: "agent",
    },
    tags: ["auth", "mobile"],
    importance: 0.95,
    confidence: 0.9,
    freshness: 0.8,
    status: "active",
  });

  assert.match(compact, /^tr=s;k=tsk;sc=agt:planner-1;st=act;/);
  assert.match(compact, /sm=login_bug_first/);
  assert.match(compact, /ct=fix_login_bug_first_keep_mobile_support_intact/);
  assert.match(compact, /tg=auth,mobile/);
});

test("memory record creation auto-generates compact content unless provided", () => {
  const generated = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "decision",
    content: "Prefer lexical retrieval first.",
    summary: "Lexical retrieval",
    scope: { id: "scope_1", type: "agent" },
  });

  assert.ok(generated.compactContent);
  assert.match(generated.compactContent ?? "", /k=dec/);
  assert.equal(generated.compactSource, "generated");

  const explicit = createMemoryRecord({
    spaceId: "space_1",
    tier: "mid",
    kind: "decision",
    content: "Prefer lexical retrieval first.",
    summary: "Lexical retrieval",
    compactContent: "U:req retrieval=lexical_first",
    scope: { id: "scope_1", type: "agent" },
  });

  assert.equal(explicit.compactContent, "U:req retrieval=lexical_first");
  assert.equal(explicit.compactSource, "manual");
});

test("generated compact memory stays in sync through record lifecycle changes", () => {
  const record = createMemoryRecord({
    spaceId: "space_1",
    tier: "short",
    kind: "task",
    content: "Keep mobile support intact.",
    summary: "Keep mobile",
    scope: { id: "scope_1", type: "agent" },
  });

  const promoted = promoteRecord(record);
  assert.equal(promoted.compactSource, "generated");
  assert.match(promoted.compactContent ?? "", /tr=m/);

  const archived = updateRecordStatus(promoted, "archived");
  assert.match(archived.compactContent ?? "", /st=arc/);
});

test("manual compact memory is preserved through record lifecycle changes", () => {
  const record = createMemoryRecord({
    spaceId: "space_1",
    tier: "short",
    kind: "task",
    content: "Keep mobile support intact.",
    summary: "Keep mobile",
    compactContent: "U:req keep mobile",
    scope: { id: "scope_1", type: "agent" },
  });

  const promoted = promoteRecord(record);
  assert.equal(promoted.compactSource, "manual");
  assert.equal(promoted.compactContent, "U:req keep mobile");

  const archived = updateRecordStatus(promoted, "archived");
  assert.equal(archived.compactContent, "U:req keep mobile");
});
