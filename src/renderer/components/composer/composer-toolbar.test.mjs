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
      name: "toolbar-dependencies",
      setup(build) {
        build.onResolve({ filter: /^(?:\.\/DeepAgentMenuScope|@\/i18n)$/ }, ({ path }) => ({
          path,
          namespace: "toolbar-test",
        }));
        build.onLoad({ filter: /.*/, namespace: "toolbar-test" }, ({ path }) => ({
          contents:
            path === "@/i18n"
              ? "export const toolbarRenders={count:0}; const t=(_key,fallback)=>fallback; export const useI18n=()=>{toolbarRenders.count++;return {t};};"
              : `
                const ApprovalMenu = () => null;
                const HoverInfo = ({ children }) => children;
                const ModelThinkingSelector = () => null;
                const parts = { ApprovalMenu, HoverInfo, ModelThinkingSelector };
                export const DeepAgentMenuScope = ({ children }) => children(parts);
              `,
        }));
      },
    },
  ],
});

async function mount(t) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const actions = [];
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
    onThinkingLevelChange: (level) => actions.push(["thinking", level]),
    onToolPresetChange: (preset) => actions.push(["permission", preset]),
    onAbort: () => actions.push(["stop"]),
  };
  const onAttach = () => actions.push(["attach"]);
  const element = () => createElement(ComposerToolbar, { options, isMobile: false, hasAttachments: false, onAttach });
  let renderer;
  await act(async () => {
    renderer = create(element());
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    if (saved) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved);
    else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const find = (kind) => renderer.root.find((node) => node.type?.name === kind);
  return {
    actions,
    get root() {
      return renderer.root;
    },
    get permission() {
      return find("ApprovalMenu").props;
    },
    get model() {
      return find("ModelThinkingSelector").props;
    },
    async update(patch) {
      options = { ...options, ...patch };
      await act(async () => renderer.update(element()));
    },
  };
}

test("permissions keep their tool presets, surface errors, and repeat revocation of a selected read-only preset", async (t) => {
  const fixture = await mount(t);
  await fixture.update({ toolSelectionError: "save failed", toolPreset: "none" });
  await act(async () => fixture.permission.onOpenChange(true));
  assert.equal(fixture.permission.error, "save failed");
  assert.deepEqual(
    fixture.permission.visibleOptions.map(({ id }) => id),
    ["none", "default", "full"],
  );
  assert.equal(fixture.permission.selectedApproval.id, "none");
  await act(async () => fixture.permission.chooseApproval(fixture.permission.selectedApproval));
  assert.deepEqual(fixture.actions, [["permission", "none"]]);
  assert.equal(fixture.permission.open, false);
});

test("the Plan label follows the permission control and closes independently", async (t) => {
  const fixture = await mount(t);
  const onExitPlanMode = async () => {
    fixture.actions.push(["exit plan"]);
    return true;
  };
  assert.equal(fixture.root.findAllByProps({ className: "composer-plan-mode" }).length, 0);
  await fixture.update({ planModeEnabled: true, onExitPlanMode });
  const primary = fixture.root.findByProps({ className: "composer-toolbar-primary" });
  assert.equal(primary.children.at(-1).props.className, "composer-plan-mode");
  assert.equal(primary.children.at(-2).type.name, "DeepAgentMenuScope");
  const close = () => fixture.root.findByProps({ className: "composer-plan-mode-close" }).props;
  assert.equal(close()["aria-label"], "Exit Plan mode");
  await act(async () => close().onClick());
  assert.deepEqual(fixture.actions, [["exit plan"]]);
  await fixture.update({ planModePending: true });
  assert.equal(close().disabled, true);
  await fixture.update({ planModePending: false, isStreaming: true });
  assert.equal(close().disabled, true);
});

test("choosing a model preserves provider identity and keeps the menu open", async (t) => {
  const fixture = await mount(t);
  await act(async () => fixture.model.onOpenChange(true));
  const [first, second] = fixture.model.models;
  assert.notEqual(first, second);
  assert.equal(fixture.model.selectedModel, first);
  assert.equal(fixture.model.getModelLabel(second), "Other model");
  assert.equal(fixture.model.getModelGroup(second), "second");
  await act(async () => fixture.model.onChooseModel(second));
  assert.deepEqual(fixture.actions, [["model", "second", "same-id"]]);
  assert.equal(fixture.model.open, true);
});

