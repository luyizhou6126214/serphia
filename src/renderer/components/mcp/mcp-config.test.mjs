import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
const { McpServerEditor, McpConfig, McpToolsPanel, api } = await importTestBundle("mcp-ui", {
  stdin: {
    contents:
      'export {McpServerEditor} from "./McpServerEditor.tsx"; export {McpConfig} from "./McpConfig.tsx"; export {McpToolsPanel} from "./McpToolsPanel.tsx"; export * as api from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*", "react-test-renderer"],
  plugins: [
    {
      name: "mcp-ui-api",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api", namespace: "mcp-ui-test" }));
        build.onLoad({ filter: /.*/, namespace: "mcp-ui-test" }, () => ({
          loader: "js",
          contents: `
    export const calls=[]; let handler=async () => undefined; export function respond(value){handler=value;calls.length=0;} export async function call(method,params){calls.push({method,params});return handler(method,params);} export async function subscribe(){return () => {};}
  `,
        }));
      },
    },
  ],
});
async function render(t, element) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => {
    renderer = create(element);
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return renderer;
}
const button = (renderer, text) =>
  renderer.root
    .findAllByType("button")
    .find((node) => node.children.filter((child) => typeof child === "string").join("") === text);

test("MCP editor preserves unknown fields and validates malformed JSON before saving", async (t) => {
  const saved = [];
  let dirty = 0;
  const renderer = await render(
    t,
    createElement(McpServerEditor, {
      initial: {
        name: "fixture",
        config: {
          command: "node",
          args: ["old"],
          future: { preserved: true },
          env: { TOKEN: "<pi-desktop:saved-secret>" },
        },
      },
      busy: false,
      onDirty: () => dirty++,
      onCancel() {},
      onSave: (...args) => saved.push(args),
    }),
  );
  const args = renderer.root.findByProps({ "aria-label": "Arguments (JSON array)" });
  await act(async () => args.props.onChange({ target: { value: "{broken" } }));
  await act(async () => button(renderer, "Save configuration").props.onClick());
  assert.equal(saved.length, 0);
  await act(async () => args.props.onChange({ target: { value: '["literal argument"]' } }));
  await act(async () => button(renderer, "Save configuration").props.onClick());
  assert.deepEqual(saved[0][1].args, ["literal argument"]);
  assert.equal(saved[0][1].future.preserved, true);
  assert.equal(saved[0][1].env.TOKEN, "<pi-desktop:saved-secret>");
  assert.ok(dirty > 0);
});

test("the MCP editor shows one codemode choice for legacy aliases and saves a server summary", async (t) => {
  const saved = [];
  const renderer = await render(
    t,
    createElement(McpServerEditor, {
      initial: {
        name: "fixture",
        config: { command: "node", exposure: "codemode-deferred", description: "Old summary" },
      },
      busy: false,
      onDirty() {},
      onCancel() {},
      onSave: (_name, config) => saved.push(config),
    }),
  );
  const exposure = renderer.root.findAllByType("select").find((node) => node.props.value === "codemode");
  assert.ok(exposure);
  assert.equal(
    exposure.findAllByType("option").some((node) => node.props.value === "codemode-deferred"),
    false,
  );
  await act(async () =>
    renderer.root.findByProps({ value: "Old summary" }).props.onChange({ target: { value: "New searchable summary" } }),
  );
  await act(async () => button(renderer, "Save configuration").props.onClick());
  assert.equal(saved[0].description, "New searchable summary");
});

test("MCP settings open the add form directly and protect unsaved navigation", async (t) => {
  const ref = { current: null };
  let navigated = 0;
  api.respond(async (method) => {
    if (method === "mcp.config.get") return { scope: "global", revision: "missing", entries: [] };
    throw new Error("Unexpected MCP mutation " + method);
  });
  const renderer = await render(t, createElement(McpConfig, { ref, cwd: null, sessionId: null }));
  assert.deepEqual(
    api.calls.map((entry) => entry.method),
    ["mcp.config.get"],
  );
  const add = button(renderer, "Add server");
  assert.equal(add.props.popoverTarget, undefined);
  assert.equal(button(renderer, "Import JSON"), undefined);
  assert.equal(renderer.root.findAllByType("details").length, 0);
  await act(async () => add.props.onClick());
  const name = renderer.root.findAllByType("input").find((input) => input.props.id?.endsWith("-name"));
  await act(async () => name.props.onChange({ target: { value: "draft" } }));
  assert.deepEqual(
    api.calls.map(({ method }) => method),
    ["mcp.config.get"],
  );
  await act(async () => ref.current.requestLeave(() => navigated++));
  assert.equal(navigated, 0);
  assert.equal(renderer.root.findAllByProps({ role: "alertdialog" }).length, 1);
  await act(async () => button(renderer, "Keep editing").props.onClick());
  assert.equal(navigated, 0);
  await act(async () => ref.current.requestLeave(() => navigated++));
  await act(async () => button(renderer, "Discard changes").props.onClick());
  assert.equal(navigated, 1);
});

