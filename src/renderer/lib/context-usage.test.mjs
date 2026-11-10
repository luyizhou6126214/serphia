import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { contextUsageFromMessages } = await importTestBundle("context-usage", {
  mainFields: ["module", "main"],
  stdin: {
    contents: 'export {contextUsageFromMessages} from "./context-usage.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

test("derives context occupancy from the last settled assistant usage", () => {
  const messages = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      model: "m",
      provider: "p",
      usage: usage(100, 20, 880),
    },
  ];
  assert.deepEqual(contextUsageFromMessages(messages, 10_000), {
    tokens: 1_000,
    contextWindow: 10_000,
    percent: 10,
  });
});

test("adds a conservative estimate for messages after the last usage", () => {
  const messages = [
    { role: "assistant", content: [], model: "m", provider: "p", usage: usage(90, 10) },
    { role: "user", content: "x".repeat(400) },
  ];
  const result = contextUsageFromMessages(messages, 1_000);
  assert.equal(result.tokens, 200);
  assert.equal(result.percent, 20);
});

test("returns null without a window, usable usage, or across compaction", () => {
  const assistant = { role: "assistant", content: [], model: "m", provider: "p", usage: usage(10, 10) };
  assert.equal(contextUsageFromMessages([assistant], 0), null);
  assert.equal(contextUsageFromMessages([{ role: "user", content: "hello" }], 1_000), null);
  assert.equal(
    contextUsageFromMessages(
      [assistant, { role: "custom", customType: "compaction", content: "", display: true }],
      1_000,
    ),
    null,
  );
});
