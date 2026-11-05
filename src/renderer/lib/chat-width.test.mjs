import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_WIDTH_STORAGE_KEY,
  clearChatWidthPreference,
  clampChatWidth,
  draggedChatWidth,
  readChatWidthPreference,
  writeChatWidthPreference,
} from "./chat-width.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("width preference rejects missing, zero, negative and non-numeric values", () => {
  assert.equal(readChatWidthPreference(memoryStorage()), null);
  assert.equal(readChatWidthPreference(memoryStorage({ [CHAT_WIDTH_STORAGE_KEY]: "0" })), null);
  assert.equal(readChatWidthPreference(memoryStorage({ [CHAT_WIDTH_STORAGE_KEY]: "-20" })), null);
  assert.equal(readChatWidthPreference(memoryStorage({ [CHAT_WIDTH_STORAGE_KEY]: "wide" })), null);
  assert.equal(readChatWidthPreference(memoryStorage({ [CHAT_WIDTH_STORAGE_KEY]: "812" })), 812);
});

test("write and clear persist a rounded width without touching other keys", () => {
  const storage = memoryStorage({ keep: "yes" });
  writeChatWidthPreference(811.6, storage);
  assert.equal(storage.getItem(CHAT_WIDTH_STORAGE_KEY), "812");
  clearChatWidthPreference(storage);
  assert.equal(storage.getItem(CHAT_WIDTH_STORAGE_KEY), null);
  assert.equal(storage.getItem("keep"), "yes");
});

test("clamp keeps the column inside the available chat width and readable floor", () => {
  assert.equal(clampChatWidth(900, 1200), 900);
  assert.equal(clampChatWidth(300, 1200), 560);
  assert.equal(clampChatWidth(2000, 1200), 1136);
  assert.equal(clampChatWidth(300, 500), 436);
  assert.equal(clampChatWidth(Number.NaN, 1200), 560);
});

test("both handles expand the centered column by twice their outward delta", () => {
  assert.equal(draggedChatWidth(760, 40, "right", 1200), 840);
  assert.equal(draggedChatWidth(760, -40, "left", 1200), 840);
  assert.equal(draggedChatWidth(760, -40, "right", 1200), 680);
  assert.equal(draggedChatWidth(760, 40, "left", 1200), 680);
  assert.equal(draggedChatWidth(760, 400, "right", 1200), 1136);
  assert.equal(draggedChatWidth(760, -400, "left", 1200), 1136);
});
