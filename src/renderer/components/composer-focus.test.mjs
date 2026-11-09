import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const originals = {
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  navigator: globalThis.navigator,
  window: globalThis.window,
};

const storedValues = new Map();
const localStorageMock = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, String(value)),
  removeItem: (key) => storedValues.delete(key),
};
const documentMock = {
  addEventListener() {},
  removeEventListener() {},
  body: {},
  documentElement: { lang: "" },
};
const windowMock = {
  addEventListener() {},
  removeEventListener() {},
  innerHeight: 900,
  localStorage: localStorageMock,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  navigator: { language: "en-US" },
  piBridge: {
    getPathForFile: () => null,
    inspectLocalFiles: async ({ paths }) => paths.map((filePath) => ({ path: filePath, exists: true })),
  },
  visualViewport: null,
};

Object.defineProperties(globalThis, {
  document: { configurable: true, value: documentMock },
  localStorage: { configurable: true, value: localStorageMock },
  navigator: { configurable: true, value: windowMock.navigator },
  window: { configurable: true, value: windowMock },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ChatInput } = await importTestBundle("composer-focus", {
  mainFields: ["module", "main"],
  stdin: {
    contents: 'export { ChatInput } from "./ChatInput.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "composer-focus-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "composer-focus-api",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api", namespace: "focus-test" }));
        build.onLoad({ filter: /.*/, namespace: "focus-test" }, () => ({
          contents: "export const fileIndex = async () => ({ files: [], truncated: false });",
        }));
      },
    },
  ],
});

after(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function mount() {
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, { cwd: "/workspace/project", isStreaming: false, onAbort() {}, onSend() {} }),
    );
  });
  const card = () => renderer.root.find((node) => node.props.className === "chat-composer-card");
  const hasClass = (node, className) =>
    String(node.props.className ?? "")
      .split(/\s+/)
      .includes(className);
  const layers = (className) =>
    renderer.root.findAll((node) => hasClass(node, className) && node.props["aria-hidden"] === "true");
  return { renderer, card, layers };
}

test("the composer paints its focus layers outside the hit-testing path", async () => {
  const { renderer, layers } = await mount();
  assert.equal(layers("chat-composer-aura").length, 1);
  assert.equal(layers("chat-composer-ring").length, 1);
  assert.equal(layers("chat-composer-ripple").length, 2);
  await act(async () => renderer.unmount());
});

test("focus lights the composer while it stays inside the card", async () => {
  const { renderer, card } = await mount();
  assert.equal(card().props["data-focused"], undefined, "a fresh composer is not lit");

  await act(async () => card().props.onFocus());
  assert.equal(card().props["data-focused"], true);

  // Moving between the textarea and the toolbar keeps focus inside the card.
  await act(async () => card().props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} }));
  assert.equal(card().props["data-focused"], true, "focus that stays inside the card keeps it lit");

  await act(async () => card().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }));
  assert.equal(card().props["data-focused"], undefined, "focus leaving the card releases it");
  await act(async () => renderer.unmount());
});
