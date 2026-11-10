import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SessionManager,
  SettingsManager,
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import { readSessionSnapshot } from "./session-readonly.ts";
import { buildSessionStats } from "./session-stats.ts";
import { importTestBundle } from "#test-bundle";

const { buildSessionContext } = await importTestBundle("pi-session-stats-reader", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-reader.ts")],
});

function usage(value) {
  return {
    input: value,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: value,
    cost: { input: value, output: 0, cacheRead: 0, cacheWrite: 0, total: value },
  };
}

test("read-only totals match the SDK across branches, compaction and non-message usage", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-stats-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage({ role: "system", content: "System checkpoint", timestamp: 1 });
  const userId = manager.appendMessage({ role: "user", content: "original user text", timestamp: 2 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "stats-call", name: "read", arguments: { path: "fixture" } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    stopReason: "toolUse",
    timestamp: 3,
    usage: usage(1),
  });
  manager.appendMessage({
    role: "toolResult",
    toolName: "read",
    toolCallId: "stats-call",
    content: [{ type: "text", text: "fixture result" }],
    isError: false,
    timestamp: 4,
    usage: usage(2),
  });
  manager.appendUsage("cache_warm", "anthropic", "claude-sonnet-4-5", usage(3));
  manager.appendUsage("extension", "anthropic", "claude-sonnet-4-5", usage(6));
  manager.appendCompaction("Safe summary", null, 100, undefined, false, usage(4));
  manager.branchWithSummary(userId, "Branch summary", undefined, false, usage(5));
  manager.appendContextEdit(userId, null);

  const filePath = manager.getSessionFile();
  assert.ok(filePath);
  const before = readFileSync(filePath);
  const snapshot = readSessionSnapshot(filePath);
  const raw = snapshot.getEntries();
  const result = buildSessionStats(raw, { sessionId: manager.getSessionId(), sessionFile: filePath });
  assert.deepEqual(readFileSync(filePath), before);
  assert.equal(result.cost, 21);
  assert.equal(result.tokens.total, 21);
  assert.equal(result.userMessages, 1);
  assert.equal(result.assistantMessages, 1);
  assert.equal(result.toolResults, 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.totalMessages, 3);

  const display = buildSessionContext(raw);
  assert.equal(
    display.messages.some((message) => message.role === "system"),
    false,
  );
  assert.equal(
    display.messages.some((message) => message.role === "user" && message.content === "original user text"),
    true,
  );
  assert.equal(display.messages.length, display.entryIds.length);
  assert.equal(
    manager
      .buildSessionProjection()
      .messages.some((message) => message.role === "user" && message.content === "original user text"),
    false,
  );

  const services = await createAgentSessionServices({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory({ defaultTools: [] }),
    resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const model = services.modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  assert.ok(model);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model, tools: [] });
  t.after(() => session.dispose());
  const sdk = session.getSessionStats();
  assert.deepEqual(result.tokens, sdk.tokens);
  assert.equal(result.cost, sdk.cost);
  for (const key of ["userMessages", "assistantMessages", "toolResults", "toolCalls"]) {
    assert.equal(result[key], sdk[key], key);
  }
});

test("tokensPerSecond folds timed assistant steps and ignores untimed usage", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-stats-speed-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(directory, directory);
  const timedUsage = (output) => ({
    ...usage(0),
    output,
    totalTokens: output,
  });
  const assistant = (timestamp, output, durationMs) => ({
    role: "assistant",
    content: [{ type: "text", text: "fixture" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    stopReason: "stop",
    timestamp,
    usage: timedUsage(output),
    ...(durationMs === undefined ? {} : { durationMs }),
  });
  manager.appendMessage(assistant(1, 100, 2_000));
  manager.appendMessage(assistant(2, 50, 1_000));
  manager.appendMessage(assistant(3, 500));
  manager.appendMessage({
    role: "toolResult",
    toolName: "read",
    toolCallId: "fixture",
    content: [{ type: "text", text: "fixture result" }],
    isError: false,
    timestamp: 4,
    durationMs: 750,
  });

  const result = buildSessionStats(manager.getEntries(), { sessionId: manager.getSessionId() });
  assert.equal(result.tokensPerSecond, 50);
  assert.equal(result.llmDurationMs, 3_000);
  assert.equal(result.toolDurationMs, 750);
});

test("tokensPerSecond stays absent for legacy sessions without timings", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-stats-legacy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "fixture" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    stopReason: "stop",
    timestamp: 1,
    usage: usage(10),
  });
  const result = buildSessionStats(manager.getEntries(), { sessionId: manager.getSessionId() });
  assert.equal(result.tokensPerSecond, undefined);
});
