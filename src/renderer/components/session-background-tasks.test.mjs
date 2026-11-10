import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { SessionBackgroundTasks, fixture } = await importTestBundle("session-background-tasks", {
  mainFields: ["module", "main"],
  stdin: {
    contents:
      'export { SessionBackgroundTasks } from "./SessionBackgroundTasks.tsx"; export * as fixture from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "tasks-fixture",
      setup(build) {
        build.onResolve({ filter: /^@\/(i18n|lib\/api-client)$/ }, ({ path }) => ({ path, namespace: "tasks-test" }));
        build.onLoad({ filter: /.*/, namespace: "tasks-test" }, ({ path }) => ({
          loader: "js",
          contents:
            path === "@/i18n"
              ? "export const useI18n = () => ({t: (_key, fallback) => fallback});"
              : `export let items = []; export let calls = []; export let listener;
             export function reset(next) { items = next; calls = []; }
             export async function call(method, args) { calls.push({method,args});
               if (method === 'processes.list') return {revision: 1, processes: items};
               if (method === 'processes.dismiss') items = items.filter(item => item.processId !== args.processId);
               return {}; }
             export async function subscribe(_topic, _id, fn) { listener = fn; return () => {}; }`,
        }));
      },
    },
  ],
});

test("shows only this session's tasks and stops or clears the correct runs", async (t) => {
  const oldDocument = globalThis.document;
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const item = (id, ownerSessionId, state) => ({
    processId: id,
    runId: `run-${id}`,
    ownerSessionId,
    state,
    kind: "server",
    commandDisplay: `start ${id}`,
    cwdDisplay: "/tmp",
    startedAt: Date.now(),
  });
  fixture.reset([item("running", "a", "running"), item("ended", "a", "exited"), item("other", "b", "running")]);
  let renderer;
  t.after(async () => {
    await act(async () => renderer.unmount());
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  await act(async () => {
    renderer = create(createElement(SessionBackgroundTasks, { sessionId: "a" }));
  });
  const trigger = renderer.root.findByProps({ className: "session-background-trigger" });
  assert.equal(trigger.props.children[0], "2 background tasks");
  await act(async () => trigger.props.onClick());
  assert.equal(renderer.root.findAllByProps({ title: "start other" }).length, 0);
  await act(async () => renderer.root.findByProps({ "aria-label": "Stop background task" }).props.onClick());
  assert.deepEqual(fixture.calls.find((call) => call.method === "processes.stop").args, {
    processId: "running",
    runId: "run-running",
    mode: "graceful",
  });
  const clear = renderer.root.findAllByType("button").find((button) => button.props.children === "Clear");
  await act(async () => clear.props.onClick());
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === "processes.dismiss").map((call) => call.args.processId),
    ["ended"],
  );
});
