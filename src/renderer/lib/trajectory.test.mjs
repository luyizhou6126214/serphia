import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrajectory,
  formatTrajectoryCost,
  formatTrajectoryDuration,
  formatTrajectoryTokens,
} from "./trajectory.ts";

const BASE = 1_700_000_000_000;

function user(text, timestamp = BASE) {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistant(content, timestamp = BASE + 100, extra = {}) {
  return {
    role: "assistant",
    content,
    model: "model-a",
    provider: "provider-a",
    timestamp,
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
    ...extra,
  };
}

function toolCall(id, name, input) {
  return { type: "toolCall", toolCallId: id, toolName: name, input };
}

function toolResult(id, text, timestamp = BASE + 300, isError = false) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text }],
    timestamp,
    isError,
  };
}

test("groups a turn and pairs tool results with their calls", () => {
  const messages = [
    user("inspect the file"),
    assistant([{ type: "text", text: "Checking." }, toolCall("call-1", "read", { path: "src/a.ts" })], BASE + 100),
    toolResult("call-1", "export const a = 1;", BASE + 400),
    assistant([{ type: "text", text: "The file exports one constant." }], BASE + 500),
  ];

  const snapshot = buildTrajectory(messages, { entryIds: ["u", "a1", "r1", "a2"] });

  assert.equal(snapshot.turns.length, 1);
  assert.equal(snapshot.turns[0].index, 1);
  assert.deepEqual(
    snapshot.rows.map((row) => row.kind),
    ["user", "assistant", "tool", "assistant"],
  );
  assert.equal(snapshot.userCount, 1);
  assert.equal(snapshot.assistantCount, 2);
  assert.equal(snapshot.toolCount, 1);
  assert.equal(snapshot.totalTokens, 240);
  assert.equal(snapshot.totalCost, 0.006);

  const tool = snapshot.rows[2];
  assert.equal(tool.status, "completed");
  assert.equal(tool.durationMs, 300);
  assert.match(tool.toolInput, /src\/a\.ts/);
  assert.match(tool.toolOutput, /export const a/);
  assert.equal(snapshot.turns[0].durationMs, 500);
  assert.equal(snapshot.turns[0].model, "model-a");
  assert.equal(snapshot.turns[0].usage.input, 200);

  assert.ok(snapshot.turns[0].spans.some((span) => span.lane === "model" && span.kind === "assistant"));
  assert.ok(snapshot.turns[0].spans.some((span) => span.lane === "tool" && span.durationMs === 300));
});

test("persisted context records are interleaved into their turns", () => {
  const snapshot = buildTrajectory([user("go", BASE), assistant([{ type: "text", text: "answer" }], BASE + 200)], {
    contextEntries: [
      {
        entryId: "system-entry",
        kind: "system",
        timestamp: BASE - 100,
        title: "system",
        preview: "base",
        text: "You are an agent.",
      },
      {
        entryId: "custom-entry",
        kind: "context",
        timestamp: BASE + 100,
        title: "runtime-context",
        preview: "cwd is E:\\code",
        text: "cwd is E:\\code",
      },
    ],
  });

  assert.deepEqual(
    snapshot.rows.map((row) => row.kind),
    ["system", "user", "context", "assistant"],
  );
  assert.equal(snapshot.rows[0].notice, "system-prompt");
  assert.match(snapshot.rows[0].detailText, /You are an agent/);
  assert.equal(snapshot.rows[2].title, "runtime-context");
  assert.equal(snapshot.rows[2].turn, 1);
  assert.equal(snapshot.turns[0].index, 0);
  assert.equal(snapshot.turns[1].index, 1);
});

test("a second user message starts the next turn", () => {
  const snapshot = buildTrajectory([
    user("one", BASE),
    assistant([{ type: "text", text: "first" }], BASE + 10),
    user("two", BASE + 20),
    assistant([{ type: "text", text: "second" }], BASE + 30),
  ]);

  assert.deepEqual(
    snapshot.turns.map((turn) => turn.index),
    [1, 2],
  );
  assert.equal(snapshot.turns[0].rows.length, 2);
  assert.equal(snapshot.turns[1].rows.length, 2);
  assert.equal(snapshot.rows[2].kind, "user");
});

test("tool output strips terminal color codes before projection", () => {
  const snapshot = buildTrajectory([
    user("go"),
    assistant([toolCall("call-ansi", "bash", { command: "echo ok" })], BASE + 10),
    toolResult("call-ansi", "\u001b[32mok\u001b[0m\r\n", BASE + 20),
  ]);

  const tool = snapshot.rows.find((row) => row.kind === "tool");
  assert.ok(tool);
  assert.equal(tool.toolOutput, "ok\n");
  assert.equal(tool.detailText, "ok");
});

