import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement, useCallback, useState } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { RpcError } from "../../contract/types.ts";

const { ChatInput, useAgentSession, api } = await importTestBundle("composer-session", {
  mainFields: ["module", "main"],
  stdin: {
    contents:
      'export {ChatInput} from "./ChatInput.tsx"; export {useAgentSession} from "../hooks/useAgentSession.ts"; export * as api from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "composer-session-transport",
      setup(build) {
        build.onResolve({ filter: /^(?:@\/lib\/api-client|\.\/api-client)$/ }, () => ({
          path: "api",
          namespace: "composer-test",
        }));
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "composer-test" }));
        build.onResolve({ filter: /^\.\/DeepAgentMenuScope$/ }, () => ({
          path: "menu-scope",
          namespace: "composer-test",
        }));
        build.onLoad({ filter: /.*/, namespace: "composer-test" }, ({ path }) => ({
          contents:
            path === "menu-scope"
              ? `
      const HoverInfo = ({ children }) => children;
      export const DeepAgentMenuScope = ({ children }) => children({ HoverInfo });
    `
              : path === "i18n"
                ? `
      const t = (_key, fallback) => fallback; export const useI18n = () => ({t, language:'en-US'});
    `
                : `
      export const requests = [], streams = [], toolReadRequests = [];
      const model = { provider: 'fixture', modelId: 'model' };
      let cwd, running, reasoningLevels;
      export function reset(directory, active, levels) {requests.length = streams.length = toolReadRequests.length = 0; cwd=directory; running=active; reasoningLevels=levels;}
      function pending(method, params, commandType) {
        return new Promise((resolve,reject) => requests.push({method,params,commandType,resolve,reject,settled:false}));
      }
      export const newAgent = params => pending('agent.new', params, 'ensure_session');
      export async function agentCommand(sessionId, command) {
        if(command.type === 'get_tools'){toolReadRequests.push(sessionId);return [];}
        if(command.type === 'get_commands')return {commands:[]};
        return pending('agent.command', {sessionId,command}, command.type);
      }
      export const agentState = async () => ({running, state:{isStreaming:running, isPromptRunning:running}});
      export const getSession = async (id) => ({sessionId:id,toolNames:[],info:{id,cwd,firstMessage:'fixture',messageCount:0},tree:[],leafId:null,
        context:{messages:[],entryIds:[],model:reasoningLevels?model:null,thinkingLevel:'off',historyRevision:'fixture',totalMessages:0,loadedMessages:0,truncatedBefore:false},agentState:await agentState()});
      export const listModels = async () => ({
        models:reasoningLevels?[{id:model.modelId,provider:model.provider,name:'Fixture model'}]:[],
        thinkingLevels:reasoningLevels?{'fixture:model':reasoningLevels}:{},
        catalog:{source:'cache',refreshed:false,aborted:false,warnings:[]},
      });
      export async function subscribeAgentEvents(key, on) {const stream={key,on,closed:0}; streams.push(stream); return()=>stream.closed++;}
      export async function subscribeSessionsChanged(on) {const stream={key:'*',on,closed:0}; streams.push(stream); return()=>stream.closed++;}
      export const fileIndex = async () => ({files:[],truncated:false});
      export const call = (method, params) => method === 'agent.generateTitle' ? pending(method, params, 'generate_title') : unexpected();
      const unexpected = async () => {throw new Error('Unexpected composer session IO');};
      export {unexpected as subscribe};
      export {unexpected as getSessionContext,unexpected as getSessionContextPage,unexpected as getSessionEntryContent,unexpected as refreshModels,unexpected as cancelModelsRefresh};
    `,
        }));
      },
    },
  ],
});

