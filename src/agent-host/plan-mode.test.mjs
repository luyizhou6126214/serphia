import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
import { PLAN_REVIEW_CHOICES } from "../shared/plan-mode.ts";

const { AgentSessionWrapper, createPlanModeExtension, createSessionTodoExtension } = await importTestBundle(
  "desktop-plan-mode",
  {
    packages: "external",
    stdin: {
      resolveDir: import.meta.dirname,
      loader: "ts",
      contents: `
        export { AgentSessionWrapper } from "./rpc-manager.ts";
        export { createPlanModeExtension } from "./plan-mode.ts";
        export { createSessionTodoExtension } from "./session-todo.ts";
      `,
    },
  },
);

async function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "serphia-plan-"));
  const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
  const planMode = createPlanModeExtension();
  const services = await createAgentSessionServices({
    cwd,
    agentDir: cwd,
    settingsManager: SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } }),
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      extensionFactories: [planMode, createSessionTodoExtension()],
    },
  });
  await services.modelRuntime.setRuntimeApiKey("anthropic", "offline-fixture-key");
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    model: services.modelRuntime.getModel("anthropic", "claude-sonnet-4-5"),
  });
  const wrapper = new AgentSessionWrapper(
    session,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    planMode,
  );
  wrapper.start();
  t.after(async () => {
    await wrapper.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  const requests = [];
  const replies = [];
  session.agent.streamFunction = (model, context) => {
    requests.push(context.messages);
    const reply = replies.shift();
    assert.ok(reply, "unexpected model request");
    const message = {
      role: "assistant",
      content: typeof reply === "string" ? [{ type: "text", text: reply }] : [reply],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: typeof reply === "string" ? "stop" : "toolUse",
      timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: message.stopReason, message });
    stream.end();
    return stream;
  };

  const waitFor = (predicate) =>
    new Promise((resolve) => {
      const unsubscribe = wrapper.onEvent((event) => {
        if (!predicate(event)) return;
        globalThis.queueMicrotask(() => unsubscribe());
        resolve(event);
      });
    });
  const prompt = async (message) => {
    const done = waitFor((event) => event.type === "prompt_done");
    await wrapper.send({ type: "prompt", message });
    await done;
  };
  const respond = (request, value) => wrapper.send({ type: "extension_ui_response", id: request.id, value });
  const waitForDialog = (method) =>
    waitFor((event) => event.type === "extension_ui_request" && event.method === method);
  const planEnabled = async () =>
    (await wrapper.send({ type: "get_state" })).extensionStatuses.some(({ key }) => key === "plan-mode");
  return { cwd, manager, requests, replies, session, wrapper, prompt, respond, waitForDialog, planEnabled };
}

test(
  "Pi SDK projects read-only tools and rejects undeclared writes until the user approves the full plan",
  { timeout: 20_000 },
  async (t) => {
    const f = await fixture(t);
    const { commands } = await f.wrapper.send({ type: "get_commands" });
    assert.ok(commands.some(({ name, sourceInfo }) => name === "plan" && sourceInfo.path === "<inline:plan-mode>"));
    f.session.setActiveToolsByName(["read", "bash", "write", "todo"]);
    const normalTools = f.session.getActiveToolNames();
    await f.prompt("/plan");
    assert.equal(await f.planEnabled(), true);
    assert.equal(f.requests.length, 0);

    const output = path.join(f.cwd, "should-not-exist.txt");
    f.replies.push(
      { type: "toolCall", id: "blocked_write", name: "write", arguments: { path: output, content: "bad" } },
      "先说明原因。\n\n## 计划：\n1. 检查 `src/agent.ts` 并保留现有接口。\n   补充说明和验收细节。\n2. 运行相关测试。",
      "## 計畫：\n1. 保留 `src/agent.ts` 的公共接口。\n   補充跨平台驗證，再執行回歸測試。",
      "Implemented after approval.",
    );
    const firstDialog = f.waitForDialog("select");
    const turn = f.prompt("帮我制定修改计划");
    const review = await firstDialog;
    await assert.rejects(f.wrapper.send({ type: "set_plan_mode", action: "off" }), /Wait for the current turn/);
    assert.equal(await f.planEnabled(), true);
    assert.match(review.plan, /补充说明和验收细节/);
    assert.doesNotMatch(review.plan, /先说明原因/);
    assert.equal(existsSync(output), false);
    const blocked = f.manager
      .getBranch()
      .find(({ type, message }) => type === "message" && message.role === "toolResult");
    assert.match(blocked.message.content[0].text, /Plan mode/);
    assert.deepEqual(
      f.requests.slice(0, 2).map((messages) => getCurrentTools(messages).map(({ name }) => name)),
      [["read"], ["read"]],
    );
    assert.ok(f.requests[0].some((message) => JSON.stringify(message.content).includes("Plan mode is active")));
    assert.deepEqual(f.session.getActiveToolNames(), normalTools);

    const refineDialog = f.waitForDialog("input");
    await f.respond(review, PLAN_REVIEW_CHOICES.refine);
    const updatedDialog = f.waitForDialog("select");
    await f.respond(await refineDialog, "补充跨平台验证");
    const updatedReview = await updatedDialog;
    assert.equal(await f.planEnabled(), true);
    assert.deepEqual(
      getCurrentTools(f.requests[2]).map(({ name }) => name),
      ["read"],
    );
    assert.match(updatedReview.plan, /補充跨平台驗證，再執行回歸測試/);
    f.session.setActiveToolsByName(["read", "write", "todo"]);
    await f.respond(updatedReview, PLAN_REVIEW_CHOICES.execute);
    await turn;

    assert.equal(await f.planEnabled(), false);
    assert.deepEqual(
      getCurrentTools(f.requests[3]).map(({ name }) => name),
      ["read", "write", "todo"],
    );
    assert.doesNotMatch(JSON.stringify(f.requests[3]), /Plan mode is active/);
    assert.match(JSON.stringify(f.requests[3]), /補充跨平台驗證，再執行回歸測試/);
    assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message").length, 0);
  },
);

