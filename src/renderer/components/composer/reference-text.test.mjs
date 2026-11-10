import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { ReferenceText, referenceDeletionRange, referenceCursorDestination } = await importTestBundle("reference-text", {
  stdin: {
    contents:
      'export { ReferenceText, referenceDeletionRange, referenceCursorDestination } from "./ReferenceText.tsx";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "lucide-react"],
});

test("references keep their source text and distinguish skills, MCP and quoted files", () => {
  const render = (text, requireTerminator = false) =>
    renderToStaticMarkup(createElement(ReferenceText, { text, requireTerminator }));
  assert.match(render('/skill:ego-browser check @"my folder/file.ts" '), /data-reference-kind="skill"/);
  assert.match(
    render('/skill:ego-browser check @"my folder/file.ts" '),
    /data-reference-kind="file"[^>]*>.*my folder\/file.ts&quot;/,
  );
  assert.match(render("/mcp status"), /data-reference-kind="mcp"/);
  assert.doesNotMatch(render("email@example.com @unfinished", true), /chat-reference-tag/);
  assert.match(render("@finished.ts ", true), /data-reference-kind="file"/);
});

test("deletion treats rendered references as units without affecting ordinary text", () => {
  const skill = "/skill:ego-browser ";
  assert.deepEqual(referenceDeletionRange(skill, skill.length, skill.length, "Backspace"), {
    start: 0,
    end: skill.length,
  });
  assert.deepEqual(referenceDeletionRange(skill, 4, 4, "Delete"), { start: 0, end: skill.length - 1 });
  assert.deepEqual(referenceDeletionRange(skill, 3, 6, "Backspace"), { start: 0, end: skill.length - 1 });
  const file = 'see @"my folder/file.ts" next';
  const start = file.indexOf("@");
  const end = file.indexOf('" next') + 1;
  assert.deepEqual(referenceDeletionRange(file, start, start, "Delete"), { start, end });
  assert.equal(referenceDeletionRange("plain text", 5, 5, "Backspace"), null);
  assert.equal(referenceDeletionRange("@unfinished", 5, 5, "Backspace"), null);
  assert.deepEqual(referenceDeletionRange("/mcp status", 4, 4, "Backspace"), { start: 0, end: 4 });
});

test("arrow movement skips completed references in either direction", () => {
  const text = '/skill:design read @"my folder/file.ts" now';
  const skillEnd = text.indexOf(" ");
  const fileStart = text.indexOf("@");
  const fileEnd = text.indexOf('" now') + 1;
  assert.equal(referenceCursorDestination(text, 0, "right"), skillEnd);
  assert.equal(referenceCursorDestination(text, skillEnd, "left"), 0);
  assert.equal(referenceCursorDestination(text, 3, "right"), skillEnd);
  assert.equal(referenceCursorDestination(text, fileStart, "right"), fileEnd);
  assert.equal(referenceCursorDestination(text, fileEnd, "left"), fileStart);
  assert.equal(referenceCursorDestination(text, skillEnd, "right"), null);
  assert.equal(referenceCursorDestination("@unfinished", 0, "right"), null);
  assert.equal(referenceCursorDestination("/mcp status", 0, "right"), 4);
});

test("file references choose icons from the file extension", () => {
  const render = (text) => renderToStaticMarkup(createElement(ReferenceText, { text }));
  assert.match(render("@src/Panel.tsx "), /<title>React<\/title>/);
  assert.match(render("@src/main.rs "), /<title>Rust<\/title>/);
  assert.match(render("@docs/README.md "), /data-reference-kind="file"/);
});
