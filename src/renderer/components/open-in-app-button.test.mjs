import assert from "node:assert/strict";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => {
  delete globalThis.window;
  if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

const { OpenInAppButton, OpenInAppMenu, resetOpenInAppApplications } = await importTestBundle("open-in-app-button", {
  stdin: {
    contents: 'export { OpenInAppButton, OpenInAppMenu, resetOpenInAppApplications } from "./OpenInAppButton.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "open-in-app-button-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  // Resolve dependencies through their ESM entry so the externalized React
  // import stays an ESM import instead of a CJS require.
  mainFields: ["module", "main"],
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "open-in-app-test-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "@/i18n", namespace: "open-in-app-test" }));
        build.onLoad({ filter: /.*/, namespace: "open-in-app-test" }, () => ({
          contents: 'const t = (_key, fallback) => fallback; export const useI18n = () => ({ t, language: "en" });',
        }));
      },
    },
  ],
});

beforeEach(() => resetOpenInAppApplications());

const APPLICATIONS = [
  { id: "vscode", icon: "data:image/png;base64,vscode" },
  { id: "cursor", icon: null },
  { id: "explorer", icon: null },
];

/** Install the preload bridge and storage surface the component reads. */
function installBridge({ applications = APPLICATIONS, open = async () => ({ ok: true }), choice = null } = {}) {
  const calls = { listed: 0, opened: [] };
  const stored = new Map(choice === null ? [] : [["pi-desktop:open-in-app-app", choice]]);
  globalThis.window = {
    piBridge: {
      listOpenInApps: async () => {
        calls.listed += 1;
        return applications;
      },
      openInApp: async (appId, directory) => {
        calls.opened.push([appId, directory]);
        return open(appId, directory);
      },
    },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
  };
  return { calls, stored };
}

/** Mount one component and flush its availability effect. */
async function mount(element) {
  let root;
  await act(async () => {
    root = create(element);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

function nodes(root, predicate) {
  return root.root.findAll(predicate, { deep: true });
}

function mainButton(root) {
  return nodes(root, (node) => node.type === "button" && node.props.className === "open-in-app-main")[0];
}

test("no workspace directory means no control", async () => {
  installBridge();
  const root = await mount(createElement(OpenInAppButton, { directory: null }));
  assert.equal(root.toJSON(), null);
});

test("the header control opens the remembered application and remembers a new pick", async () => {
  const bridge = installBridge({ choice: "cursor" });
  const root = await mount(createElement(OpenInAppButton, { directory: "C:/work/project" }));

  assert.equal(bridge.calls.listed, 1);
  const main = mainButton(root);
  assert.equal(main.props["aria-label"], "Open in Cursor");
  assert.equal(main.props.title, "Open in Cursor");

  await act(async () => main.props.onClick());
  assert.deepEqual(bridge.calls.opened, [["cursor", "C:/work/project"]]);
  assert.equal(bridge.stored.get("pi-desktop:open-in-app-app"), "cursor");

  // A repeatedly mounted header shares the single availability read.
  await mount(createElement(OpenInAppButton, { directory: "C:/work/project" }));
  assert.equal(bridge.calls.listed, 1);
});

test("an uninstalled remembered application falls back to the first entry", async () => {
  const bridge = installBridge({ choice: "zed" });
  const root = await mount(createElement(OpenInAppButton, { directory: "C:/work/project" }));
  assert.equal(mainButton(root).props["aria-label"], "Open in VS Code");
  await act(async () => mainButton(root).props.onClick());
  assert.deepEqual(bridge.calls.opened, [["vscode", "C:/work/project"]]);
});

test("a refused launch announces the failure instead of remembering the choice", async () => {
  const bridge = installBridge({ open: async () => ({ ok: false, code: "LAUNCH_FAILED" }) });
  const root = await mount(createElement(OpenInAppButton, { directory: "C:/work/project" }));
  await act(async () => mainButton(root).props.onClick());

  assert.equal(nodes(root, (node) => node.props.role === "status").length, 1);
  assert.equal(mainButton(root).props["aria-label"], "Could not open the project in that application.");
  assert.equal(bridge.stored.has("pi-desktop:open-in-app-app"), false);
});

test("the application menu marks the current choice and reports the picked one", async () => {
  const picked = [];
  const root = await mount(
    createElement(OpenInAppMenu, {
      applications: [
        { id: "vscode", name: "VS Code", icon: null },
        { id: "cursor", name: "Cursor", icon: null },
      ],
      preferredId: "cursor",
      onSelect: (application) => picked.push(application.id),
      onEscape: () => {},
    }),
  );
  const items = nodes(root, (node) => node.type === "button");
  assert.deepEqual(
    items.map((item) => item.props["aria-checked"]),
    [false, true],
  );
  assert.deepEqual(
    items.map((item) => item.findAllByType("span")[1].children.join("")),
    ["VS Code", "Cursor (default)"],
  );
  await act(async () => items[0].props.onClick());
  assert.deepEqual(picked, ["vscode"]);
});
