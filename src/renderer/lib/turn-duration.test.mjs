import assert from "node:assert/strict";
import test from "node:test";

import { formatTurnDuration } from "./turn-duration.ts";

test("turn durations use compact localized seconds, minutes and hours", () => {
  assert.equal(formatTurnDuration(undefined, "zh-CN"), null);
  assert.equal(formatTurnDuration(-1, "zh-CN"), null);
  assert.equal(formatTurnDuration(0, "zh-CN"), "1秒");
  assert.equal(formatTurnDuration(31_000, "zh-CN"), "31秒");
  assert.equal(formatTurnDuration(391_000, "zh-CN"), "6分31秒");
  assert.equal(formatTurnDuration(3_931_000, "zh-CN"), "1小时5分31秒");
  assert.equal(formatTurnDuration(31_000, "en-US"), "31s");
  assert.equal(formatTurnDuration(391_000, "en-US"), "6m 31s");
  assert.equal(formatTurnDuration(3_931_000, "en-US"), "1h 5m 31s");
});
