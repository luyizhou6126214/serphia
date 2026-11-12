import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { ReviewActivityPane, setSnapshot } = await importTestBundle("review-activity-pane", {
  stdin: {
    contents:
      'export { ReviewActivityPane } from "./ReviewActivityPane.tsx"; export { setSnapshot } from "./useReviewActivity";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  mainFields: ["module", "main"],
  external: ["react", "react-dom", "react-dom/*"],
  loader: { ".css": "empty" },
  plugins: [
    {
      name: "review-activity-fixture",
      setup(build) {
        const modules = {
          "@/i18n":
            'export function useI18n() { return { language: "en-US", t(_key, fallback) { return fallback; } }; }',
          "./useReviewActivity":
            "let snapshot; export const useReviewActivity = () => snapshot; export function setSnapshot(value) { snapshot = value; }",
          "../MessageView":
            'import { createElement } from "react"; export function MessageView({ message, workStepDisplay }) { return createElement("p", { "data-mode": workStepDisplay }, message.content.map((b) => b.text ?? b.thinking ?? b.toolName).join(" ")); }',
        };
        build.onResolve({ filter: /^(?:@\/i18n|\.\/useReviewActivity|\.\.\/MessageView)$/ }, ({ path }) => ({
          path,
          namespace: "review-fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "review-fixture" }, ({ path }) => ({ contents: modules[path] }));
      },
    },
  ],
});

const run = { id: "run", root: "/repo", startedAt: 1_000, model: "Fixture", state: "running", contextWindow: 1_000 };
const tool = {
  id: 1,
  at: 1_000,
  kind: "tool",
  name: "code_search",
  input: '{"search_text":"workspace"}',
  status: "running",
};
const model = {
  id: 2,
  at: 2_000,
  kind: "model",
  model: "Fixture",
  provider: "fixture",
  status: "done",
  text: "Final answer",
  reasoning: "Private work",
  toolUse: false,
};

function render(mode, props = {}) {
  return renderToStaticMarkup(
    createElement(ReviewActivityPane, { run, visible: true, workStepDisplay: mode, ...props }),
  );
}

test("the live review follows the same grouping and title detail as chat", () => {
  setSnapshot({ entries: [tool], stats: { modelCalls: 0, toolCalls: 1 } });
  const standard = render("standard");
  assert.match(standard, /class="dsh-process-title" aria-expanded="false"/);
  assert.match(standard, /workspace/);
  assert.doesNotMatch(render("compact"), /workspace/);
  for (const mode of ["detailed", "verbose"]) {
    const html = render(mode);
    assert.doesNotMatch(html, /class="dsh-process-title"/);
    assert.match(html, new RegExp(`data-mode="${mode}">code_search`));
  }
  assert.match(standard, /Context window.*1K/);
});

test("history keeps the final answer outside completed work and shows whole-run usage", () => {
  setSnapshot({
    entries: [tool, model],
    stats: {
      modelCalls: 32,
      toolCalls: 46,
      inputTokens: 800,
      outputTokens: 50,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
      context: { tokens: 300, window: 1_000 },
    },
  });
  const props = { run: { ...run, finishedAt: 4_000, state: "complete" }, historyRef: { archiveId: "run" } };
  const html = render("standard", props);
  assert.match(html, /data-turn-process-body="" hidden=""/);
  assert.match(
    html,
    /Private work<\/p><\/article>(?:<\/div>)+<article class="cr-activity-model"><p data-mode="standard">Final answer<\/p>/,
  );
  assert.match(html, /32 model calls · 46 tool calls/);
  assert.match(html, /850 tok/);
  assert.match(html, /Cache hit 50%/);
  assert.match(html, /Context used 30%.*300 \/ 1K/);
  assert.doesNotMatch(render("verbose", props), /data-turn-process-body="" hidden=""/);
});

test("older activity can show tokens without implying a cache hit or context window", () => {
  setSnapshot({ entries: [model], stats: { modelCalls: 1, toolCalls: 0, inputTokens: 800, outputTokens: 50 } });
  const html = render("standard", { run: { ...run, contextWindow: undefined, finishedAt: 4_000, state: "complete" } });
  assert.match(html, /850 tok/);
  assert.doesNotMatch(html, /Cache hit|Context (?:window|used)/);
});