let fixtureNumber = 0;
const text = (node) => (typeof node === "string" ? node : (node?.children?.map(text).join("") ?? ""));
async function mount(
  t,
  { existing = false, running = false, directory, autoTitle = false, reasoningLevels, slashCommands } = {},
) {
  const cwd = directory ?? `/composer-fixture-${++fixtureNumber}`;
  const initialId = `existing-${fixtureNumber}`;
  const previous = new Map(
    [
      "window",
      "document",
      "localStorage",
      "navigator",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "IS_REACT_ACT_ENVIRONMENT",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const values = new Map(autoTitle ? [] : [["pi-desktop:autoSessionTitle", "off"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const frames = new Map();
  let frameId = 0;
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("localStorage", storage);
  install("navigator", { language: "en-US" });
  install("window", {
    innerHeight: 900,
    localStorage: storage,
    navigator: globalThis.navigator,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    piBridge: {
      platform: "darwin",
      inspectLocalFiles: async ({ paths }) =>
        paths.map((path) => ({ path, exists: true, isFile: true, insideCwd: true })),
    },
  });
  install("document", {
    visibilityState: "visible",
    activeElement: null,
    body: {},
    documentElement: { lang: "en-US" },
    addEventListener() {},
    removeEventListener() {},
  });
  install("requestAnimationFrame", (callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  install("cancelAnimationFrame", (id) => frames.delete(id));
  t.mock.method(console, "error", () => {});
  api.reset(cwd, running, reasoningLevels);
  const promotions = [];
  const onOpenMcpServers = slashCommands ? () => {} : undefined;
  let current, renderer;
  function Harness() {
    const [session, setSession] = useState(existing ? { id: initialId, cwd } : null);
    const onSessionCreated = useCallback((next) => {
      promotions.push(next);
      setSession(next);
    }, []);
    current = useAgentSession({
      session,
      newSessionCwd: session ? null : cwd,
      onSessionCreated,
    });
    return createElement(ChatInput, {
      cwd,
      draftKey: session?.id ?? `new:${cwd}`,
      draftPromotionFrom: !existing && session ? `new:${cwd}` : undefined,
      isStreaming: current.agentRunning || current.isCompacting,
      isCompacting: current.isCompacting,
      compactResult: current.compactResult,
      onSend: current.handleSend,
      planModeEnabled: current.extensionStatuses.some(({ key }) => key === "plan-mode"),
      planModePending: current.planModePending,
      onExitPlanMode: current.handleExitPlanMode,
      onAbort: current.isCompacting ? current.handleAbortCompaction : current.handleAbort,
      onCompact: current.handleCompact,
      compactDisabled: !session,
      onOpenMcpServers,
      slashCommands,
      onSteer: current.agentRunning ? current.handleSteer : undefined,
      onFollowUp: current.agentRunning ? current.handleFollowUp : undefined,
      onPromptWithStreamingBehavior: current.agentRunning ? current.handlePromptWithStreamingBehavior : undefined,
    });
  }
  const textarea = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    scrollHeight: 24,
    style: {},
    focus() {
      globalThis.document.activeElement = this;
    },
    blur() {
      if (globalThis.document.activeElement === this) globalThis.document.activeElement = null;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  const unmount = async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
  };
  t.after(async () => {
    await unmount();
    await act(async () => {
      for (const request of api.requests)
        if (!request.settled) {
          request.settled = true;
          request.reject(new Error("Fixture ended"));
        }
    });
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => {
    renderer = create(createElement(Harness), {
      createNodeMock: (element) => (element.type === "textarea" ? textarea : null),
    });
  });
  const next = (type) => {
    const found = api.requests.find((request) => request.commandType === type && !request.settled);
    assert.ok(found, `No pending ${type}`);
    return found;
  };
  return {
    cwd,
    values,
    promotions,
    unmount,
    next,
    get current() {
      return current;
    },
    value: () => renderer.root.findByType("textarea").props.value,
    focus: () => textarea.focus(),
    focused: () => globalThis.document.activeElement === textarea,
    text: () => text(renderer.root),
    compactDisabled: () => renderer.root.findByProps({ className: "composer-toolbar-compact" }).props.disabled,
    planClose: () => renderer.root.findAllByProps({ className: "composer-plan-mode-close" })[0]?.props,
    count: (type) => api.requests.filter((request) => request.commandType === type).length,
    async type(value) {
      textarea.value = value;
      textarea.selectionStart = textarea.selectionEnd = value.length;
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textarea }));
    },
    async enter(times = 1) {
      await act(async () => {
        const onKeyDown = renderer.root.findByType("textarea").props.onKeyDown;
        for (let i = 0; i < times; i++)
          onKeyDown({
            key: "Enter",
            currentTarget: textarea,
            shiftKey: false,
            nativeEvent: { isComposing: false, keyCode: 13 },
            preventDefault() {},
          });
      });
    },
    async click(label) {
      const button = renderer.root.findAll(
        (node) => node.type === "button" && (node.props["aria-label"] === label || text(node) === label),
      )[0];
      assert.ok(button, `No button named ${label}`);
      await act(async () => {
        void button.props.onClick();
      });
    },
    async reply(type, value) {
      const request = next(type);
      request.settled = true;
      await act(async () => request.resolve(value));
    },
    async reject(type) {
      const request = next(type);
      request.settled = true;
      await act(async () =>
        request.reject(new RpcError({ code: "CONFLICT", message: "Fixture rejected the operation" })),
      );
    },
    async emit(event) {
      await act(async () => api.streams.findLast(({ key }) => key !== "*").on(event));
    },
  };
}

test("the composer changes Plan mode without a prompt and preserves the draft and focus when closing", async (t) => {
  const f = await mount(t);
  await f.type("/plan");
  await f.enter();
  await f.reply("ensure_session", { sessionId: "plan-session" });
  assert.deepEqual(f.next("set_plan_mode").params.command, { type: "set_plan_mode", action: "toggle" });
  await f.reply("set_plan_mode", { enabled: true });
  assert.equal(f.count("prompt"), 0);
  assert.deepEqual(f.promotions, []);
  assert.equal(f.current.messages.length, 0);
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.value(), "");
  assert.equal(f.planClose().disabled, false);

  await f.type("Unsent task");
  await f.click("Exit Plan mode");
  assert.deepEqual(f.next("set_plan_mode").params.command, { type: "set_plan_mode", action: "off" });
  assert.equal(f.planClose().disabled, true);
  await f.reject("set_plan_mode");
  assert.equal(f.planClose().disabled, false);
  assert.match(f.current.notices.at(-1).message, /Could not change Plan mode/);
  assert.equal(f.value(), "Unsent task");

  await f.click("Exit Plan mode");
  await f.reply("set_plan_mode", { enabled: false });
  assert.equal(f.planClose(), undefined);
  assert.equal(f.value(), "Unsent task");
  assert.equal(f.focused(), true);
  assert.equal(f.count("prompt"), 0);
});

test("the Plan label follows runtime status updates and stays visible during a turn", async (t) => {
  const f = await mount(t, { existing: true, running: true });
  const status = { type: "extension_ui_request", method: "setStatus", id: "plan-status", statusKey: "plan-mode" };
  await f.emit({ ...status, statusText: "Read-only exploration" });
  assert.equal(f.planClose().disabled, true);
  await f.emit(status);
  assert.equal(f.planClose(), undefined);
});

test("selecting Plan mode from slash suggestions activates it on the first Enter", async (t) => {
  const f = await mount(t, {
    existing: true,
    slashCommands: [{ name: "plan", source: "extension", sourceInfo: { path: "<inline:plan-mode>" } }],
  });
  f.focus();
  await f.type("/pl");
  assert.match(f.text(), /Plan mode/);
  await f.enter();
  assert.deepEqual(f.next("set_plan_mode").params.command, { type: "set_plan_mode", action: "toggle" });
  await f.reply("set_plan_mode", { enabled: true });
  assert.equal(f.value(), "");
  assert.equal(f.focused(), true);
  assert.equal(f.count("prompt"), 0);
});

test("Enter blurs the composer only when an existing session submits a message", async (t) => {
  const f = await mount(t, { existing: true });
  f.focus();
  await f.enter();
  assert.equal(f.focused(), true);
  await f.type("hello again");
  await f.enter();
  assert.equal(f.focused(), false);
  assert.equal(f.count("prompt"), 1);
  await f.reply("prompt", null);
});

test("the composer send icon submits the draft and creates the session", async (t) => {
  const f = await mount(t);
  assert.equal(f.compactDisabled(), true);
  await f.type("send with the icon");
  await f.click("Send");
  assert.equal(f.count("ensure_session"), 1);
  await f.reply("ensure_session", { sessionId: "sent-from-button" });
  await f.reply("prompt", null);
  assert.equal(f.count("prompt"), 1);
  assert.equal(f.value(), "");
});

test("an existing reasoning model with a legacy off setting sends the next message at low", async (t) => {
  const f = await mount(t, { existing: true, reasoningLevels: ["off", "minimal", "low", "high"] });
  await f.type("hello again");
  await f.enter();
  assert.equal(f.count("prompt"), 0);
  assert.equal(f.next("set_thinking_level").params.command.level, "low");
  await f.reply("set_thinking_level", null);
  await f.reply("prompt", null);
});

test("a skill-first prompt generates a title from user text without changing the sent message", async (t) => {
  const f = await mount(t, { autoTitle: true });
  const message = "/skill:hyperframes /skill:design 生成 ROS2 介绍视频";
  await f.type(message);
  await f.enter();
  await f.reply("ensure_session", { sessionId: "skill-title-session" });
  assert.equal(f.next("prompt").params.command.message, message);
  await f.reply("prompt", null);
  assert.equal(f.next("generate_title").params.message, "生成 ROS2 介绍视频");
  await f.reply("generate_title", { title: "ROS2 介绍视频" });
});

test("a non-project conversation starts with the draft permissions and promotes the allocated directory", async (t) => {
  const f = await mount(t, { directory: "" });
  await act(async () => f.current.handleToolPresetChange("none"));
  assert.equal(f.count("ensure_session"), 0);
  await f.type("chat without a project");
  await f.click("Send");
  assert.equal(f.next("ensure_session").params.cwd, "");
  assert.deepEqual(f.next("ensure_session").params.toolNames, []);
  assert.equal(f.next("ensure_session").params.thinkingLevel, "low");
  const cwd = "/Users/demo/Documents/Serphia/2026-11-04/0123456789abcdef0123456789abcdef";
  await f.reply("ensure_session", { sessionId: "no-project", cwd });
  await f.reply("prompt", null);
  assert.equal(f.count("prompt"), 1);
  assert.equal(f.promotions.length, 1);
  assert.equal(f.promotions[0].cwd, cwd);
  assert.equal(f.value(), "");
});

test("creation failure restores the real composer draft and retry promotes the allocated ID once", async (t) => {
  const f = await mount(t);
  await f.type("create this session");
  await f.enter(2);
  assert.equal(f.count("ensure_session"), 1);
  assert.equal(f.value(), "");
  await f.reject("ensure_session");
  assert.equal(f.value(), "create this session");
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.count("prompt"), 0);
  assert.equal(f.promotions.length, 0);
  await f.enter();
  await f.reply("ensure_session", { sessionId: "created-once" });
  await f.reply("prompt", null);
  assert.equal(f.promotions.length, 1);
  assert.equal(f.promotions[0].id, "created-once");
  assert.equal(f.count("ensure_session"), 2);
  assert.equal(f.count("prompt"), 1);
  assert.equal(f.value(), "");
});

test("a failed first prompt retains the allocated session and retry does not allocate or promote it twice", async (t) => {
  const f = await mount(t);
  await f.type("first prompt");
  await f.enter();
  await f.reply("ensure_session", { sessionId: "retained-session" });
  await f.reject("prompt");
  assert.equal(f.value(), "first prompt");
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.promotions.length, 0);
  await f.enter();
  assert.equal(f.next("prompt").params.sessionId, "retained-session");
  await f.reply("prompt", null);
  assert.equal(f.count("ensure_session"), 1);
  assert.equal(f.count("prompt"), 2);
  assert.equal(f.promotions.length, 1);
});

test("a failed creation cannot overwrite text entered after the send was cleared", async (t) => {
  const f = await mount(t);
  await f.type("earlier draft");
  await f.enter();
  await f.type("newer draft");
  await f.reject("ensure_session");
  assert.equal(f.value(), "newer draft");
  assert.match(f.text(), /newer draft was kept/);
});

test("new-session promotion carries the live draft to the persistent session key", async (t) => {
  const f = await mount(t);
  await f.type("first prompt");
  await f.enter();
  await f.reply("ensure_session", { sessionId: "promoted-with-draft" });
  await f.type("next draft");
  await f.reply("prompt", null);
  assert.equal(f.value(), "next draft");
  await f.unmount();
  assert.equal(JSON.parse(f.values.get("pi-desktop-draft:promoted-with-draft")).value, "next draft");
  assert.equal(f.values.has(`pi-desktop-draft:new:${f.cwd}`), false);
});

test("streaming updates do not rerender an unchanged composer", async (t) => {
  const forwarded = ChatInput.type ?? ChatInput;
  const original = forwarded.render;
  let renders = 0;
  let previousProps;
  const changes = [];
  forwarded.render = (...args) => {
    renders++;
    if (previousProps) changes.push(Object.keys(args[0]).filter((key) => args[0][key] !== previousProps[key]));
    previousProps = args[0];
    return original(...args);
  };
  t.after(() => {
    forwarded.render = original;
  });
  const f = await mount(t, { existing: true, running: true });
  const before = renders;
  for (let i = 0; i < 20; i++) {
    await act(async () =>
      f.current.handleAgentEventRef.current({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "stream ".repeat(i + 1) }] },
      }),
    );
  }
  assert.equal(renders, before, JSON.stringify(changes.slice(before)));
  await f.type("draft typed while streaming");
  assert.equal(f.value(), "draft typed while streaming");
  assert.ok(renders > before);
});

