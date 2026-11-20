import assert from "node:assert/strict";
import test from "node:test";
import { setAppLanguage } from "../i18n.ts";

import {
  filterSessionsForQuery,
  getSessionDisplayTitle,
  resolveInitialSessionRestore,
  sessionDateGroup,
  sessionMatchesQuery,
} from "./session-list.ts";

function session(id, overrides = {}) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd: "/workspace/pi-desktop",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

test("groups sessions into calendar-aware recency buckets", () => {
  const localDate = (day, hour) => new Date(2026, 6, day, hour).toISOString();
  const now = new Date(2026, 6, 15, 18);
  assert.equal(sessionDateGroup(localDate(15, 9), now), "today");
  assert.equal(sessionDateGroup(localDate(10, 9), now), "recent");
  assert.equal(sessionDateGroup(localDate(1, 9), now), "older");
  assert.equal(sessionDateGroup("invalid", now), "older");
});

test("searches useful session metadata and retains matching ancestors", () => {
  const parent = session("parent", { name: "Root session" });
  const child = session("child", {
    parentSessionId: "parent",
    firstMessage: "Investigate keyboard navigation",
    worktreeBranch: "codex/accessibility",
  });
  const unrelated = session("other", { firstMessage: "Unrelated task", cwd: "/workspace/other" });

  assert.deepEqual(
    filterSessionsForQuery([parent, child, unrelated], "keyboard").map((item) => item.id),
    ["parent", "child"],
  );
  assert.deepEqual(
    filterSessionsForQuery([parent, child, unrelated], "ACCESSIBILITY").map((item) => item.id),
    ["parent", "child"],
  );
  assert.deepEqual(
    filterSessionsForQuery([parent, child, unrelated], "/workspace/other").map((item) => item.id),
    ["other"],
  );
});

test("builds stable compact titles from names, prompts, and ids", () => {
  assert.equal(getSessionDisplayTitle(session("id", { name: "  Named session  " })), "Named session");
  assert.equal(
    getSessionDisplayTitle(session("id", { firstMessage: "Investigate\n  keyboard   navigation" })),
    "Investigate keyboard navigation",
  );
  assert.equal(getSessionDisplayTitle(session("fallback-id")), "fallback-id");
  assert.equal(
    getSessionDisplayTitle(session("id", { firstMessage: "A long title for truncation" }), 12),
    "A long titl…",
  );
});

test("shows a localized branch prefix on renamed and existing branches", (t) => {
  const renamed = session("branch", { isFork: true, name: "市场调研" });
  assert.equal(getSessionDisplayTitle(renamed), "Branch · 市场调研");
  setAppLanguage("zh-CN");
  t.after(() => setAppLanguage("en-US"));
  assert.equal(getSessionDisplayTitle(renamed), "分支 · 市场调研");
  assert.equal(
    getSessionDisplayTitle(session("older", { parentSessionId: "root", firstMessage: "市场调研" })),
    "分支 · 市场调研",
  );
  assert.equal(getSessionDisplayTitle(session("root", { name: "市场调研" })), "市场调研");
  assert.equal(sessionMatchesQuery(renamed, "分支 · 市场调研"), true);
});

test("shows the user request instead of skill syntax while the automatic title is pending", () => {
  assert.equal(
    getSessionDisplayTitle(session("id", { firstMessage: "/skill:hyperframes 帮我生成介绍视频" })),
    "帮我生成介绍视频",
  );
  assert.equal(getSessionDisplayTitle(session("id", { firstMessage: "/skill:one /skill:two 设计页面" })), "设计页面");
  assert.equal(getSessionDisplayTitle(session("id", { firstMessage: "/skill:one /skill:two" })), "one, two");
  assert.equal(
    getSessionDisplayTitle(session("id", { name: "/skill:my custom title", firstMessage: "/skill:one 设计页面" })),
    "/skill:my custom title",
  );
  assert.equal(getSessionDisplayTitle(session("id", { firstMessage: "/model select" })), "/model select");
  assert.equal(
    getSessionDisplayTitle(session("id", { firstMessage: '/skill:one 检查 @"my /skill:notes file.md"' })),
    '检查 @"my /skill:notes file.md"',
  );
});

test("initial session restore waits for a successful list result", () => {
  assert.deepEqual(resolveInitialSessionRestore([], "missing", true, false, false), { status: "wait" });
  assert.deepEqual(resolveInitialSessionRestore([], "missing", false, true, false), { status: "wait" });
});

test("a successfully loaded empty list completes the not-found restore path", () => {
  assert.deepEqual(resolveInitialSessionRestore([], "missing", false, false, false), { status: "not-found" });
  assert.deepEqual(resolveInitialSessionRestore([], "missing", false, false, true), { status: "none" });
});

test("initial session restore returns the matching session", () => {
  const target = session("target");
  assert.deepEqual(resolveInitialSessionRestore([session("other"), target], "target", false, false, false), {
    status: "restore",
    session: target,
  });
});
