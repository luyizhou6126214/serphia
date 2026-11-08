import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { collectTurnChanges, parseUnifiedPatch } = await importTestBundle("turn-changes", {
  entryPoints: [path.join(import.meta.dirname, "turn-changes.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

const PATCH = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,3 @@", " keep", "-old line", "+new line", "+extra"].join(
  "\n",
);

/** One assistant tool call and its recorded result. */
function call(toolName, toolCallId, input, result = {}) {
  return [
    {
      role: "assistant",
      model: "test",
      provider: "test",
      content: [{ type: "toolCall", toolCallId, toolName, input }],
    },
    { role: "toolResult", toolCallId, content: [], ...result },
  ];
}

const turn = (...parts) => [{ role: "user", content: "prompt" }, ...parts.flat()];

test("an edit result patch becomes counts and a rendered diff", () => {
  const [file] = collectTurnChanges(
    turn(call("edit", "c1", { path: "src/a.ts" }, { details: { patch: PATCH } })),
    0,
    3,
    {
      cwd: "/repo",
    },
  );
  assert.equal(file.path, "/repo/src/a.ts");
  assert.equal(file.display, "src/a.ts");
  assert.equal(file.added, 2);
  assert.equal(file.deleted, 1);
  assert.equal(file.approximate, false);
  assert.deepEqual(
    file.diff.map((line) => line.kind),
    ["meta", "meta", "hunk", "context", "remove", "add", "add"],
  );
  assert.equal(file.diff[3].text, "keep");
});

test("an edit without a recorded patch rebuilds an approximate diff from its arguments", () => {
  const [file] = collectTurnChanges(
    turn(call("edit", "c1", { path: "src/b.ts", oldText: "before", newText: "after\nmore" })),
    0,
    3,
    { cwd: "/repo" },
  );
  assert.equal(file.approximate, true);
  assert.equal(file.added, 2);
  assert.equal(file.deleted, 1);
  assert.deepEqual(
    file.diff.map((line) => [line.kind, line.text]),
    [
      ["remove", "before"],
      ["add", "after"],
      ["add", "more"],
    ],
  );
});

test("a full write is approximate and counts its lines as additions", () => {
  const [file] = collectTurnChanges(
    turn(call("write", "c1", { path: "README.md", content: "one\ntwo\nthree" })),
    0,
    3,
    { cwd: "/repo" },
  );
  assert.equal(file.path, "/repo/README.md");
  assert.equal(file.added, 3);
  assert.equal(file.deleted, 0);
  assert.equal(file.approximate, true);
  assert.equal(file.diff.length, 3);
});

test("failed calls are ignored and repeated edits to one file merge", () => {
  const files = collectTurnChanges(
    turn(
      call("edit", "ok", { path: "src/a.ts" }, { details: { patch: PATCH } }),
      call("edit", "failed", { path: "src/ignored.ts" }, { isError: true }),
      call("edit", "again", { path: "src/a.ts", oldText: "x", newText: "y" }),
    ),
    0,
    7,
    { cwd: "/repo", home: "/repo" },
  );
  assert.equal(files.length, 1, "the failed edit contributes no file");
  assert.equal(files[0].added, 3);
  assert.equal(files[0].deleted, 2);
  assert.equal(files[0].approximate, true, "one approximate leg marks the merged file");
  assert.equal(files[0].display, "src/a.ts");
  assert.ok(
    files[0].diff.some((line) => line.kind === "meta" && line.text === ""),
    "merged diffs are separated",
  );
});

test("paths outside the workspace keep their recorded form and the patch parser skips headers", () => {
  const [file] = collectTurnChanges(
    turn(call("edit", "c1", { path: "C:\\repo\\lib\\a.ts" }, { details: { patch: PATCH } })),
    0,
    3,
    { cwd: "C:\\repo" },
  );
  assert.equal(file.display, "lib/a.ts");
  const lines = parseUnifiedPatch("--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new");
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["meta", "meta", "hunk", "remove", "add"],
  );
});
