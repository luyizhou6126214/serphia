import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => {
  if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

const { RightPanelStrip, RightPanelGuide, GUIDE_TAB_ID, FILES_TAB_ID } = await importTestBundle("right-panel-ui", {
  stdin: {
    contents: [
      'export { RightPanelStrip } from "./RightPanelStrip.tsx";',
      'export { RightPanelGuide } from "./RightPanelGuide.tsx";',
      'export { GUIDE_TAB_ID, FILES_TAB_ID } from "@/lib/right-panel-tabs";',
    ].join("\n"),
    resolveDir: import.meta.dirname,
    sourcefile: "right-panel-ui-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  mainFields: ["module", "main"],
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "right-panel-test-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "@/i18n", namespace: "right-panel-test" }));
        build.onLoad({ filter: /.*/, namespace: "right-panel-test" }, () => ({
          contents: 'const t = (_key, fallback) => fallback; export const useI18n = () => ({ t, language: "en" });',
        }));
      },
    },
  ],
});

const TABS = [
  { id: GUIDE_TAB_ID, kind: "guide", title: "" },
  { id: FILES_TAB_ID, kind: "files", title: "" },
  { id: "file:a.ts", kind: "file", title: "a.ts", filePath: "C:/work/a.ts" },
];

async function mount(element) {
  let root;
  await act(async () => {
    root = create(element);
  });
  return root;
}

test("the strip names each tab, closes only resource tabs, and drives the panel controls", async () => {
  const selected = [];
  const closed = [];
  let fullscreenToggled = 0;
  let collapsed = 0;
  const root = await mount(
    createElement(RightPanelStrip, {
      tabs: TABS,
      activeTabId: FILES_TAB_ID,
      fullscreen: false,
      onSelect: (id) => selected.push(id),
      onClose: (id) => closed.push(id),
      onToggleFullscreen: () => {
        fullscreenToggled += 1;
      },
      onCollapse: () => {
        collapsed += 1;
      },
    }),
  );

  const chips = root.root.findAll((node) => node.type === "div" && node.props.role === "tab");
  assert.deepEqual(
    chips.map((chip) =>
      chip
        .findAllByType("span")
        .find((span) => span.props.className === "rp-tab-title")
        .children.join(""),
    ),
    ["Start", "Files", "a.ts"],
  );
  assert.deepEqual(
    chips.map((chip) => chip.props["aria-selected"]),
    [false, true, false],
  );

  const closeButtons = root.root.findAll((node) => node.type === "button" && node.props.className === "rp-tab-close");
  assert.equal(closeButtons.length, 2, "the guide chip never offers a close");

  await act(async () => chips[0].props.onClick());
  await act(async () => closeButtons[0].props.onClick({ stopPropagation() {} }));
  assert.deepEqual(selected, [GUIDE_TAB_ID]);
  assert.deepEqual(closed, [FILES_TAB_ID]);

  const controls = root.root.findAll((node) => node.type === "button" && node.props.className === "rp-icon-button");
  assert.equal(controls[0].props["aria-pressed"], false);
  await act(async () => controls[0].props.onClick());
  await act(async () => controls[1].props.onClick());
  assert.equal(fullscreenToggled, 1);
  assert.equal(collapsed, 1);
});

test("a lone guide chip is a quiet label with no close", async () => {
  const root = await mount(
    createElement(RightPanelStrip, {
      tabs: [TABS[0]],
      activeTabId: GUIDE_TAB_ID,
      fullscreen: true,
      onSelect: () => {},
      onClose: () => {},
      onToggleFullscreen: () => {},
      onCollapse: () => {},
    }),
  );
  const chip = root.root.find((node) => node.type === "div" && node.props.role === "tab");
  assert.match(chip.props.className, /is-active/);
  assert.match(chip.props.className, /is-quiet/);
  assert.equal(
    root.root.findAll((node) => node.type === "button" && node.props.className === "rp-tab-close").length,
    0,
  );
  assert.equal(
    root.root.findAll((node) => node.type === "button" && node.props.className === "rp-icon-button")[0].props[
      "aria-pressed"
    ],
    true,
  );
});

test("the guide shows its entries with keycaps and opens the picked door", async () => {
  const picked = [];
  const entries = [
    {
      id: "workspace-files",
      title: "Workspace files",
      description: "Browse the Session workspace files",
      artwork: createElement("svg", { "data-art": "files" }),
      shortcut: ["Ctrl", "P"],
      onPick: () => picked.push("files"),
    },
    {
      id: "new-terminal",
      title: "New terminal",
      description: "Run commands in the Session workspace",
      artwork: createElement("svg", { "data-art": "terminal" }),
      shortcut: ["Ctrl", "Shift", "T"],
      onPick: () => picked.push("terminal"),
    },
  ];
  const root = await mount(createElement(RightPanelGuide, { entries, notice: "A terminal is not available." }));

  assert.equal(
    root.root.findAll((node) => node.props.role === "status")[0].children.join(""),
    "A terminal is not available.",
  );
  const capsules = root.root.findAll(
    (node) => node.type === "button" && node.props.className === "rp-guide-entry-main",
  );
  assert.equal(capsules.length, 2);
  assert.equal(capsules[0].props["aria-keyshortcuts"], "Ctrl+P");
  const keycaps = root.root.findAll((node) => node.type === "kbd");
  assert.deepEqual(
    keycaps.map((cap) => cap.children.join("")),
    ["Ctrl", "P", "Ctrl", "Shift", "T"],
  );
  await act(async () => capsules[1].props.onClick());
  assert.deepEqual(picked, ["terminal"]);
});

test("a capsule with a shell menu keeps its main door and exposes the menu trigger", async () => {
  const picked = [];
  const shells = [];
  const entries = [
    {
      id: "new-terminal",
      title: "New terminal",
      description: "Run commands in the Session workspace",
      artwork: createElement("svg", { "data-art": "terminal" }),
      menu: {
        label: "Choose shell",
        items: [
          { id: "/bin/zsh", label: "zsh" },
          { id: "/bin/bash", label: "bash" },
        ],
        selectedId: "/bin/zsh",
        onSelect: (id) => shells.push(id),
      },
      onPick: () => picked.push("default"),
    },
  ];
  const root = await mount(createElement(RightPanelGuide, { entries }));
  const main = root.root.find((node) => node.type === "button" && node.props.className === "rp-guide-entry-main");
  const trigger = root.root.find((node) => node.type === "button" && node.props.className === "rp-guide-entry-menu");
  assert.equal(trigger.props["aria-label"], "Choose shell");
  assert.equal(trigger.props["aria-expanded"], false);
  await act(async () => main.props.onClick());
  assert.deepEqual(picked, ["default"]);
  assert.deepEqual(shells, []);
});
