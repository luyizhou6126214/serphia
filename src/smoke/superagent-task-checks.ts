import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserWindow } from "electron";
import type { SuperAgentRole, SuperAgentRoom, SuperAgentTask, SuperAgentTaskInfo } from "../contract/superagent";

const fixture = String.raw`#!/usr/bin/env node
const { randomUUID } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const readline = require("node:readline");
const input = readline.createInterface({input: process.stdin});
const send = (message) => console.log(JSON.stringify(message));
const result = (id, data) => send({id, result: data});
let threadId;
let resumed = false;
input.on("line", (line) => {
  const {id, method, params} = JSON.parse(line);
  switch (method) {
    case "initialize": return result(id, {});
    case "initialized": return;
    case "model/list": return result(id, {data: []});
    case "config/read": return result(id, {config: {}});
    case "thread/resume":
    case "thread/start":
      resumed = method === "thread/resume";
      threadId = params.threadId ?? randomUUID();
      return result(id, {thread: {id: threadId}});
    case "turn/start": {
      result(id, {});
      const schema = params.outputSchema.properties;
      const prompt = params.input[0].text;
      let reply;
      if (schema.assignments) {
        const workers = JSON.parse(prompt.match(/^Available workers: (.+)$/m)[1]);
        reply = {
          assignments: workers.map(({id, name}) => ({
            memberId: id, description: "Deliver " + name, criteria: "Write the fixture file",
          })),
          question: "",
        };
      } else if (schema.tests) {
        const name = prompt.match(/^Role: (\w+)/)[1];
        writeFileSync(name.toLowerCase() + ".txt", "DELIVERED " + name + "\n");
        reply = {report: "DELIVERED " + name, tests: "Fixture file written", blocker: "", question: ""};
      } else if (schema.to) {
        if (!resumed && prompt.startsWith("You are Lead,")) return;
        reply = {message: "LEGACY_OK", to: [], question: ""};
      } else {
        reply = {report: "READY_FOR_REVIEW", question: ""};
      }
      send({method: "item/completed", params: {threadId, item: {type: "agentMessage", text: JSON.stringify(reply)}}});
      send({method: "turn/completed", params: {threadId, turn: {status: "completed"}}});
      return;
    }
    default: return send({id, error: {code: -32601, message: "Unexpected fixture request: " + method}});
  }
});
`;

export async function prepareSuperAgentTaskCli(root: string): Promise<{ codex: string; node?: string }> {
  if (process.platform === "win32") {
    const launcher = path.join(root, "codex.cmd");
    const entry = path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, fixture);
    await writeFile(launcher, "@exit /b 1\r\n");
    return { codex: launcher, node: process.env.PI_DESKTOP_RUNTIME_PROBE_NODE };
  }
  const entry = path.join(root, "codex");
  await writeFile(entry, fixture, { mode: 0o700 });
  return { codex: entry };
}

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean, description: string): Promise<T> {
  const deadline = Date.now() + 22_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() >= deadline) throw new Error(`${description}: ${JSON.stringify(value)}`);
    await delay(60);
  }
}