test("the composer command closes Plan mode idempotently and restores tools without a model turn", async (t) => {
  const f = await fixture(t);
  const sendMode = (action) => f.wrapper.send({ type: "set_plan_mode", action });
  f.session.setActiveToolsByName(["read", "write"]);
  await assert.rejects(sendMode("invalid"), { code: "BAD_REQUEST" });
  assert.deepEqual(await sendMode("toggle"), { enabled: true });
  assert.equal(await f.planEnabled(), true);
  f.replies.push("Looking through the code.", "Ready to make changes.");
  await f.prompt("Inspect the code");
  await f.wrapper.send({ type: "reload" });
  assert.equal(await f.planEnabled(), true);
  assert.deepEqual(await sendMode("off"), { enabled: false });
  assert.deepEqual(await sendMode("off"), { enabled: false });
  assert.equal(await f.planEnabled(), false);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(
    f.manager
      .getEntries()
      .filter(({ customType }) => customType === "plan-mode")
      .map(({ data }) => data),
    [{ enabled: true }, { enabled: false }],
  );
  assert.deepEqual(
    getCurrentTools(f.requests[0]).map(({ name }) => name),
    ["read"],
  );
  f.session.setActiveToolsByName(["read", "write"]);
  await f.prompt("Make the changes");
  assert.deepEqual(
    getCurrentTools(f.requests[1]).map(({ name }) => name),
    ["read", "write"],
  );
});

test(
  "Plan mode survives reload and a cancelled review without triggering execution",
  { timeout: 20_000 },
  async (t) => {
    const f = await fixture(t);
    await f.prompt("/plan");
    f.replies.push("```md\nPlan:\n1. A quoted example\n```", "Plan:\n1. Inspect the code.", "Plan:\n1. Add a test.");
    await f.prompt("Show the plan format");
    await f.wrapper.send({ type: "reload" });
    assert.equal(await f.planEnabled(), true);

    const firstDialog = f.waitForDialog("select");
    const firstTurn = f.prompt("Propose a plan");
    await f.respond(await firstDialog, PLAN_REVIEW_CHOICES.stay);
    await firstTurn;
    assert.equal(await f.planEnabled(), true);
    assert.equal(f.requests.length, 2);

    const dialog = f.waitForDialog("select");
    const turn = f.prompt("Propose a different plan");
    const review = await dialog;
    const dismissed = f.waitForDialog("dismissDialog");
    await f.wrapper.send({ type: "abort" });
    assert.equal((await dismissed).id, review.id);
    await turn;
    assert.equal(await f.planEnabled(), true);
    assert.equal(f.requests.length, 3);
    await f.prompt("/plan");
    assert.equal(await f.planEnabled(), false);
    const restored = SessionManager.open(f.manager.getSessionFile());
    assert.equal(restored.getEntries().findLast((entry) => entry.customType === "plan-mode").data.enabled, false);
  },
);
