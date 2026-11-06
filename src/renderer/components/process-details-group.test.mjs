import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { workStepDisplayPolicy } from "../../shared/work-step-display.ts";

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
    mainFields: ["module", "main"],
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
              'export function useI18n() { return { language: "en-US", t(_key, fallback) { return fallback; } }; }',
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

const READ_SUMMARY = { counts: [{ kind: "read", count: 2 }] };

function renderGroup(expansionStore, stateKey, mode = "standard", status = "completed") {
  return create(
    createElement(
      ProcessDetailsGroup,
      {
        expansionStore,
        stateKey,
        policy: workStepDisplayPolicy(mode),
        summary: READ_SUMMARY,
        status,
        startedAt: 1_000,
        endedAt: 392_000,
      },
      createElement("span", null, "persisted process content"),
    ),
  );
}

/** The Turn-level fold wrapper; rows stay mounted while it is hidden. */
function turnBody(renderer) {
  return renderer.root.find(
    (node) => typeof node.type === "string" && node.props["data-turn-process-body"] !== undefined,
  );
}

/** The group body; its own fold keeps the rows mounted under `hidden`. */
function groupBody(renderer) {
  return renderer.root.find(
    (node) => typeof node.type === "string" && node.props["data-step-process-body"] !== undefined,
  );
}

/** The settled Turn header row. */
function turnHeader(renderer) {
  return renderer.root.find((node) => node.type === "button" && node.props.className === "dsh-turn-process");
}

/** The group's own activity header row. */
function groupHeader(renderer) {
  return renderer.root.find((node) => node.type === "button" && node.props.className === "dsh-process-title");
}

test("the whole-Turn fold survives a remount and stays isolated by session store", async () => {
  const sessionStore = new ThinkingExpansionStore();
  let renderer;
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(turnHeader(renderer).props["aria-expanded"], false);
  assert.equal(Boolean(turnBody(renderer).props.hidden), true);

  await act(async () => {
    turnHeader(renderer).props.onClick({ currentTarget: { focus() {} } });
  });
  assert.equal(turnHeader(renderer).props["aria-expanded"], true);
  assert.equal(Boolean(turnBody(renderer).props.hidden), false);
  // The group header inside the Turn folds the rows a second time.
  assert.equal(Boolean(groupBody(renderer).props.hidden), true);

  await act(async () => {
    groupHeader(renderer).props.onClick({ currentTarget: { focus() {} } });
  });
  assert.equal(Boolean(groupBody(renderer).props.hidden), false);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(turnHeader(renderer).props["aria-expanded"], true);
  assert.equal(Boolean(groupBody(renderer).props.hidden), false);
  await act(async () => renderer.unmount());

  const otherSessionStore = new ThinkingExpansionStore();
  await act(async () => {
    renderer = renderGroup(otherSessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(turnHeader(renderer).props["aria-expanded"], false);
  await act(async () => renderer.unmount());
});

test("the settled header names the outcome and tabular elapsed time", async () => {
  const renderer = await act(async () => renderGroup(new ThinkingExpansionStore(), "completed:header", "standard"));
  const text = JSON.stringify(renderer.toJSON());
  assert.match(text, /Completed in /);
  assert.match(text, /dsh-turn-duration-number/);
  assert.match(text, /Completed/);
  await act(async () => renderer.unmount());
});

test("a failed or stopped Turn keeps its process rows visible", async () => {
  for (const status of ["failed", "aborted"]) {
    const renderer = await act(async () =>
      renderGroup(new ThinkingExpansionStore(), `status:${status}`, "standard", status),
    );
    assert.equal(turnHeader(renderer).props.disabled, true);
    assert.equal(Boolean(turnBody(renderer).props.hidden), false);
    await act(async () => renderer.unmount());
  }
});

test("verbose removes the fold so a settled Turn shows its rows inline", async () => {
  const renderer = await act(async () => renderGroup(new ThinkingExpansionStore(), "group:verbose", "verbose"));
  assert.equal(turnHeader(renderer).props.disabled, true);
  assert.equal(Boolean(turnBody(renderer).props.hidden), false);
  // No group header exists without grouping: the rows are the whole section.
  assert.equal(renderer.root.findAllByType("button").length, 1);
  await act(async () => renderer.unmount());
});

test("grouping modes decide whether the running Turn folds into a live header", async () => {
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

  for (const mode of ["compact", "standard"]) {
    const grouped = await act(async () => create(renderLive(mode)));
    assert.equal(grouped.root.findAllByType("button").length, 1);
    assert.equal(Boolean(groupBody(grouped).props.hidden), true);
    await act(async () => grouped.unmount());
  }

  for (const mode of ["detailed", "verbose"]) {
    const inline = await act(async () => create(renderLive(mode)));
    assert.equal(inline.root.findAllByType("button").length, 0);
    assert.equal(inline.root.findAllByProps({ children: "row-1" }).length, 1);
    assert.equal(inline.root.findAllByProps({ children: "row-2" }).length, 1);
    await act(async () => inline.unmount());
  }
});