export async function runSuperAgentTaskSmoke(
  call: <T>(method: string, params?: unknown, timeout?: number) => Promise<T>,
  window: BrowserWindow,
): Promise<void> {
  const project = path.join(process.env.PI_DESKTOP_SMOKE_USER_DATA!, "task-project");
  await mkdir(project);
  await writeFile(path.join(project, "README.md"), "Task smoke fixture\n");
  await call("system.allowRoot", { path: project });
  const roles: SuperAgentRole[] = [];
  for (const name of ["Lead", "Frontend", "Tests"]) {
    roles.push(
      await call<SuperAgentRole>("superagent.roles.save", {
        name,
        cli: "codex",
        instructions: "Follow the smoke fixture",
        skillPaths: [],
      }),
    );
  }

  const legacy = await call<SuperAgentRoom>("superagent.rooms.create", {
    title: "Legacy room",
    project,
    roleIds: roles.slice(0, 2).map(({ id }) => id),
    starterId: roles[0].id,
    summarizerId: roles[1].id,
  });
  const getLegacy = () => call<SuperAgentRoom>("superagent.rooms.get", { id: legacy.id });
  await call("superagent.rooms.send", { id: legacy.id, text: "Legacy resume scenario" });
  await waitFor(
    getLegacy,
    (room) => room.status === "running" && Boolean(room.members.find(({ id }) => id === roles[0].id)?.nativeSessionId),
    "Wait for the legacy CLI session",
  );
  await call("superagent.rooms.stop", { id: legacy.id });
  await call("superagent.rooms.resume", { id: legacy.id });
  const resumed = await waitFor(getLegacy, (room) => room.status === "done", "Resume the legacy room");
  assert.ok(resumed.messages.some(({ text }) => text === "LEGACY_OK"));
  console.log("[superagent-tasks] legacy room stopped and resumed its CLI session");

  const room = await call<SuperAgentRoom>("superagent.rooms.create", {
    title: "Task delivery team",
    project,
    roleIds: roles.map(({ id }) => id),
    mode: "tasks",
    team: { leaderId: roles[0].id, instructions: "Delegate in one batch", responsibilities: {} },
  });
  const execute = <T>(script: string) => window.webContents.executeJavaScript(script) as Promise<T>;
  if (window.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", resolve));
  }
  await waitFor(
    () =>
      execute<boolean>(`(() => {
    const page = document.querySelector('.superagent');
    if (!page) document.querySelector('button[aria-label="SuperAgent"]')?.click();
    if (page?.querySelector('.sa-tasks form')) return true;
    [...(page?.querySelectorAll('.sa-room-link') ?? [])].find((button) =>
      button.textContent.includes('Task delivery team'))?.click();
    return false;
  })()`),
    Boolean,
    "Open the task room in the renderer",
  );
  assert.equal(
    await execute<boolean>(`(() => {
    const form = document.querySelector('.sa-tasks form');
    const [title, goal, criteria] = form.querySelectorAll('input, textarea');
    const fill = (element, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', {bubbles: true}));
    };
    fill(title, 'Review two deliveries');
    fill(goal, 'Deliver separate fixture files');
    fill(criteria, 'Inspect both diffs');
    return true;
  })()`),
    true,
  );
  await execute(`document.querySelector('.sa-tasks form').requestSubmit()`);
  const list = () => call<SuperAgentTaskInfo[]>("superagent.tasks.list", { roomId: room.id });
  const [created] = await waitFor(list, (items) => items.length === 1, "Create a task from the renderer");
  const get = () => call<SuperAgentTask>("superagent.tasks.get", { id: created.id });
  const review = await waitFor(get, (task) => task.status === "in_review", "Wait for both deliveries and the summary");
  assert.equal(review.subtasks.length, 2);
  assert.ok(review.runs.some(({ report }) => report === "READY_FOR_REVIEW"));
  await waitFor(
    () =>
      execute<boolean>(`(() => {
    const button = document.querySelector('[data-task-status="in_review"] ~ [data-task-run="work"] button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`),
    Boolean,
    "Open a worker diff in the renderer",
  );
  await waitFor(
    () => execute<boolean>(`/DELIVERED/.test(document.querySelector('.superagent-artifact[open]')?.textContent ?? '')`),
    Boolean,
    "Read the captured diff",
  );
  await execute(`document.querySelector('.superagent-artifact button').click()`);
  await waitFor(
    () =>
      execute<boolean>(`(() => {
    const button = [...document.querySelectorAll('.sa-tasks button')].find((item) =>
      ['Accept task', '通过验收'].includes(item.textContent.trim()));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`),
    Boolean,
    "Accept the task from the renderer",
  );
  await waitFor(get, (task) => task.status === "accepted", "Persist human acceptance");
  await assert.rejects(readFile(path.join(project, "frontend.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(project, "tests.txt")), { code: "ENOENT" });
  console.log("[superagent-tasks] renderer created, reviewed diffs for, and accepted a two-worker task");
}
