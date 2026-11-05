import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_FONT_SCALE,
  CHAT_FONT_SIZES,
  CHAT_LAYOUTS,
  CHAT_ASSISTANT_WIDTHS,
  DEFAULT_CHAT_APPEARANCE,
  isChatAppearancePreferences,
  normalizeChatAppearance,
} from "./chat-appearance.ts";
import { WORK_STEP_DISPLAYS } from "./work-step-display.ts";

test("chat appearance exposes font sizes, layout modes and work-step levels", () => {
  assert.deepEqual(CHAT_FONT_SIZES, ["small", "standard", "large", "extra-large"]);
  assert.deepEqual(CHAT_LAYOUTS, ["fixed", "wide"]);
  assert.deepEqual(WORK_STEP_DISPLAYS, ["compact", "standard", "detailed", "verbose"]);
  assert.deepEqual(CHAT_FONT_SCALE, { small: 0.9, standard: 1, large: 1.15, "extra-large": 1.3 });
  assert.deepEqual(DEFAULT_CHAT_APPEARANCE, {
    fontSize: "standard",
    layout: "fixed",
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
});

test("normalization preserves known values and repairs fields independently", () => {
  for (const fontSize of CHAT_FONT_SIZES) {
    for (const layout of CHAT_LAYOUTS) {
      for (const workStepDisplay of WORK_STEP_DISPLAYS) {
        for (const assistantWidth of CHAT_ASSISTANT_WIDTHS) {
          const value = { fontSize, layout, workStepDisplay, assistantWidth };
          assert.equal(isChatAppearancePreferences(value), true);
          assert.deepEqual(normalizeChatAppearance(value), value);
        }
      }
    }
  }

  assert.deepEqual(normalizeChatAppearance({ fontSize: "large", layout: "future" }), {
    fontSize: "large",
    layout: "fixed",
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
  assert.deepEqual(normalizeChatAppearance({ fontSize: 2, layout: "wide", assistantWidth: "comfortable" }), {
    fontSize: "standard",
    layout: "wide",
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
});

test("normalization migrates the removed full-width value to wide", () => {
  const legacy = { fontSize: "large", layout: "full" };
  assert.equal(isChatAppearancePreferences(legacy), false);
  assert.deepEqual(normalizeChatAppearance(legacy), {
    fontSize: "large",
    layout: "wide",
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
});

test("malformed chat appearance values use backward-compatible defaults", () => {
  for (const value of [undefined, null, true, "large", [], { fontSize: "future" }]) {
    assert.deepEqual(normalizeChatAppearance(value), {
      fontSize: "standard",
      layout: "fixed",
      workStepDisplay: "standard",
      assistantWidth: "comfortable",
    });
    assert.equal(isChatAppearancePreferences(value), false);
  }
});

test("legacy preferences default to comfortable replies and invalid fields are repaired independently", () => {
  const legacy = { fontSize: "large", layout: "wide" };
  assert.equal(isChatAppearancePreferences(legacy), true);
  assert.deepEqual(normalizeChatAppearance(legacy), {
    ...legacy,
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
  for (const assistantWidth of [null, "max", 100, {}, []]) {
    const invalid = { ...legacy, assistantWidth };
    assert.equal(isChatAppearancePreferences(invalid), false);
    assert.deepEqual(normalizeChatAppearance(invalid), {
      ...legacy,
      workStepDisplay: "standard",
      assistantWidth: "comfortable",
    });
  }
  const invalidWorkSteps = { ...legacy, workStepDisplay: "expanded" };
  assert.equal(isChatAppearancePreferences(invalidWorkSteps), false);
  assert.deepEqual(normalizeChatAppearance(invalidWorkSteps), {
    fontSize: "large",
    layout: "wide",
    workStepDisplay: "standard",
    assistantWidth: "comfortable",
  });
});
