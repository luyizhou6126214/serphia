import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { ChatMinimap } = await importTestBundle("chat-minimap", {
  entryPoints: [path.join(import.meta.dirname, "ChatMinimap.tsx")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "timeline-i18n",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "timeline-test" }));
        build.onLoad({ filter: /.*/, namespace: "timeline-test" }, () => ({
          contents: "export const useI18n=()=>({t:(_key,fallback)=>fallback});",
        }));
      },
    },
  ],
});

test("timeline jumps to the selected turn, respects reduced motion, scrubs and releases observers", async (t) => {
  const globals = [
    "window",
    "ResizeObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const frames = new Map(),
    listeners = new Map(),
    jumps = [],
    observers = [];
  let frameId = 0,
    reduced = false;
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: { matchMedia: () => ({ matches: reduced }) },
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  const scrollEl = {
    scrollHeight: 1000,
    clientHeight: 200,
    scrollTop: 0,
    firstElementChild: {},
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    scrollTo: (options) => jumps.push(options),
  };
  const track = { getBoundingClientRect: () => ({ top: 20, height: 300 }), setPointerCapture() {} };
  const messages = [
    { role: "user", preview: "First question", hasText: true },
    { role: "assistant", preview: "Answer", hasText: true },
    { role: "user", preview: "Next question", hasText: true },
  ];
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatMinimap, {
        messages,
        streamingMessage: null,
        scrollContainer: { current: scrollEl },
        messageRefs: { current: [0, 300, 750].map((top) => ({ getBoundingClientRect: () => ({ top }) })) },
      }),
      { createNodeMock: (element) => (element.props.className === "chat-timeline-track" ? track : null) },
    );
  });
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  try {
    await act(async () => flush());
    const buttons = renderer.root.findAllByType("button");
    assert.equal(buttons.length, 3);
    assert.match(buttons[2].props["aria-label"], /You: Next question/);
    await act(async () => buttons[2].props.onClick());
    assert.deepEqual(jumps.at(-1), { top: 726, behavior: "smooth" });
    reduced = true;
    await act(async () => buttons[0].props.onClick());
    assert.deepEqual(jumps.at(-1), { top: 0, behavior: "instant" });
    const timeline = renderer.root.findByProps({ className: "chat-timeline-track" });
    await act(async () =>
      timeline.props.onPointerDown({
        button: 0,
        pointerId: 1,
        clientY: 170,
        currentTarget: track,
        target: { closest: () => null },
      }),
    );
    assert.equal(scrollEl.scrollTop, 400);
    await act(async () => timeline.props.onPointerMove({ pointerId: 1, clientY: 320 }));
    assert.equal(scrollEl.scrollTop, 800);
    await act(async () => timeline.props.onPointerUp());
    timeline.props.onPointerMove({ pointerId: 1, clientY: 20 });
    assert.equal(scrollEl.scrollTop, 800, "pointer release stops scrubbing");
  } finally {
    await act(async () => renderer.unmount());
  }
  assert.ok(observers.every((observer) => observer.disconnected));
  assert.equal(listeners.size, 0);
  assert.equal(frames.size, 0);
});
