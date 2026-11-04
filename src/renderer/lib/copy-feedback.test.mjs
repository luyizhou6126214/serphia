import assert from "node:assert/strict";
import test from "node:test";

import { CopyFeedbackTimer, performCopyWithFeedback } from "./copy-feedback.ts";

function fixture() {
  let nextId = 0;
  const callbacks = new Map();
  const cancelled = [];
  const timer = new CopyFeedbackTimer(
    (callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    (id) => {
      cancelled.push(id);
      callbacks.delete(id);
    },
  );
  return { timer, callbacks, cancelled };
}

test("successful repeated copies replace the timer and disposal clears the last timer", async () => {
  const value = fixture();
  const states = [];
  const write = async () => {};

  assert.equal(await performCopyWithFeedback("one", write, value.timer, (state) => states.push(state), 1_500), true);
  assert.equal(await performCopyWithFeedback("two", write, value.timer, (state) => states.push(state), 1_500), true);
  assert.deepEqual(states, [true, true]);
  assert.deepEqual(value.cancelled, [1]);
  assert.deepEqual([...value.callbacks.keys()], [2]);

  value.timer.dispose();
  assert.deepEqual(value.cancelled, [1, 2]);
  assert.equal(value.callbacks.size, 0);
});

test("clipboard rejection clears feedback and does not schedule copied state", async () => {
  const value = fixture();
  const states = [];
  const result = await performCopyWithFeedback(
    "secret",
    async () => {
      throw new Error("clipboard denied");
    },
    value.timer,
    (state) => states.push(state),
    1_500,
  );

  assert.equal(result, false);
  assert.deepEqual(states, [false]);
  assert.equal(value.callbacks.size, 0);
});

test("default timer callbacks do not bind browser timer APIs to the feedback instance", async (t) => {
  let callback, cancelled;
  t.mock.method(globalThis, "setTimeout", function (fn, delay) {
    assert.ok(this === undefined || this === globalThis, "Window timers reject a feedback instance as their receiver");
    assert.equal(delay, 1500);
    callback = fn;
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", function (handle) {
    assert.ok(this === undefined || this === globalThis);
    cancelled = handle;
  });
  const timer = new CopyFeedbackTimer();
  const states = [];
  await performCopyWithFeedback(
    "fixture",
    async () => {},
    timer,
    (value) => states.push(value),
    1500,
  );
  assert.deepEqual(states, [true]);
  callback();
  assert.deepEqual(states, [true, false]);
  timer.restart(() => {}, 1500);
  timer.dispose();
  assert.equal(cancelled, 1);
});