test("restored idle sessions use persisted tools without starting an Agent command", async (t) => {
  const f = await mount(t, { existing: true });
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.current.toolPreset, "none");
  assert.deepEqual(api.toolReadRequests, []);
});

test("restored running sessions still query the active tool list", async (t) => {
  const f = await mount(t, { existing: true, running: true });
  assert.equal(f.current.agentRunning, true);
  assert.equal(api.toolReadRequests.length, 1);
});

for (const mode of ["steer", "follow_up", "queued-prompt"])
  for (const newerDraft of [false, true]) {
    test(`${mode} failure keeps the staged message and ${newerDraft ? "newer input" : "empty composer"}`, async (t) => {
      const f = await mount(t, { existing: true, running: true });
      const message = mode === "queued-prompt" ? "/fixture queued instruction" : "queue this draft";
      await f.type(message);
      assert.doesNotMatch(f.text(), /Steer|Follow-up/);
      await f.enter();
      const command = mode === "queued-prompt" ? "prompt" : mode;
      assert.equal(f.count(command), 0, "Enter only stages the message");
      assert.equal(f.value(), "");
      assert.match(f.text(), /queue this draft|fixture queued instruction/);
      await f.click(mode === "steer" ? "Steer" : "Follow-up");
      if (mode === "queued-prompt") assert.equal(f.next(command).params.command.streamingBehavior, "followUp");
      if (newerDraft) await f.type("newer queue draft");
      await f.reject(command);
      assert.equal(f.value(), newerDraft ? "newer queue draft" : "");
      assert.match(f.text(), /still waiting above/);
      assert.match(f.text(), /queue this draft|fixture queued instruction/);
      assert.equal(f.count(command), 1);
      assert.equal(f.current.agentRunning, true);
    });
  }