test("menus stay exclusive and a stale model close leaves the permission menu open", async (t) => {
  const fixture = await mount(t);
  await act(async () => fixture.model.onOpenChange(true));
  await act(async () => fixture.permission.onOpenChange(true));
  assert.equal(fixture.permission.open, true);
  assert.equal(fixture.model.open, false);
  await act(async () => fixture.model.onOpenChange(false));
  assert.equal(fixture.permission.open, true, "a stale close must not dismiss the other control");
  await fixture.update({ isStreaming: true });
  assert.equal(fixture.permission.open, false);
  assert.equal(fixture.permission.disabled, true);
  assert.equal(fixture.model.disabled, true);
  await act(async () => fixture.root.findByProps({ className: "chat-composer-stop" }).props.onClick());
  assert.deepEqual(fixture.actions.at(-1), ["stop"]);
});

test("reasoning exposes supported levels and keeps mapped labels distinct from the values submitted", async (t) => {
  const fixture = await mount(t);
  await fixture.update({
    availableThinkingLevels: ["off", "xhigh", "max"],
    thinkingLevel: "xhigh",
    thinkingLevelMap: { xhigh: "extended" },
  });
  assert.deepEqual(
    fixture.model.thinkingOptions.map(({ id }) => id),
    ["xhigh", "max"],
  );
  assert.equal(fixture.model.selectedThinking, "xhigh");
  assert.equal(fixture.model.thinkingOptions[0].label, "Extra high → extended");
  await act(async () => fixture.model.onChooseThinking("max"));
  assert.deepEqual(fixture.actions, [["thinking", "max"]]);
  await fixture.update({ availableThinkingLevels: ["off", "high"], thinkingLevel: "high" });
  await act(async () => fixture.model.onChooseThinking("max"));
  assert.equal(fixture.actions.length, 1);
  await act(async () => fixture.model.onChooseThinking("auto"));
  await act(async () => fixture.model.onChooseThinking("off"));
  assert.deepEqual(fixture.actions, [["thinking", "max"]]);
});

test("reasoning defaults to low and is hidden when the model has no reasoning levels", async (t) => {
  const fixture = await mount(t);
  await fixture.update({ availableThinkingLevels: ["off", "minimal", "low", "high"] });
  assert.equal(fixture.model.selectedThinking, "low");
  await fixture.update({ thinkingLevel: "auto", availableThinkingLevels: ["off", "medium", "high"] });
  assert.equal(fixture.model.selectedThinking, "medium");
  await fixture.update({ availableThinkingLevels: ["off"] });
  assert.equal(fixture.model.showThinking, false);
  assert.deepEqual(fixture.model.thinkingOptions, []);
});

test("equivalent options skip rendering, and model controls occupy the right side", async (t) => {
  const fixture = await mount(t);
  const before = toolbarRenders.count;
  await fixture.update({});
  assert.equal(toolbarRenders.count, before);
  await fixture.update({ thinkingLevel: "high", onCompact: () => {} });
  assert.equal(toolbarRenders.count, before + 1);
  const left = fixture.root.findByProps({ className: "composer-toolbar-primary" });
  const right = fixture.root.findByProps({ className: "composer-toolbar-settings" });
  assert.equal(left.findAll((node) => node.type?.name === "ApprovalMenu").length, 1);
  assert.equal(left.findAllByType("button").length, 1);
  const settings = right.findByProps({ className: "serphia-composer-model-controls" });
  assert.equal(settings.children[0].type.name, "HoverInfo");
  assert.equal(settings.children[0].props.content, "Compact context");
  const compactButton = settings.findByType("button");
  assert.equal(compactButton.props["aria-label"], "Compact context");
  assert.equal(compactButton.props.title, undefined);
  assert.equal(right.findAll((node) => node.type?.name === "ModelThinkingSelector").length, 1);
});
