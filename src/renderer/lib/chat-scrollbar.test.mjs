import assert from "node:assert/strict";
import test from "node:test";

import { MIN_THUMB_HEIGHT, computeScrollbarThumb, scrollTopFromThumb, thumbTopFromPointer } from "./chat-scrollbar.ts";

test("a scrollport that fits paints no thumb", () => {
  assert.equal(computeScrollbarThumb({ trackHeight: 400, clientHeight: 400, scrollHeight: 400, scrollTop: 0 }), null);
  assert.equal(computeScrollbarThumb({ trackHeight: 0, clientHeight: 200, scrollHeight: 800, scrollTop: 0 }), null);
});

test("the thumb is proportional and tracks the scroll offset", () => {
  const base = { trackHeight: 400, clientHeight: 200, scrollHeight: 800 };
  const top = computeScrollbarThumb({ ...base, scrollTop: 0 });
  assert.deepEqual(top, { thumbHeight: 100, thumbTop: 0, maxScroll: 600 });

  const middle = computeScrollbarThumb({ ...base, scrollTop: 300 });
  assert.equal(middle.thumbHeight, 100);
  assert.equal(middle.thumbTop, 150);

  const bottom = computeScrollbarThumb({ ...base, scrollTop: 600 });
  assert.equal(bottom.thumbTop, 300, "the thumb ends at the track's floor");
  assert.equal(bottom.thumbTop + bottom.thumbHeight, 400);
});

test("a very tall transcript keeps a grabbable minimum thumb", () => {
  const thumb = computeScrollbarThumb({ trackHeight: 300, clientHeight: 200, scrollHeight: 20_000, scrollTop: 0 });
  assert.equal(thumb.thumbHeight, MIN_THUMB_HEIGHT);
});

test("pointer motion and thumb offsets clamp and round-trip", () => {
  assert.equal(thumbTopFromPointer({ pointerY: 130, thumbHeight: 100, trackHeight: 400 }), 80);
  assert.equal(thumbTopFromPointer({ pointerY: 0, thumbHeight: 100, trackHeight: 400 }), 0);
  assert.equal(thumbTopFromPointer({ pointerY: 400, thumbHeight: 100, trackHeight: 400 }), 300);

  assert.equal(scrollTopFromThumb({ thumbTop: 150, thumbHeight: 100, trackHeight: 400, maxScroll: 600 }), 300);
  assert.equal(scrollTopFromThumb({ thumbTop: 999, thumbHeight: 100, trackHeight: 400, maxScroll: 600 }), 600);
});
