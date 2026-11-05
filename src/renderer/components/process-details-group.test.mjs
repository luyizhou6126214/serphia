import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { LiveProcessRows, ProcessDetailsGroup, ThinkingExpansionStore } = await importTestBundle(
  "src/renderer/components/process-details-group",
  {
    stdin: {
      contents:
        'export { ProcessDetailsGroup } from "./ProcessDetailsGroup.tsx"; export { LiveProcessRows } from "./LiveProcessRows.tsx"; export { ThinkingExpansionStore } from "../lib/thinking-expansion-store.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "process-details-group-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
    plugins: [
      {
        name: "stub-i18n",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\/i18n$/ }, () => ({
            path: "i18n",
            namespace: "process-details-group-test",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "process-details-group-test" }, () => ({
            contents:
              'export function useI18n() { return { language: "en", t(_key, fallback) { return fallback; } }; }',
            loader: "js",
          }));
        },
      },
    ],
  },
);

after(() => {
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

function renderGroup(expansionStore, stateKey, workStepDisplay = "standard") {
  return create(
    createElement(
      ProcessDetailsGroup,
      { expansionStore, stateKey, messageCount: 2, toolCallCount: 1, workStepDisplay },
      createElement("span", null, "persisted process content"),
    ),
  );
}

test("process details expansion survives a component remount and remains isolated by session store", async () => {
  const sessionStore = new ThinkingExpansionStore();
  let renderer;
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 0);

  await act(async () => {
    renderer.root.findByType("button").props.onClick();
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], true);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 1);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], true);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 1);
  await act(async () => renderer.unmount());

  const otherSessionStore = new ThinkingExpansionStore();
  await act(async () => {
    renderer = renderGroup(otherSessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
  await act(async () => renderer.unmount());
});

test("live compact turns collapse their process rows into one summary", async () => {
  const messages = [
    { role: "user", content: "inspect" },
    {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "one", toolName: "read", input: { path: "one.ts" } }],
    },
    {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "two", toolName: "read", input: { path: "two.ts" } }],
    },
  ];
  const renderRow = (idx) => createElement("span", { key: `row-${idx}` }, `row-${idx}`);
  const renderLive = (mode) =>
    createElement(LiveProcessRows, {
      messages,
      userIdx: 0,
      endIdx: messages.length,
      entryId: "live-user",
      expansionStore: new ThinkingExpansionStore(),
      workStepDisplay: mode,
      renderMessage: renderRow,
    });

  const compact = await act(async () => create(renderLive("compact")));
  assert.equal(compact.root.findAllByType("button").length, 1);
  assert.equal(compact.root.findAllByProps({ children: "row-1" }).length, 0);
  assert.equal(compact.root.findAllByProps({ children: "row-2" }).length, 0);
  await act(async () => compact.unmount());

  const detailed = await act(async () => create(renderLive("detailed")));
  assert.equal(detailed.root.findAllByProps({ children: "row-1" }).length, 1);
  assert.equal(detailed.root.findAllByProps({ children: "row-2" }).length, 1);
  await act(async () => detailed.unmount());

  const verbose = await act(async () => create(renderLive("verbose")));
  assert.equal(verbose.root.findAllByType("button").length, 0);
  assert.equal(verbose.root.findAllByProps({ children: "row-1" }).length, 1);
  assert.equal(verbose.root.findAllByProps({ children: "row-2" }).length, 1);
  await act(async () => verbose.unmount());
});

test("work-step modes control grouping and initial expansion", async () => {
  for (const mode of ["compact", "standard"]) {
    const renderer = await act(async () => renderGroup(new ThinkingExpansionStore(), `group:${mode}`, mode));
    assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
    assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 0);
    await act(async () => renderer.unmount());
  }

  const detailedStore = new ThinkingExpansionStore();
  const detailed = await act(async () => renderGroup(detailedStore, "group:detailed", "detailed"));
  assert.equal(detailed.root.findByType("button").props["aria-expanded"], true);
  assert.equal(detailed.root.findAllByProps({ children: "persisted process content" }).length, 1);
  await act(async () => detailed.root.findByType("button").props.onClick());
  assert.equal(detailedStore.has("group:detailed"), true);
  assert.equal(detailed.root.findByType("button").props["aria-expanded"], false);
  await act(async () => detailed.unmount());

  const verbose = await act(async () => renderGroup(new ThinkingExpansionStore(), "group:verbose", "verbose"));
  assert.equal(verbose.root.findAllByType("button").length, 0);
  assert.equal(verbose.root.findAllByProps({ children: "persisted process content" }).length, 1);
  await act(async () => verbose.unmount());
});
