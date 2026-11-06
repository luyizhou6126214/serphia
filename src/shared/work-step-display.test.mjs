import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORK_STEP_DISPLAY,
  WORK_STEP_DISPLAYS,
  groupsStepsForTurn,
  isWorkStepDisplay,
  workStepDisplayPolicy,
} from "./work-step-display.ts";

test("work step modes expose the four transcript detail levels", () => {
  assert.deepEqual(WORK_STEP_DISPLAYS, ["compact", "standard", "detailed", "verbose"]);
  assert.equal(DEFAULT_WORK_STEP_DISPLAY, "standard");
  assert.equal(isWorkStepDisplay("standard"), true);
  assert.equal(isWorkStepDisplay("normal"), false);
  assert.equal(isWorkStepDisplay("expanded"), false);
  for (const value of [undefined, null, "full", 1, {}]) assert.equal(isWorkStepDisplay(value), false);
});

test("every mode resolves one stable policy object", () => {
  for (const mode of WORK_STEP_DISPLAYS) {
    const policy = workStepDisplayPolicy(mode);
    assert.equal(policy.mode, mode);
    assert.equal(workStepDisplayPolicy(mode), policy);
  }
});

test("compact folds process rows without previews", () => {
  const policy = workStepDisplayPolicy("compact");
  assert.equal(policy.foldCompletedTurns, true);
  assert.equal(policy.stepGrouping, "collapsed");
  assert.equal(policy.liveProcessDetail, false);
  assert.equal(policy.settledReasoningPreview, false);
});

test("standard keeps previews while folding history", () => {
  const policy = workStepDisplayPolicy("standard");
  assert.equal(policy.foldCompletedTurns, true);
  assert.equal(policy.stepGrouping, "collapsed");
  assert.equal(policy.liveProcessDetail, true);
  assert.equal(policy.settledReasoningPreview, true);
});

test("detailed leaves the running turn inline and groups only settled turns", () => {
  const policy = workStepDisplayPolicy("detailed");
  assert.equal(policy.foldCompletedTurns, true);
  assert.equal(policy.stepGrouping, "history");
  assert.equal(policy.liveProcessDetail, true);
  assert.equal(policy.settledReasoningPreview, true);
  assert.equal(groupsStepsForTurn(policy, false), false);
  assert.equal(groupsStepsForTurn(policy, true), true);
});

test("verbose removes grouping and the whole-Turn fold", () => {
  const policy = workStepDisplayPolicy("verbose");
  assert.equal(policy.foldCompletedTurns, false);
  assert.equal(policy.stepGrouping, "none");
  assert.equal(policy.liveProcessDetail, false);
  assert.equal(policy.settledReasoningPreview, true);
  assert.equal(groupsStepsForTurn(policy, false), false);
  assert.equal(groupsStepsForTurn(policy, true), false);
});

test("an absent mode falls back to the standard policy", () => {
  assert.deepEqual(workStepDisplayPolicy(undefined), workStepDisplayPolicy("standard"));
});