test("MCP permission UI sends only scoped grants and respects unavailable entry points", async (t) => {
  api.respond(async () => ({ adapterActive: true, instances: [], tools: [] }));
  const renderer = await render(
    t,
    createElement(McpToolsPanel, {
      sessionId: "fixture",
      onChanged() {},
      panel: {
        adapterActive: true,
        instances: [],
        entryTools: ["codemode"],
        tools: [
          {
            name: "mcp__fixture__echo",
            originalName: "echo",
            server: "fixture",
            inputSchema: {},
            exposure: "codemode",
            active: false,
            callable: true,
            executionAllowed: false,
          },
        ],
      },
    }),
  );
  const checkbox = renderer.root.findAllByType("input").at(-1);
  await act(async () => checkbox.props.onChange({ target: { checked: true } }));
  assert.deepEqual(api.calls[0], {
    method: "mcp.grants",
    params: { sessionId: "fixture", toolNames: ["mcp__fixture__echo", "codemode"] },
  });
  await act(async () => renderer.root.findAllByType("input")[0].props.onChange({ target: { checked: true } }));
  assert.deepEqual(api.calls[1], {
    method: "mcp.declarations",
    params: { sessionId: "fixture", toolNames: ["codemode"] },
  });
});

test("MCP settings add global servers even when a project is open", async (t) => {
  const snapshot = { scope: "global", revision: "global-revision", entries: [] };
  api.respond(async (method) => {
    if (method === "mcp.snapshot") return { adapterActive: true, instances: [], tools: [] };
    return snapshot;
  });
  const renderer = await render(t, createElement(McpConfig, { cwd: "/project", sessionId: "session" }));
  assert.equal(renderer.root.findAllByType("select").length, 0);
  await act(async () => button(renderer, "Add server").props.onClick());
  const name = renderer.root.findAllByType("input").find((input) => input.props.id?.endsWith("-name"));
  await act(async () => name.props.onChange({ target: { value: "added" } }));
  const command = renderer.root
    .findAllByType("label")
    .find((label) => label.children.includes("Command"))
    .findByType("input");
  await act(async () => command.props.onChange({ target: { value: "node" } }));
  await act(async () => button(renderer, "Save configuration").props.onClick());

  const reads = api.calls.filter(({ method }) => method === "mcp.config.get");
  assert.ok(reads.length > 0);
  for (const read of reads) assert.deepEqual(read.params, { scope: "global" });
  assert.deepEqual(
    api.calls.filter(({ method }) => method === "mcp.config.upsert"),
    [
      {
        method: "mcp.config.upsert",
        params: {
          scope: "global",
          name: "added",
          config: { command: "node", args: [], exposure: "codemode" },
          expectedRevision: "global-revision",
        },
      },
    ],
  );
});

test("an old MCP probe cannot update settings after the working directory changes", async (t) => {
  let finish;
  api.respond(async (method) => {
    if (method === "mcp.config.get")
      return { scope: "global", revision: "fixture", entries: [{ name: "server", config: { command: "fixture" } }] };
    if (method === "mcp.probe")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (method === "mcp.probe.cancel") return { ok: true };
  });
  const renderer = await render(t, createElement(McpConfig, { cwd: "/old", sessionId: null }));
  await act(async () => renderer.root.findByProps({ className: "mcp-row-trigger" }).props.onClick());
  await act(async () => {
    button(renderer, "Test connection").props.onClick();
  });
  await act(async () => renderer.update(createElement(McpConfig, { cwd: "/new", sessionId: null })));
  await act(async () => finish({ adapterActive: false, instances: [], tools: [] }));
  assert.equal(button(renderer, "Cancel connection test"), undefined);
  assert.equal(
    renderer.root.findAllByType("summary").some((node) => node.children.join("") === "Last connection test"),
    false,
  );
  assert.ok(api.calls.some((entry) => entry.method === "mcp.probe.cancel"));
});

test("a failed MCP switch write restores the previous state", async (t) => {
  let fail;
  api.respond(async (method) => {
    if (method === "mcp.config.get") {
      return { scope: "global", revision: "fixture", entries: [{ name: "fixture", config: { command: "node" } }] };
    }
    if (method === "mcp.config.upsert") {
      return new Promise((_, reject) => {
        fail = reject;
      });
    }
    throw new Error("Unexpected MCP request " + method);
  });
  const renderer = await render(t, createElement(McpConfig, { cwd: null, sessionId: null }));
  const toggle = () => renderer.root.findByProps({ role: "switch" });
  await act(async () => toggle().props.onClick());
  assert.equal(toggle().props["aria-checked"], false);
  assert.equal(toggle().props["aria-disabled"], true);
  await act(async () => toggle().props.onClick());
  assert.equal(api.calls.filter(({ method }) => method === "mcp.config.upsert").length, 1);
  await act(async () => fail(new Error("Configuration changed")));
  assert.equal(toggle().props["aria-checked"], true);
  assert.equal(toggle().props["aria-disabled"], false);
  assert.equal(renderer.root.findByProps({ role: "alert" }).children.join(""), "Configuration changed");
});
