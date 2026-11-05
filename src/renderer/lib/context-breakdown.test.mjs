import assert from "node:assert/strict";
import test from "node:test";

import { buildContextBreakdown, estimateTokens } from "./context-breakdown.ts";

function user(text) {
  return { role: "user", content: text, timestamp: 1 };
}

function assistant(content) {
  return {
    role: "assistant",
    content,
    model: "model",
    provider: "provider",
    timestamp: 2,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("token estimation distinguishes CJK characters from grouped latin text", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("hello"), 2);
  assert.equal(estimateTokens("你好世界"), 4);
  assert.equal(estimateTokens("hello 你好"), 4);
});

test("without runtime usage the breakdown uses deterministic estimates", () => {
  const breakdown = buildContextBreakdown({
    messages: [user("你好"), assistant([{ type: "text", text: "hello" }])],
    systemPrompt: "abcd",
    toolNames: ["read", "write"],
    contextUsage: null,
  });

  assert.equal(breakdown.systemTokens, 1);
  assert.equal(breakdown.toolsTokens, 160);
  assert.equal(breakdown.messageTokens, 12);
  assert.equal(breakdown.totalTokens, 173);
  assert.equal(breakdown.usedTokens, 173);
  assert.equal(breakdown.percent, null);
  assert.equal(breakdown.runtimeReported, false);
  assert.equal(breakdown.estimatesOnly, true);
  assert.deepEqual(breakdown.messageCounts, { user: 1, assistant: 1, toolResult: 0, custom: 0 });
});

test("runtime reported usage fits estimates under the actual total", () => {
  const breakdown = buildContextBreakdown({
    messages: [user("你好"), assistant([{ type: "text", text: "hello" }])],
    systemPrompt: "abcd",
    toolNames: ["read", "write"],
    contextUsage: { percent: 50, contextWindow: 1000, tokens: 500 },
  });

  assert.equal(breakdown.systemTokens, 1);
  assert.equal(breakdown.toolsTokens, 160);
  assert.equal(breakdown.messageTokens, 339);
  assert.equal(breakdown.totalTokens, 500);
  assert.equal(breakdown.usedTokens, 500);
  assert.equal(breakdown.percent, 50);
  assert.equal(breakdown.runtimeReported, true);
  assert.equal(breakdown.estimatesOnly, false);
});

test("a small reported total never lets component estimates exceed it", () => {
  const breakdown = buildContextBreakdown({
    messages: [user("hello")],
    systemPrompt: "abcd",
    toolNames: ["read", "write"],
    contextUsage: { percent: null, contextWindow: 1000, tokens: 100 },
  });

  assert.equal(breakdown.totalTokens, 100);
  assert.equal(breakdown.systemTokens, 1);
  assert.equal(breakdown.toolsTokens, 99);
  assert.equal(breakdown.messageTokens, 0);
  assert.equal(breakdown.percent, 10);
});

test("images and tool calls contribute to the message estimate and counts", () => {
  const breakdown = buildContextBreakdown({
    messages: [
      { role: "user", content: [{ type: "image", source: { type: "url", url: "" } }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "call", toolName: "read", input: { path: "a.ts" } }],
        model: "m",
        provider: "p",
        timestamp: 2,
      },
      { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "ok" }], timestamp: 3 },
    ],
    contextUsage: null,
  });

  assert.equal(breakdown.messageCounts.user, 1);
  assert.equal(breakdown.messageCounts.assistant, 1);
  assert.equal(breakdown.messageCounts.toolResult, 1);
  assert.ok(breakdown.messageTokens > 800);
  assert.equal(breakdown.loadedMessages, 3);
});

test("an empty context produces zeroed estimates", () => {
  const breakdown = buildContextBreakdown({ messages: [], contextUsage: null });
  assert.equal(breakdown.totalTokens, 0);
  assert.equal(breakdown.usedTokens, 0);
  assert.equal(breakdown.percent, null);
  assert.equal(breakdown.estimatesOnly, true);
});
