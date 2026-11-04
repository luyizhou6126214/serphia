import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { ComposerToolbar, toolbarRenders } = await importTestBundle("composer-toolbar", {
  mainFields: ["module", "main"],
  stdin: {
    contents: 'export { ComposerToolbar } from "./ComposerToolbar.tsx"; export { toolbarRenders } from "@/i18n";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "toolbar-environment",
      setup(build) {
        build.onResolve({ filter: /^(?:react-dom|@\/i18n)$/ }, ({ path }) => ({ path, namespace: "toolbar-test" }));
        build.onLoad({ filter: /.*/, namespace: "toolbar-test" }, ({ path }) => ({
          contents:
            path === "react-dom"
              ? "export const createPortal = (children) => children;"
              : "export const toolbarRenders={count:0}; const t=(_key,fallback)=>fallback; export const useI18n=()=>{toolbarRenders.count++;return {t};};",
        }));
      },
    },
  ],
});
const text = (node) => (typeof node === "string" ? node : (node?.children?.map(text).join("") ?? ""));
async function mount(t) {
  const saved = new Map(
    ["window", "document", "ResizeObserver", "requestAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const documentListeners = new Map(),
    windowListeners = new Map(),
    focused = [],
    observers = [],
    actions = [];
  function surface(listeners) {
    return {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
    };
  }
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    document: { ...surface(documentListeners), body: {} },
    window: { ...surface(windowListeners), innerHeight: 800, innerWidth: 1200, visualViewport: null },
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    ResizeObserver: class {
      constructor() {
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  let renderer;
  let options = {
    isStreaming: false,
    model: { provider: "first", modelId: "same-id" },
    modelList: [
      { provider: "first", id: "same-id", name: "Chosen model" },
      { provider: "second", id: "same-id", name: "Other model" },
    ],
    thinkingLevel: "off",
    availableThinkingLevels: ["off", "high"],
    toolPreset: "default",
    onModelChange: (...args) => actions.push(["model", ...args]),
    onModelsRefresh: () => actions.push(["refresh"]),
    onModelsRefreshCancel: () => actions.push(["cancel-refresh"]),
    onThinkingLevelChange: (level) => actions.push(["thinking", level]),
    onToolPresetChange: (preset) => actions.push(["permission", preset]),
    onAbort: () => actions.push(["stop"]),
  };
  const onAttach = () => actions.push(["attach"]);
  const element = () =>
    createElement(ComposerToolbar, {
      options,
      isMobile: false,
      hasAttachments: false,
      onAttach,
    });
  const unmount = async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
  };
  t.after(async () => {
    await unmount();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => {
    renderer = create(element(), {
      createNodeMock: (element) => ({
        contains: (target) => element.props.role === "menu" && target?.insideMenu === true,
        parentElement: {},
        getBoundingClientRect: () => ({ top: 500, bottom: 532, left: 200, width: 180 }),
        focus: () => focused.push(element.props["aria-label"] ?? element.type),
      }),
    });
  });
  return {
    actions,
    focused,
    observers,
    documentListeners,
    windowListeners,
    unmount,
    get root() {
      return renderer.root;
    },
    async update(patch) {
      options = { ...options, ...patch };
      await act(async () => renderer.update(element()));
    },
    async clickLabel(label) {
      const button = renderer.root.find(
        (node) => node.type === "button" && node.props["aria-label"]?.startsWith(label),
      );
      await act(async () => button.props.onClick());
    },
    async clickText(label) {
      const button = renderer.root.find((node) => node.type === "button" && text(node) === label);
      await act(async () => button.props.onClick());
    },
    async resize(width, height) {
      globalThis.window.innerWidth = width;
      globalThis.window.innerHeight = height;
      await act(async () => {
        for (const listener of [...(windowListeners.get("resize") ?? [])]) listener();
      });
    },
    async dispatch(type, event) {
      await act(async () => {
        for (const listener of [...(documentListeners.get(type) ?? [])]) listener(event);
      });
    },
  };
}

test("the permission menu contains presets and errors without shell configuration controls", async (t) => {
  const f = await mount(t);
  await f.update({
    toolSelectionError: "save failed",
  });
  await f.clickLabel("Change permission settings");
  assert.equal(f.root.findAllByType("input").length, 0);
  assert.doesNotMatch(text(f.root), /PowerShell|Bash/);
  assert.match(text(f.root), /save failed/);
});

test("choosing the displayed no-tools preset still sends a fresh revocation intent", async (t) => {
  const f = await mount(t);
  await f.update({ toolPreset: "none" });
  await f.clickLabel("Change permission settings");
  const selected = f.root.find(
    (node) => node.type === "button" && node.props.role === "menuitemradio" && node.props["aria-checked"] === true,
  );
  await act(async () => selected.props.onClick());
  assert.deepEqual(f.actions.at(-1), ["permission", "none"]);
});

test("model menus preserve provider identity, cancel an active refresh on close and release positioning observers", async (t) => {
  const f = await mount(t);
  await f.clickLabel("Model and reasoning:");
  await f.clickText("Other model");
  assert.deepEqual(f.actions, [["model", "second", "same-id"]]);
  await f.clickLabel("Model and reasoning:");
  await f.clickText("Refresh model directory");
  await f.update({ modelRefreshing: true });
  await f.dispatch("mousedown", { target: {} });
  assert.deepEqual(f.actions.slice(1), [["refresh"], ["cancel-refresh"]]);
  await f.dispatch("mousedown", { target: {} });
  assert.equal(f.actions.filter((action) => action[0] === "cancel-refresh").length, 1);
  assert.ok(f.observers.every((observer) => observer.disconnected));
  await f.unmount();
  for (const listeners of [...f.documentListeners.values(), ...f.windowListeners.values()])
    assert.equal(listeners.size, 0);
});

test("control menus are exclusive, restore focus on selection or Escape and close when streaming starts", async (t) => {
  const f = await mount(t);
  const menus = () => f.root.findAll((node) => node.props.role === "menu");
  await f.clickLabel("Model and reasoning:");
  assert.equal(menus().length, 1);
  await f.clickLabel("Change permission settings:");
  assert.deepEqual(
    menus().map((menu) => menu.props["aria-label"]),
    ["Change permission settings"],
  );
  const readOnly = f.root.find((node) => node.props.role === "menuitemradio" && text(node).startsWith("Read only"));
  await act(async () => readOnly.props.onClick());
  assert.deepEqual(f.actions, [["permission", "none"]]);
  assert.match(f.focused.at(-1), /^Change permission settings:/);
  await f.clickLabel("Model and reasoning:");
  let prevented = false,
    stopped = false;
  await f.dispatch("keydown", {
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(prevented && stopped, true);
  assert.equal(menus().length, 0);
  assert.match(f.focused.at(-1), /^Model and reasoning:/);
  await f.clickLabel("Model and reasoning:");
  await f.update({ isStreaming: true });
  assert.equal(menus().length, 0);
  assert.equal(
    f.root.find((node) => node.type === "button" && node.props["aria-label"]?.startsWith("Model and reasoning:")).props
      .disabled,
    true,
  );
  await f.clickText("Stop");
  assert.deepEqual(f.actions.at(-1), ["stop"]);
});

test("equivalent toolbar options skip rendering without hiding real control changes", async (t) => {
  const fixture = await mount(t);
  const before = toolbarRenders.count;
  await fixture.update({});
  assert.equal(toolbarRenders.count, before);
  await fixture.update({ thinkingLevel: "high" });
  assert.equal(toolbarRenders.count, before + 1);
});

test("the reasoning range selects only supported levels, including max independently of xhigh", async (t) => {
  const f = await mount(t);
  await f.update({ availableThinkingLevels: ["off", "xhigh", "max"], thinkingLevel: "xhigh" });
  await f.clickLabel("Model and reasoning:");
  const range = () => f.root.findByProps({ type: "range" });
  assert.equal(range().props.value, 2);
  assert.equal(range().props.max, 3);
  assert.equal(range().props["aria-valuetext"], "Extra high");
  await act(async () => range().props.onChange({ currentTarget: { value: "3" } }));
  assert.deepEqual(f.actions.at(-1), ["thinking", "max"]);
  await f.update({ thinkingLevel: "max" });
  assert.equal(range().props["aria-valuetext"], "Maximum");
  assert.equal(range().props.value, 3);
  await f.update({ availableThinkingLevels: ["off", "high"], thinkingLevel: "high" });
  assert.equal(range().props.max, 2);
  assert.equal(range().props["aria-valuetext"], "High");
  const count = f.actions.length;
  await act(async () => range().props.onChange({ currentTarget: { value: "3" } }));
  assert.equal(f.actions.length, count, "a removed level cannot be submitted");
  await act(async () => range().props.onChange({ currentTarget: { value: "0" } }));
  assert.deepEqual(f.actions.at(-1), ["thinking", "auto"]);
});

test("the reasoning range preserves mapped provider values without submitting them as Pi levels", async (t) => {
  const f = await mount(t);
  await f.update({
    availableThinkingLevels: ["off", "minimal", "low", "medium", "high"],
    thinkingLevel: "minimal",
    thinkingLevelMap: { minimal: "max" },
  });
  await f.clickLabel("Model and reasoning:");
  const range = () => f.root.findByProps({ type: "range" });
  assert.equal(range().props["aria-valuetext"], "Minimal → max");
  assert.equal(range().props.title, "Provider value: max");
  await f.update({ thinkingLevel: "high" });
  await act(async () => range().props.onChange({ currentTarget: { value: "2" } }));
  assert.deepEqual(f.actions.at(-1), ["thinking", "minimal"]);
  let prevented = false;
  const menu = f.root.findByProps({ role: "menu" });
  menu.props.onKeyDown({
    key: "Home",
    target: { matches: () => true },
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false, "the menu must leave native range keyboard controls intact");
});

test("portaled control menus stay open for internal clicks and fit a resized viewport", async (t) => {
  const f = await mount(t);
  await f.clickLabel("Model and reasoning:");
  await f.dispatch("mousedown", { target: { insideMenu: true } });
  assert.equal(f.root.findAll((node) => node.props.role === "menu").length, 1);
  await f.resize(375, 600);
  const menu = f.root.find((node) => node.props.role === "menu");
  assert.equal(menu.props.tabIndex, -1);
  assert.ok(menu.props.style.left >= 8);
  assert.ok(menu.props.style.left + menu.props.style.width <= 367);
  await f.clickLabel("Change permission settings:");
  await f.clickLabel("Model and reasoning:");
  assert.deepEqual(
    f.root.findAll((node) => node.props.role === "menu").map((node) => node.props["aria-label"]),
    ["Model and reasoning"],
  );
  await f.dispatch("mousedown", { target: {} });
  assert.equal(f.root.findAll((node) => node.props.role === "menu").length, 0);
});

test("the composer keeps attachment and permission controls on the left and a model/reasoning value on the right", async (t) => {
  const f = await mount(t);
  const left = f.root.findByProps({ className: "composer-toolbar-primary" });
  const right = f.root.findByProps({ className: "composer-toolbar-settings" });
  assert.equal(left.findAllByType("button").length, 2, "only attachment and permission controls remain");
  assert.equal(right.findAllByProps({ className: "composer-toolbar-model" }).length, 1);
  assert.equal(text(right.findByProps({ className: "composer-model-effort" })), "Off");
  await f.update({ thinkingLevel: "high" });
  assert.equal(text(right.findByProps({ className: "composer-model-effort" })), "High");
  assert.equal(left.findAllByProps({ className: "composer-toolbar-model" }).length, 0);
  await f.clickLabel("Model and reasoning:");
  assert.ok(f.root.findByProps({ role: "group", "aria-label": "Models" }));
  assert.ok(f.root.findByProps({ type: "range" }));
  await f.clickLabel("Model and reasoning:");
  assert.equal(f.root.findAllByProps({ role: "menu" }).length, 0);
});
