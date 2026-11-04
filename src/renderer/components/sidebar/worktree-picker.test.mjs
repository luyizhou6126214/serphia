import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { WorktreePicker, SessionSidebar, api } = await importTestBundle("composer-workspace", {
  mainFields: ["module", "main"],
  stdin: {
    contents:
      'export { WorktreePicker } from "./WorktreePicker.tsx"; export { SessionSidebar } from "../SessionSidebar.tsx"; export { api } from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "workspace-environment",
      setup(build) {
        build.onResolve({ filter: /^(?:react-dom|@\/i18n|@\/lib\/api-client)$/ }, ({ path }) => ({
          path,
          namespace: "workspace-test",
        }));
        build.onLoad({ filter: /.*/, namespace: "workspace-test" }, ({ path }) => ({
          contents:
            path === "react-dom"
              ? "export const createPortal = children => children;"
              : path === "@/i18n"
                ? 'const t=(_key,fallback)=>fallback; export const useI18n=()=>({t,language:"en-US"});'
                : "export const api={calls:[],handler:async()=>({})};export const call=async(method,params)=>{api.calls.push([method,params]);return api.handler(method,params);};export const subscribeRunning=async()=>()=>{};",
        }));
      },
    },
  ],
});
const text = (node) => (typeof node === "string" ? node : (node?.children?.map(text).join("") ?? ""));
const main = "/projects/app",
  feature = "/projects/app-worktrees/feature";
