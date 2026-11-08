import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ChatScrollbar } = await importTestBundle("chat-scrollbar-ui", {
  entryPoints: [path.join(import.meta.dirname, "ChatScrollbar.tsx")],
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "chat-scrollbar-i18n",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "scrollbar-test" }));
        build.onLoad({ filter: /.*/, namespace: "scrollbar-test" }, () => ({
          contents: "export const useI18n=()=>({language:'en',t:(_key,fallback)=>fallback??_key});",
        }));
      },
    },
  ],
});

/** Mock scrollport pieces the bar measures. */
function fixture({ scrollHeight = 1200, clientHeight = 400 } = {}) {
  const frames = new Map();
  let sequence = 0;
  const listeners = new Map();
  const scroller = {
    clientHeight,
    scrollHeight,
    scrollTop: 0,
    firstElementChild: {},
    getBoundingClientRect: () => ({ top: 100, bottom: 900 }),
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    scrollBy: ({ top }) => {
      scroller.scrollTop += top;
    },
  };
  const previous = {
    raf: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    caf: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
    ro: Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
  };
  Object.assign(globalThis, {
    requestAnimationFrame: (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return {
    refs: {
      rootRef: { current: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) } },
      scrollContainer: { current: scroller },
      composerRef: { current: { getBoundingClientRect: () => ({ top: 720, bottom: 800 }) } },
    },
    scroller,
    listeners,
    frames,
    async flush() {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback());
      });
    },
    restore() {
      for (const [key, descriptor] of Object.entries(previous)) {
        const name =
          key === "raf" ? "requestAnimationFrame" : key === "caf" ? "cancelAnimationFrame" : "ResizeObserver";
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test("no bar while the transcript fits", async (t) => {
  const box = fixture({ scrollHeight: 400, clientHeight: 400 });
  t.after(() => box.restore());
  let renderer;
  await act(async () => {
    renderer = create(createElement(ChatScrollbar, { ...box.refs, visible: true }));
  });
  await box.flush();
  assert.equal(renderer.root.findAll((node) => node.props.className === "chat-scrollbar").length, 0);
  await act(async () => renderer.unmount());
});

test("the bar spans the column and mirrors the scroll offset", async (t) => {
  const box = fixture();
  t.after(() => box.restore());
  let renderer;
  await act(async () => {
    renderer = create(createElement(ChatScrollbar, { ...box.refs, visible: true }));
  });
  await box.flush();

  const bar = renderer.root.find((node) => node.props.className === "chat-scrollbar");
  assert.equal(bar.props.style.top, 100, "starts at the transcript's top");
  assert.equal(bar.props.style.height, 700, "ends at the composer's bottom");
  const thumb = () => renderer.root.find((node) => node.props.className === "chat-scrollbar-thumb").props.style;
  const start = thumb();
  assert.ok(Math.abs(start.height - (700 * 400) / 1200) < 1);
  assert.equal(start.top, 0);

  box.scroller.scrollTop = 400;
  await act(async () => box.listeners.get("scroll")());
  await box.flush();
  const midway = thumb();
  assert.ok(Math.abs(midway.top - (400 / 800) * (700 - midway.height)) < 1, "halfway scroll lands the thumb midway");

  box.scroller.scrollTop = 800;
  await act(async () => box.listeners.get("scroll")());
  await box.flush();
  const end = thumb();
  assert.ok(Math.abs(end.top + end.height - 700) < 1, "the thumb reaches the composer edge at the bottom");
  await act(async () => renderer.unmount());
});

test("hidden when the chat view is not active", async (t) => {
  const box = fixture();
  t.after(() => box.restore());
  let renderer;
  await act(async () => {
    renderer = create(createElement(ChatScrollbar, { ...box.refs, visible: false }));
  });
  await box.flush();
  assert.equal(renderer.root.findAll((node) => node.props.className === "chat-scrollbar").length, 0);
  await act(async () => renderer.unmount());
});
