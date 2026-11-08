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

/** Install the browser surface the rail depends on and expose its frames. */
function harness(t, overrides = {}) {
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
    ...overrides.scrollEl,
  };
  const scroller = {
    scrollTop: 0,
    clientHeight: 60,
    scrollHeight: 60,
    ...overrides.scroller,
  };
  const flush = async () => {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    });
  };
  const mount = async (props) => {
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ChatMinimap, {
          messages: props.messages,
          streamingMessage: props.streamingMessage ?? null,
          scrollContainer: { current: scrollEl },
          messageRefs: { current: props.tops.map((top) => ({ getBoundingClientRect: () => ({ top }) })) },
        }),
        {
          createNodeMock: (element) =>
            typeof element.props.className === "string" && element.props.className.includes("chat-timeline-scroller")
              ? scroller
              : null,
        },
      );
    });
    await flush();
    return {
      renderer,
      dom: { scrollEl, scroller, jumps, frames, listeners, observers },
      get reduced() {
        return reduced;
      },
      setReduced: (value) => {
        reduced = value;
      },
      flush,
    };
  };
  return { mount, scrollEl, scroller, jumps, frames, listeners, observers };
}

const TURNS = [
  { role: "user", preview: "First question", hasText: true },
  { role: "assistant", preview: "First answer", hasText: true },
  { role: "user", preview: "Next question", hasText: true },
  { role: "assistant", preview: "Second answer", hasText: true },
];

test("one mark per turn: clicking jumps, the active turn is marked, and the preview pairs prompt and answer", async (t) => {
  const { mount } = harness(t);
  const fixture = await mount({ messages: TURNS, tops: [0, 300, 750, 900] });
  try {
    const buttons = fixture.renderer.root.findAllByType("button");
    assert.equal(buttons.length, 2, "a prompt and its answer share one mark");
    assert.match(buttons[1].props["aria-label"], /You: Next question\. Serphia: Second answer/);
    assert.equal(buttons[0].props["data-active"], true);
    assert.equal(buttons[0].props["aria-current"], "true");
    assert.equal(buttons[1].props["data-active"], false);

    const marks = fixture.renderer.root.findAll(
      (node) => node.type === "button" && node.props.className === "chat-timeline-node",
    );
    assert.equal(marks.length, 2);
    assert.equal(marks[0].props.style.top, 6);
    assert.equal(marks[1].props.style.top, 16, "the ladder keeps the DSH 10px pitch");

    await act(async () => buttons[1].props.onClick());
    assert.deepEqual(fixture.dom.jumps.at(-1), { top: 726, behavior: "smooth" });
    fixture.setReduced(true);
    await act(async () => buttons[0].props.onClick());
    assert.deepEqual(fixture.dom.jumps.at(-1), { top: 0, behavior: "instant" });

    await act(async () => buttons[0].props.onMouseEnter());
    const preview = fixture.renderer.root.find((node) => node.props.role === "tooltip");
    const previewText = (instance) =>
      instance.children.map((child) => (typeof child === "string" ? child : previewText(child))).join(" ");
    assert.match(previewText(preview), /First question/);
    assert.match(previewText(preview), /First answer/);
    await act(async () => buttons[0].props.onMouseLeave());
    assert.equal(fixture.renderer.root.findAll((node) => node.props.role === "tooltip").length, 0);

    // Reaching the very bottom activates the newest turn's mark.
    fixture.dom.scrollEl.scrollTop = 800;
    fixture.dom.listeners.get("scroll")();
    await fixture.flush();
    const activeMarks = fixture.renderer.root.findAll(
      (node) => node.type === "button" && node.props.className === "chat-timeline-node",
    );
    assert.equal(activeMarks[1].props["data-active"], true, "the bottom of the transcript highlights the last turn");
    assert.equal(activeMarks[0].props["data-active"], false);
  } finally {
    await act(async () => fixture.renderer.unmount());
  }
  assert.ok(fixture.dom.observers.every((observer) => observer.disconnected));
  assert.equal(fixture.dom.listeners.size, 0);
  assert.equal(fixture.dom.frames.size, 0);
});

test("the rail scrolls its active mark into the fade-free band", async (t) => {
  const users = Array.from({ length: 30 }, (_, index) => ({
    role: "user",
    preview: `Question ${index + 1}`,
    hasText: true,
  }));
  const scroller = { scrollTop: 0, clientHeight: 100, scrollHeight: 312 };
  const { mount } = harness(t, { scroller, scrollEl: { scrollTop: 8_800, scrollHeight: 9_200 } });
  const tops = users.map((_, index) => 20 - (users.length - 1 - index) * 300);
  const fixture = await mount({ messages: users, tops });
  try {
    const marks = fixture.renderer.root.findAll(
      (node) => node.type === "button" && node.props.className === "chat-timeline-node",
    );
    assert.equal(marks[marks.length - 1].props["data-active"], true, "the reader at the end activates the last turn");
    assert.equal(fixture.dom.scroller.scrollTop, 251, "the last mark centers inside the rail");
    assert.ok(
      fixture.dom.scroller.scrollTop + fixture.dom.scroller.clientHeight >= 6 + 29 * 10 + 10,
      "the last mark stays reachable",
    );
  } finally {
    await act(async () => fixture.renderer.unmount());
  }
});