test("multiple staged messages remain independent until an action is selected", async (t) => {
  const f = await mount(t, { existing: true, running: true });
  await f.type("first pending");
  await f.enter();
  await f.type("second pending");
  await f.enter();
  assert.equal(f.count("steer"), 0);
  assert.equal(f.count("follow_up"), 0);
  assert.match(f.text(), /first pending/);
  assert.match(f.text(), /second pending/);
  await f.click("Steer");
  assert.equal(f.next("steer").params.command.message, "first pending");
  await f.reply("steer", null);
  assert.doesNotMatch(f.text(), /first pending/);
  assert.match(f.text(), /second pending/);
});

test("the slash menu retains MCP and extension commands after removing the old built-ins", async (t) => {
  const f = await mount(t, {
    existing: true,
    slashCommands: [{ name: "example", source: "extension", description: "Example command" }],
  });
  await f.type("/");
  assert.match(f.text(), /MCP/);
  assert.match(f.text(), /Example command/);
  assert.doesNotMatch(f.text(), /Compact|Copy|Name|Reload|Session|Todos/);
  await f.type("/name composer fixture");
  await f.enter();
  assert.equal(f.next("prompt").params.command.message, "/name composer fixture");
  assert.equal(f.count("set_session_name"), 0);
  await f.reply("prompt", null);
});

