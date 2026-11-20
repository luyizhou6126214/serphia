import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const selection = await importTestBundle("last-session-selection", {
  entryPoints: [path.join(import.meta.dirname, "last-session-selection.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

test("last reasoning choice persists and missing or legacy settings fall back to low", (t) => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => delete globalThis.localStorage);
  assert.equal(selection.readLastThinkingLevel(), "low");
  selection.saveLastThinkingLevel("max");
  assert.equal(selection.readLastThinkingLevel(), "max");
  for (const value of ["auto", "off", "invalid"]) {
    values.set("serphia-last-thinking-level", value);
    assert.equal(selection.readLastThinkingLevel(), "low");
  }
});
