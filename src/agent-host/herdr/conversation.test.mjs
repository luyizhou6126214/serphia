import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importTestBundle } from "#test-bundle";
import { readHerdrConversation } from "./conversation.ts";
import { PaneChat, piNeedsChoice, replySincePrompt } from "./pane-chat.ts";

test(
  "Windows pi accepts a chat turn when the managed launch flag is stale, without replaying ambiguous writes",
  { skip: process.platform !== "win32" },
  async () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const { HerdrBridge, HerdrBridgeError, HerdrPromptNotReadyError } = await importTestBundle("herdr-pending-prompt", {
      absWorkingDir: root,
      packages: "external",
      stdin: {
        resolveDir: root,
        loader: "ts",
        contents:
          'export {HerdrBridge} from "./src/agent-host/herdr/bridge"; export {HerdrBridgeError,HerdrPromptNotReadyError} from "./src/agent-host/herdr/errors";',
      },
    });
    const bridge = Object.create(HerdrBridge.prototype);
    const pane = {
      id: "w1:p1",
      terminalId: "term-1",
      alive: true,
      agent: { kind: "pi", state: "idle", launchPending: true },
    };
    bridge.fleet = { panes: [pane] };
    bridge.paneChats = new Map();
    bridge.runtime = { status: "ready" };
    bridge.readPane = async () => ({ text: "pi", truncated: false });
    bridge.scheduleSnapshotRefresh = () => {};
    const writes = [];
    let rejection = new HerdrPromptNotReadyError();
    bridge.client = {
      request: async ({ method, params }) => {
        if (method === "agent.prompt") throw rejection;
        assert.equal(method, "agent.send_keys");
        writes.push(params);
        return { type: "ok" };
      },
    };
    assert.deepEqual(await bridge.sendChatPrompt(pane.id, "你 +A\n好"), { accepted: true });
    assert.deepEqual(writes, [{ target: pane.id, keys: ["你", "space", "plus", "A", "shift+enter", "好", "enter"] }]);
    for (const code of ["HERDR_AGENT_BLOCKED", "HERDR_REQUEST_TIMEOUT", "HERDR_AGENT_NOT_READY"]) {
      rejection = new HerdrBridgeError(code, "upstream error");
      await assert.rejects(bridge.sendChatPrompt(pane.id, "next"), (e) => e === rejection);
    }
    assert.equal(writes.length, 1);
  },
);

test("pi's visible trust picker blocks chat submission until the editor returns", () => {
  const picker = "Trust project folder?\n\n → Trust\n\n ↑↓ navigate  enter select  escape/ctrl+c cancel\n\n────────";
  assert.equal(piNeedsChoice(picker), true);
  assert.equal(piNeedsChoice(picker + "\n\n pi v0.84.2\n Press ctrl+o to show full startup help."), false);
  assert.equal(piNeedsChoice("Trust project folder?\nA normal answer."), false);
});

test("pi transcript preserves reasoning, tool/result pairing, final response and errors", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "serphia-herdr-turn-"));
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "turn.jsonl");
  const rows = [
    { type: "session", cwd: dir },
    { type: "message", message: { role: "user", content: "check", timestamp: 100 } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Checking the workspace" },
          { type: "toolCall", id: "t1", name: "read" },
        ],
      },
    },
    {
      type: "message",
      message: { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "file contents" }] },
    },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "**Done**" }] } },
    {
      type: "message",
      message: { role: "assistant", stopReason: "error", errorMessage: "Service unavailable", content: [] },
    },
  ];
  await writeFile(file, rows.map(JSON.stringify).join("\n"));
  const log = await readHerdrConversation({ cwd: dir, agent: { kind: "pi" } }, file);
  assert.deepEqual(log.messages, [
    { role: "user", text: "check", timestamp: 100 },
    { role: "thinking", text: "Checking the workspace" },
    { role: "tool", text: "read", toolCallId: "t1" },
    { role: "toolResult", text: "file contents", toolCallId: "t1" },
    { role: "assistant", text: "**Done**" },
    { role: "error", text: "Service unavailable" },
  ]);
});