test("the compact button preserves the draft and shows the result without sending a prompt", async (t) => {
  const f = await mount(t, { existing: true });
  await f.type("Unsent draft");
  assert.equal(f.compactDisabled(), false);
  await f.click("Compact context");
  assert.deepEqual(f.next("compact").params.command, { type: "compact" });
  assert.equal(f.current.isCompacting, true);
  assert.equal(f.compactDisabled(), true);
  await f.reply("compact", { tokensBefore: 8000, estimatedTokensAfter: 2000 });
  assert.equal(f.current.isCompacting, false);
  assert.equal(f.compactDisabled(), false);
  assert.equal(f.current.compactResult.tokensBefore, 8000);
  assert.match(f.text(), /6000|6k/);
  assert.equal(f.count("prompt"), 0);
  assert.equal(f.value(), "Unsent draft");
});

test("failed compaction shows a notice and a retry can be stopped", async (t) => {
  const f = await mount(t, { existing: true });
  await f.click("Compact context");
  await f.reject("compact");
  assert.equal(f.compactDisabled(), false);
  assert.equal(f.current.notices.at(-1).type, "error");
  assert.match(f.current.notices.at(-1).message, /Fixture rejected the operation/);
  await f.click("Compact context");
  assert.equal(f.current.isCompacting, true);
  await f.click("Stop");
  assert.equal(f.count("abort_compaction"), 1);
  await f.reply("abort_compaction", null);
  await f.reply("compact", null);
  assert.equal(f.current.isCompacting, false);
  assert.equal(f.count("prompt"), 0);
});
