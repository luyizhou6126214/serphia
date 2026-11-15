import assert from "node:assert/strict";
import test from "node:test";

import { getPresetFromToolNames, getToolNamesForPreset, PRESET_DEFAULT, PRESET_FULL } from "./tool-presets.ts";

test("tool preset detection uses the three available labels", () => {
  assert.equal(getPresetFromToolNames([]), "none");
  assert.equal(getPresetFromToolNames(PRESET_DEFAULT), "default");
  assert.equal(getPresetFromToolNames(PRESET_FULL), "full");
  assert.equal(getPresetFromToolNames(["read"]), "default");
  assert.equal(getPresetFromToolNames(PRESET_FULL.filter((name) => name !== "codemode")), "default");
  assert.ok(getToolNamesForPreset("full").includes("codemode"));
  assert.ok(getToolNamesForPreset("full").includes("tool_search"));
});

test("preset tool arrays are defensive copies", () => {
  const selected = getToolNamesForPreset("full");
  selected.pop();
  assert.deepEqual(getToolNamesForPreset("full"), PRESET_FULL);
  assert.deepEqual(getToolNamesForPreset("none"), []);
});
