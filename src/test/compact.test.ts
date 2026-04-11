import test from "node:test";
import assert from "node:assert/strict";

import { buildCompactMemoryText, createMemoryRecord } from "../index.js";

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
});