test("an orphan tool result is retained instead of disappearing", () => {
  const snapshot = buildTrajectory([user("go"), toolResult("missing", "failed output", BASE + 50, true)]);

  const tool = snapshot.rows.find((row) => row.kind === "tool");
  assert.ok(tool);
  assert.equal(tool.status, "failed");
  assert.equal(tool.isError, true);
  assert.match(tool.toolOutput, /failed output/);
});

test("a running tool exposes running status without inventing a duration", () => {
  const snapshot = buildTrajectory(
    [user("go"), assistant([toolCall("call-9", "bash", { command: "npm test" })], BASE + 100)],
    { runningToolCallIds: new Set(["call-9"]), agentRunning: true, now: BASE + 900 },
  );

  const tool = snapshot.rows.find((row) => row.kind === "tool");
  assert.ok(tool);
  assert.equal(tool.status, "running");
  assert.equal(tool.durationMs, undefined);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.turns[0].status, "running");
});

test("a failed assistant retains its provider error for the inspector", () => {
  const snapshot = buildTrajectory([
    user("go"),
    assistant([{ type: "text", text: "" }], BASE + 10, {
      stopReason: "error",
      errorMessage: "rate limit exceeded",
    }),
  ]);

  const failed = snapshot.rows.find((row) => row.kind === "assistant");
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorMessage, "rate limit exceeded");
});

test("a model change is projected before the assistant that changed model", () => {
  const snapshot = buildTrajectory([
    user("go"),
    assistant([{ type: "text", text: "one" }], BASE + 10),
    assistant([{ type: "text", text: "two" }], BASE + 20, { model: "model-b" }),
  ]);

  assert.deepEqual(
    snapshot.rows.map((row) => row.kind),
    ["user", "assistant", "system", "assistant"],
  );
  const notice = snapshot.rows[2];
  assert.equal(notice.notice, "model");
  assert.equal(notice.model, "model-b");
  assert.equal(notice.previousModel, "model-a");
});

test("custom compaction messages become context rows with their token count", () => {
  const snapshot = buildTrajectory([
    user("go"),
    {
      role: "custom",
      customType: "compaction",
      content: "Earlier work summary",
      display: true,
      details: { tokensBefore: 42_000 },
      timestamp: BASE + 100,
    },
    assistant([{ type: "text", text: "resumed" }], BASE + 200),
  ]);

  const context = snapshot.rows.find((row) => row.kind === "context");
  assert.ok(context);
  assert.equal(context.notice, "compaction");
  assert.equal(context.compactedTokens, 42_000);
  assert.match(context.detailText, /Earlier work summary/);
});

test("a streaming assistant is a running tail row", () => {
  const snapshot = buildTrajectory([user("go", BASE)], {
    streamingMessage: {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      model: "model-a",
      provider: "provider-a",
    },
    agentRunning: true,
    now: BASE + 500,
  });

  const tail = snapshot.rows.at(-1);
  assert.ok(tail);
  assert.equal(tail.kind, "assistant");
  assert.equal(tail.status, "running");
  assert.match(tail.detailText, /partial answer/);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.turns[0].durationMs, 500);
});

test("between-turn context is preserved as turn zero", () => {
  const snapshot = buildTrajectory([
    {
      role: "custom",
      customType: "system-reminder",
      content: "Runtime context",
      display: true,
      timestamp: BASE,
    },
    user("hello", BASE + 10),
    assistant([{ type: "text", text: "hi" }], BASE + 20),
  ]);

  assert.equal(snapshot.turns[0].index, 0);
  assert.equal(snapshot.turns[0].rows[0].kind, "context");
  assert.equal(snapshot.turns[1].index, 1);
  assert.equal(snapshot.rows[1].kind, "user");
});

test("empty transcripts produce an empty stable snapshot", () => {
  const snapshot = buildTrajectory([]);
  assert.deepEqual(snapshot.turns, []);
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.hasTiming, false);
  assert.equal(snapshot.status, "completed");
});

test("duration, token and cost formatters stay compact and bounded", () => {
  assert.equal(formatTrajectoryDuration(undefined), null);
  assert.equal(formatTrajectoryDuration(42), "42 ms");
  assert.equal(formatTrajectoryDuration(1_250), "1.25 s");
  assert.equal(formatTrajectoryDuration(12_500), "12.5 s");
  assert.equal(formatTrajectoryDuration(65_000), "1m 5s");
  assert.equal(formatTrajectoryDuration(3_725_000), "1h 2m");
  assert.equal(formatTrajectoryTokens(999), "999");
  assert.equal(formatTrajectoryTokens(1_200), "1.2k");
  assert.equal(formatTrajectoryTokens(12_000), "12k");
  assert.equal(formatTrajectoryTokens(2_400_000), "2.4M");
  assert.equal(formatTrajectoryCost(0.0034), "$0.0034");
  assert.equal(formatTrajectoryCost(1.5), "$1.50");
});