test("Herdr chat keeps accepted prompts and attributes only new screen output to each turn", () => {
  const chat = new PaneChat();
  const baseline = "workspace\nready";
  chat.accept("first", baseline, null);
  assert.deepEqual(chat.snapshot(baseline, null).messages, [{ role: "user", text: "first" }]);
  const first = baseline + "\n› first\nfirst reply";
  chat.accept("second", first, null);
  const next = "first reply\nsecond\nsecond reply";
  assert.deepEqual(chat.snapshot(next, null).messages, [
    { role: "user", text: "first" },
    { role: "assistant", text: "first reply", source: "pane" },
    { role: "user", text: "second" },
    { role: "assistant", text: "second reply", source: "pane" },
  ]);
  assert.equal(replySincePrompt("header\nready\nfooter", "header\n› hello\nfooter", "hello"), "");
});

test("a repeated prompt waits for its own turn in the native transcript", () => {
  const chat = new PaneChat();
  const user = { role: "user", text: "again" };
  const old = { messages: [user, { role: "assistant", text: "old" }], truncated: false };
  chat.accept("again", "ready", old);
  const late = { ...old, messages: [...old.messages, { role: "tool", text: "old tool" }] };
  assert.deepEqual(chat.snapshot("ready\nagain\npending reply", late).messages, [
    ...old.messages,
    user,
    { role: "assistant", text: "pending reply", source: "pane" },
  ]);
  const current = { ...old, messages: [...late.messages, user, { role: "assistant", text: "native reply" }] };
  assert.deepEqual(chat.snapshot("ready", current), current);
});

test("chat scrollback remains bounded across long multipane sessions", () => {
  const chat = new PaneChat();
  let screen = "";
  for (let n = 0; n < 105; n++) {
    chat.accept(String(n), screen, null);
    screen += "\n" + n + "\nreceived";
  }
  const result = chat.snapshot(screen, null);
  assert.equal(result.truncated, true);
  assert.equal(result.messages.length, 80);
  assert.equal(result.messages.at(-2).text, "104");
});

test("Herdr reads only the selected local project transcript and preserves message and tool order", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "serphia-herdr-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, "work");
  const id = "0194e503-5d00-7000-8000-123456789abc";
  const date = new Date(parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toISOString().slice(0, 10).split("-");
  const cases = [
    {
      kind: "claude",
      env: "CLAUDE_CONFIG_DIR",
      rel: ["projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), id + ".jsonl"],
      rows: [
        { type: "user", cwd, message: { role: "user", content: "hello" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "hi" },
              { type: "tool_use", name: "Read", input: { secret: "hidden" } },
            ],
          },
        },
      ],
    },
    {
      kind: "codex",
      env: "CODEX_HOME",
      rel: ["sessions", ...date, "rollout-" + id + ".jsonl"],
      rows: [
        { type: "session_meta", payload: { id, cwd } },
        {
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        },
        {
          type: "response_item",
          payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
        },
        { type: "response_item", payload: { type: "function_call", name: "Read", arguments: "hidden" } },
      ],
    },
    {
      kind: "pi",
      env: "PI_CODING_AGENT_SESSION_DIR",
      rel: ["test", "session.jsonl"],
      rows: [
        { type: "session", id, cwd },
        { type: "message", message: { role: "user", content: "hello" } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "hi" },
              { type: "toolCall", name: "Read" },
            ],
          },
        },
      ],
    },
  ];
  for (const item of cases) {
    const root = path.join(dir, item.kind);
    const previous = process.env[item.env];
    process.env[item.env] = root;
    t.after(() => {
      if (previous === undefined) delete process.env[item.env];
      else process.env[item.env] = previous;
    });
    const file = path.join(root, ...item.rel);
    await mkdir(path.dirname(file), { recursive: true });
    const body = item.rows.map((row) => JSON.stringify(row)).join("\n") + "\n{";
    await writeFile(file, body);
    const pane = { cwd, agent: { kind: item.kind } };
    const log = await readHerdrConversation(pane, item.kind === "pi" ? file : id);
    assert.deepEqual(log, {
      messages: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
        { role: "tool", text: "Read" },
      ],
      truncated: false,
    });
    assert.equal(await readHerdrConversation({ ...pane, cwd: dir }, file), null);
    const outside = path.join(dir, "outside.jsonl");
    await writeFile(outside, body);
    assert.equal(await readHerdrConversation(pane, outside), null);
  }
});
