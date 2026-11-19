import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { ToolCallRow } = await importTestBundle("tool-progress-ui", {
  entryPoints: [path.join(import.meta.dirname, "ToolCallRow.tsx")],
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react", "lucide-react"],
  plugins: [
    {
      name: "i18n",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const useI18n=()=>({t:(_k,f)=>f});",
        }));
      },
    },
  ],
});
const props = {
  block: { type: "toolCall", toolCallId: "parallel", toolName: "extension_tool", input: {} },
  expanded: false,
  onToggle() {},
  t: (_key, fallback) => fallback,
  runningLabel: "Running",
  preparingLabel: "Preparing",
  inputLabel: "IN",
  outputLabel: "OUT",
  stoppedLabel: "Stopped",
  missingResultLabel: "Missing result",
  browserTabId: null,
  browserSummary: null,
};
const text = (node) => node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");

test("shared chat renders live parallel progress without falsely completing a tool, then exposes child receipts", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ToolCallRow, {
        ...props,
        running: true,
        result: {
          role: "toolResult",
          toolCallId: "parallel",
          content: [],
          partial: true,
          nestedCalls: { complete: false, calls: [{ id: "parallel/1", name: "write", status: "unfinished" }] },
        },
        resultText: "Cover: complete\nData: running",
      }),
    );
  });
  assert.equal(renderer.root.findByProps({ className: "dsh-tool-row" }).props["data-state"], "running");
  assert.equal(text(renderer.root.findByProps({ role: "status" })), "Cover: complete\nData: running");
  assert.equal(renderer.root.findAllByType("details").length, 1);
  assert.match(text(renderer.root.findByType("summary")), /writeRunning/);
  await act(async () =>
    renderer.update(
      createElement(ToolCallRow, {
        ...props,
        expanded: true,
        running: false,
        resultText: "Complete",
        result: {
          role: "toolResult",
          toolCallId: "parallel",
          content: [],
          nestedCalls: {
            complete: true,
            calls: [
              { id: "parallel/1", name: "write", arguments: { path: "cover.svg" }, status: "ok", durationMs: 5 },
              { id: "parallel/2", name: "read", status: "error", error: "Missing source" },
            ],
          },
        },
      }),
    ),
  );
  assert.equal(renderer.root.findAllByType("details").length, 2);
  assert.match(text(renderer.root), /cover.svg/);
  assert.match(text(renderer.root), /Missing source/);
  assert.equal(renderer.root.findAllByProps({ role: "status" }).length, 0);
  await act(async () => renderer.unmount());
});