async function mount(t, overrides = {}) {
  const globals = ["document", "window", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const events = [];
  const surface = { addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    document: { ...surface, body: {}, activeElement: null },
    window: { ...surface, innerWidth: 1200, innerHeight: 800, localStorage: { getItem: () => null, setItem() {} } },
  });
  api.calls = [];
  api.handler = async () => ({});
  let options = {
    selectedCwd: main,
    selectedProject: main,
    homeDir: "/home/demo",
    worktreeLoadingCwd: null,
    worktreeState: {
      forCwd: main,
      projectRoot: main,
      isGit: true,
      isTopLevel: true,
      worktrees: [
        { path: main, branch: "main", isMain: true },
        { path: feature, branch: "feature", isMain: false },
      ],
    },
    setSelectedCwd: (cwd) => events.push(["select", cwd]),
    onCreated: (...args) => events.push(["created", ...args]),
    onRefresh: () => events.push(["refresh"]),
    ...overrides,
  };
  let renderer;
  await act(async () => {
    renderer = create(createElement(WorktreePicker, options), {
      createNodeMock: () => ({
        focus() {},
        contains: () => false,
        getBoundingClientRect: () => ({ left: 320, top: 720 }),
        querySelectorAll: () => [],
      }),
    });
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const buttons = () => renderer.root.findAllByType("button");
  const button = (label) => buttons().find((node) => text(node) === label);
  const open = async () =>
    act(async () =>
      buttons()
        .find((node) => node.props["aria-haspopup"] === "dialog")
        .props.onClick(),
    );
  return {
    renderer,
    events,
    buttons,
    button,
    open,
    update: async (changes) => {
      options = { ...options, ...changes };
      await act(async () => renderer.update(createElement(WorktreePicker, options)));
    },
  };
}

test("composer switcher searches checkouts and navigates only when selecting a different directory", async (t) => {
  const ui = await mount(t);
  await ui.open();
  assert.equal(ui.renderer.root.findAllByProps({ role: "dialog" }).length, 1);
  const search = ui.renderer.root.findByProps({ placeholder: "Search branches or workspaces" });
  await act(async () => search.props.onChange({ target: { value: "feature" } }));
  assert.equal(ui.renderer.root.findAllByProps({ role: "listitem" }).length, 1);
  await act(async () =>
    ui
      .buttons()
      .find((node) => node.props.title === feature)
      .props.onClick(),
  );
  assert.deepEqual(ui.events, [["refresh"], ["select", feature]]);
  assert.equal(ui.renderer.root.findAllByProps({ role: "dialog" }).length, 0);
});

test("creating a worktree reports its directory and branch to the chat owner", async (t) => {
  const ui = await mount(t);
  api.handler = async () => ({ worktree: { path: feature } });
  await ui.open();
  await act(async () => ui.button("New branch & workspace").props.onClick());
  await act(async () =>
    ui.renderer.root.findByProps({ id: "workspace-branch-name" }).props.onChange({ target: { value: "  feature  " } }),
  );
  await act(async () => ui.renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(api.calls, [["worktrees.create", { projectRoot: main, cwd: main, branch: "feature" }]]);
  assert.deepEqual(ui.events.at(-1), ["created", feature, "feature"]);
});

test("removal requires confirmation and dirty checkouts require a second explicit force action", async (t) => {
  const ui = await mount(t);
  api.handler = async (_method, params) => {
    if (!params.force) throw Object.assign(new Error("dirty"), { detail: { dirty: true } });
    return { ok: true };
  };
  await ui.open();
  await act(async () =>
    ui
      .buttons()
      .find((node) => node.props["aria-label"]?.includes(feature))
      .props.onClick(),
  );
  assert.equal(api.calls.length, 0);
  await act(async () => ui.button("Remove").props.onClick());
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0][1].force, false);
  assert.ok(ui.button("Force"));
  await act(async () => ui.button("Force").props.onClick());
  assert.equal(api.calls[1][1].force, true);
});

test("streaming closes the panel and stale repository data cannot expose another project's branches", async (t) => {
  const ui = await mount(t);
  await ui.open();
  await ui.update({ disabled: true });
  assert.equal(ui.renderer.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(ui.buttons().find((node) => node.props["aria-haspopup"]).props.disabled, true);
  await ui.update({ disabled: false, selectedCwd: "/other/repo", selectedProject: "/other/repo" });
  assert.equal(ui.buttons().length, 0);
});

test("Escape dismisses the popover without navigating or mutating Git", async (t) => {
  const ui = await mount(t);
  await ui.open();
  await act(async () =>
    ui.renderer.root
      .findByProps({ role: "dialog" })
      .props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }),
  );
  assert.equal(ui.renderer.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(ui.events, [["refresh"]]);
});

test("sidebar shows each session once and searches inside collapsed projects without Git controls", async (t) => {
  let renderer;
  // Release the sidebar before the shared DOM fixture restores globals.
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
  });
  await mount(t);
  const home = "/home/demo";
  const sessions = [
    { id: "a", name: "Project discussion", cwd: main, projectRoot: main },
    { id: "b", name: "General discussion", cwd: home, projectRoot: home },
    { id: "c", name: "Hidden discussion", cwd: "/projects/other", projectRoot: "/projects/other" },
  ].map((session) => ({ ...session, modified: "2026-11-04T08:00:00Z", messageCount: 1 }));
  const snapshot = { sessions, loading: false, error: null, runningSessionIds: [] };
  const store = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    subscribeDeleted: () => () => {},
    refreshIfDisconnected() {},
  };
  await act(async () => {
    renderer = create(
      createElement(SessionSidebar, {
        selectedSessionId: "a",
        onSelectSession() {},
        sessionList: store,
        workspace: { selectedCwd: main, selectedProject: main, setSelectedCwd() {}, homeDir: home },
      }),
    );
  });
  const count = (label) =>
    renderer.root.findAllByType("button").filter((node) => node.props["aria-label"] === label).length;
  assert.equal(count("Project discussion"), 1);
  assert.equal(count("General discussion"), 1);
  assert.equal(count("Hidden discussion"), 0);
  assert.equal(renderer.root.findAllByType(WorktreePicker).length, 0);
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((node) => node.props["aria-label"] === "Search sessions")
      .props.onClick(),
  );
  await act(async () => renderer.root.findByProps({ type: "search" }).props.onChange({ target: { value: "Hidden" } }));
  assert.equal(count("Hidden discussion"), 1);
  assert.equal(count("Project discussion"), 0);
});
