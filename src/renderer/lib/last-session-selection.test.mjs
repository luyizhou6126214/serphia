import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const selection = await importTestBundle("last-session-selection", {
  entryPoints: [path.join(import.meta.dirname, "last-session-selection.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

test("last reasoning choice persists, including auto, and invalid data falls back safely", (t) => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => delete globalThis.localStorage);
  selection.saveLastThinkingLevel("high");
  assert.equal(selection.readLastThinkingLevel(), "high");
  selection.saveLastThinkingLevel("auto");
  assert.equal(selection.readLastThinkingLevel(), "auto");
  values.set("serphia-last-thinking-level", "invalid");
  assert.equal(selection.readLastThinkingLevel(), "auto");
});
