import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatWindowSource = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

function ruleSource(selector) {
  const start = cssSource.indexOf(`\n${selector} {`);
  const end = cssSource.indexOf("\n}", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return cssSource.slice(start, end);
}

const noticeItemStyle = ruleSource(".notice-shelf-item");
const noticeMessageStyle = ruleSource(".notice-shelf-message");

function keyframesSource(name, nextMarker) {
  const start = cssSource.indexOf(`@keyframes ${name}`);
  const end = cssSource.indexOf(nextMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return cssSource.slice(start, end);
}

test("multiline notices preserve explicit line breaks", () => {
  assert.match(noticeMessageStyle, /white-space:\s*pre-wrap/);
});

test("long unbroken notice text wraps instead of being truncated", () => {
  assert.match(noticeMessageStyle, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(noticeMessageStyle, /text-overflow:\s*ellipsis/);
});

test("single-line notices keep their baseline height without capping taller content", () => {
  assert.match(noticeItemStyle, /min-height:\s*42px/);
  assert.doesNotMatch(noticeItemStyle, /(?:^|\n)\s*(?:height|max-height):/);
});

test("chat notices share a centered shelf across welcome and conversation views", () => {
  assert.equal(chatWindowSource.match(/\{chatTopOverlays\}/g)?.length, 2);
  assert.match(chatWindowSource, /className="chat-top-overlays"[\s\S]*?<NoticeShelf notices=\{notices\} \/>/);
  assert.match(ruleSource(".notice-shelf"), /align-items:\s*center/);
  assert.match(ruleSource(".chat-top-overlays"), /position:\s*absolute/);
});

test("notice animations never restore a fixed height", () => {
  const animations = [
    keyframesSource("notice-shelf-in", "@keyframes notice-shelf-out"),
    keyframesSource("notice-shelf-out", "@media (prefers-reduced-motion: reduce)"),
  ];

  for (const animation of animations) {
    assert.doesNotMatch(animation, /(?:^|\n)\s*(?:height|min-height|max-height):/);
    assert.match(animation, /opacity:/);
    assert.match(animation, /transform:/);
  }
});
