import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORK_STEP_DISPLAY,
  WORK_STEP_DISPLAYS,
  isWorkStepDisplay,
  workStepDisplayPolicy,
} from "./work-step-display.ts";

test("work step modes expose the four transcript detail levels", () => {
  assert.deepEqual(WORK_STEP_DISPLAYS, ["compact", "standard", "detailed", "verbose"]);
  assert.equal(DEFAULT_WORK_STEP_DISPLAY, "standard");
  assert.equal(isWorkStepDisplay("standard"), true);
  for (const value of [undefined, null, "full", 1, {}]) assert.equal(isWorkStepDisplay(value), false);
});

test("compact folds process rows without previews", () => {
  const policy = workStepDisplayPolicy("compact");
  assert.equal(policy.groupProcess, true);
  assert.equal(policy.defaultProcessExpanded, false);
  assert.equal(policy.showStepPreview, false);
  assert.equal(policy.defaultToolExpanded, false);
  assert.equal(policy.defaultThinkingExpanded, false);
});

test("standard keeps previews while folding history", () => {
  const policy = workStepDisplayPolicy("standard");
  assert.equal(policy.groupProcess, true);
  assert.equal(policy.defaultProcessExpanded, false);
  assert.equal(policy.showStepPreview, true);
  assert.equal(policy.defaultToolExpanded, false);
  assert.equal(policy.defaultThinkingExpanded, false);
});

test("detailed opens historical process groups but keeps individual rows folded", () => {
  const policy = workStepDisplayPolicy("detailed");
  assert.equal(policy.groupProcess, true);
  assert.equal(policy.defaultProcessExpanded, true);
  assert.equal(policy.showStepPreview, true);
  assert.equal(policy.defaultToolExpanded, false);
  assert.equal(policy.defaultThinkingExpanded, false);
});

test("verbose removes grouping and opens tool and thinking rows", () => {
  const policy = workStepDisplayPolicy("verbose");
  assert.equal(policy.groupProcess, false);
  assert.equal(policy.defaultProcessExpanded, true);
  assert.equal(policy.showStepPreview, true);
  assert.equal(policy.defaultToolExpanded, true);
  assert.equal(policy.defaultThinkingExpanded, true);
});

test("an absent mode falls back to the standard policy", () => {
  assert.deepEqual(workStepDisplayPolicy(undefined), workStepDisplayPolicy("standard"));
});
