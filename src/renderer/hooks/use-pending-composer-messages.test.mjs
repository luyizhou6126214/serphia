import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { usePendingComposerMessages } = await importTestBundle("pending-composer", {
  stdin: {
    contents: 'export { usePendingComposerMessages } from "./usePendingComposerMessages.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  external: ["react", "react/jsx-runtime"],
});

test("staged messages stay with their session across switches and remounts", async (t) => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  let pending;
  function Harness({ session }) {
    pending = usePendingComposerMessages(session);
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = create(createElement(Harness, { session: "session-one" }));
  });
  await act(async () => pending.update("session-one", () => [{ id: "1", text: "first", files: [] }]));
  await act(async () => renderer.update(createElement(Harness, { session: "session-two" })));
  assert.deepEqual(pending.messages, []);
  await act(async () => pending.update("session-two", () => [{ id: "2", text: "second", files: [] }]));
  // A late completion for the old session must not remove the new session's message.
  await act(async () => pending.update("session-one", () => []));
  assert.equal(pending.messages[0].text, "second");
  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = create(createElement(Harness, { session: "session-two" }));
  });
  assert.equal(pending.messages[0].text, "second");
  assert.equal(JSON.parse(storage.get("serphia:pending-composer:session-two"))[0].text, "second");
  await act(async () => renderer.unmount());
});
