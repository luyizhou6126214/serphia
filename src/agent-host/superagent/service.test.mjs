import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { importTestBundle } from "#test-bundle";

const {
  SuperAgentService,
  allowFileRoot,
  parseReply,
  discoverSuperAgentCliPaths,
  setGitCommandRunner,
  workspaceEditChoice,
  codexFileEdit,
} = await importTestBundle("superagent", {
  stdin: {
    contents: `export { SuperAgentService } from './src/agent-host/superagent/service.ts';
      export { allowFileRoot } from './src/agent-host/file-access.ts';
      export { parseReply } from './src/agent-host/superagent/protocol.ts';
      export { setGitCommandRunner } from './src/shared/worktree.ts';
      export { workspaceEditChoice, codexFileEdit } from './src/agent-host/superagent/permissions.ts';
      export { discoverSuperAgentCliPaths } from './src/main/herdr/agent-cli-discovery.ts';`,
    resolveDir: path.resolve(import.meta.dirname, "../../.."),
    loader: "ts",
  },
  packages: "external",
});

function parent(clis) {
  process.parentPort ??= new EventEmitter();
  process.parentPort.postMessage = function (message) {
    process.nextTick(() =>
      this.emit("message", { data: { type: "host-rpc-result", id: message.id, ok: true, result: clis } }),
    );
  };
}

async function fixture(t, runTurn, mode = "committed") {
  const root = await mkdtemp(path.join(tmpdir(), "serphia-superagent-test-"));
  const cwd = path.join(root, "project");
  const data = path.join(root, "data");
  await mkdir(cwd);
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  if (mode !== "folder") {
    git("init");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Serphia Fixture");
    git("config", "core.autocrlf", "false");
  }
  await writeFile(path.join(cwd, "role.txt"), "original\n");
  await writeFile(
    path.join(cwd, "check.cjs"),
    'const assert = require("node:assert/strict");\nassert.match(require("node:fs").readFileSync("role.txt", "utf8").trim(), /^(Claude|Codex|DeepSeek)$/);\nconsole.log("FIXTURE_OK");\n',
  );
  if (mode !== "folder") git("add", ".");
  if (mode === "committed") git("commit", "-m", "fixture");
  allowFileRoot(cwd);
  const service = new SuperAgentService(data, () => undefined, {}, runTurn);
  t.after(async () => {
    await service.shutdown();
    await rm(root, { force: true, recursive: true });
  });
  return { cwd, data, git, service };
}

async function createRoom(service, cwd) {
  const roles = [
    ["Claude", "claude", "Codex"],
    ["Codex", "codex", "DeepSeek"],
    ["DeepSeek", "dsh", ""],
  ].map(([name, cli, next]) =>
    service.saveRole({
      name,
      cli,
      skillPaths: [],
      instructions: [
        `In this disposable QA repository, on a normal turn modify the existing role.txt to contain ${name} followed by a newline.`,
        "Run the exact command node check.cjs once in your own worktree. Report FIXTURE_OK only if the command passed.",
        next ? `Then use the structured to field to hand off to ${next}.` : "Use an empty to list.",
        "On a summary turn do not edit or run tests again. Do not modify any other files.",
      ].join(" "),
    }),
  );
  return service.createRoom({
    title: "Temporary fixture",
    project: cwd,
    roleIds: roles.map((role) => role.id),
    starterId: roles[0].id,
    summarizerId: roles[2].id,
  });
}

async function createTaskRoom(service, cwd) {
  parent({ codex: process.execPath });
  const roles = ["Lead", "Frontend", "Tests"].map((name) =>
    service.saveRole({ name, cli: "codex", skillPaths: [], instructions: `Role instructions for ${name}` }),
  );
  return service.createRoom({
    title: "Delivery team",
    project: cwd,
    roleIds: roles.map(({ id }) => id),
    mode: "tasks",
    team: {
      leaderId: roles[0].id,
      instructions: "Keep worker changes independent",
      responsibilities: Object.fromEntries(roles.map(({ id, name }) => [id, `Team responsibility for ${name}`])),
    },
  });
}

const assignment = (memberId) => ({ memberId, description: "Deliver a change", criteria: "Report the test result" });
const plan = (...members) => ({ assignments: members.map(({ id }) => assignment(id)), question: "" });
const delivery = (report = "Delivered") => ({ report, tests: "Fixture checks passed", blocker: "", question: "" });
const summary = { report: "Ready for human review", question: "" };

function createTask(service, room, title = "Ship change") {
  return service.tasks.create({
    roomId: room.id,
    title,
    goal: "Ship independently testable work",
    criteria: "Review the diffs",
  });
}

async function taskWhen(service, id, predicate) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const task = service.tasks.get(id);
    if (predicate(task)) return task;
    assert.ok(Date.now() < deadline, JSON.stringify(task));
    await delay(20);
  }
}

test("task room delegates in parallel, records per-run approvals, saves committed diffs and re-runs only returned work", async (t) => {
  let room;
  let summaryCount = 0;
  const started = [];
  const { service, cwd, git, data } = await fixture(t, async (turn) => {
    const { prompt, outputSchema } = turn;
    if (outputSchema.properties.assignments) {
      assert.match(prompt, /Keep worker changes independent/);
      assert.match(prompt, /Team responsibility for Frontend/);
      return plan(...room.members.slice(1));
    }
    if (!outputSchema.properties.tests) {
      assert.match(prompt, /Fixture checks passed/);
      summaryCount++;
      return summary;
    }
    const name = prompt.startsWith("Role: Frontend") ? "Frontend" : "Tests";
    const { cwd: assigned } = turn;
    assert.equal(prompt.includes("Keep worker changes independent"), false);
    started.push({ name, cwd: assigned, session: turn.sessionId });
    turn.session(`session-${name}`);
    if (!turn.sessionId) {
      assert.equal(
        await turn.approval({ title: `${name} tool`, options: [{ id: "once", label: "Allow once" }] }),
        "once",
      );
    } else {
      assert.match(prompt, /Make the requested adjustment/);
    }
    await writeFile(path.join(assigned, "role.txt"), `${name} delivery ${started.length}\n`);
    if (name === "Frontend" && !turn.sessionId) {
      execFileSync("git", ["-C", assigned, "commit", "-am", "Deliver frontend"], { stdio: "pipe" });
    }
    return delivery(name);
  });
  room = await createTaskRoom(service, cwd);
  assert.equal(room.mode, "tasks");
  assert.throws(() => service.send(room.id, "old path"), /task controls/);
  const [created, duplicate] = await Promise.allSettled([createTask(service, room), createTask(service, room)]);
  assert.equal(created.status, "fulfilled");
  assert.equal(duplicate.status, "rejected");
  const taskId = created.value.id;
  const waiting = await taskWhen(
    service,
    taskId,
    (task) => task.runs.filter((run) => run.approvals?.length).length === 2,
  );
  assert.equal(waiting.base, git("rev-parse", "HEAD"));
  assert.equal(waiting.status, "waiting");
  const [a, b] = waiting.runs.filter((run) => run.approvals?.length);
  assert.throws(() => service.tasks.decide(taskId, a.id, b.approvals[0].id, "once"), /no longer active/);
  service.tasks.decide(taskId, a.id, a.approvals[0].id, "once");
  assert.equal(service.tasks.get(taskId).runs.find((run) => run.id === b.id).status, "approval");
  service.tasks.decide(taskId, b.id, b.approvals[0].id, "once");
  const review = await taskWhen(service, taskId, (task) => task.status === "in_review");
  assert.equal(summaryCount, 1);
  assert.deepEqual(review.overlaps, ["role.txt"]);
  assert.equal(review.runs.filter((run) => run.artifact).length, 2);
  assert.equal(new Set(started.map((entry) => entry.cwd)).size, 2);
  const [first, second] = review.subtasks;
  const original = service.tasks.artifact(taskId, first.runId);
  assert.match(original.diff, /\+Frontend delivery/);
  assert.ok(original.branch);
  assert.deepEqual(original.paths, ["role.txt"]);
  service.tasks.review(taskId, {
    decision: "return",
    summaryRunId: review.summaryRunId,
    subtaskIds: [first.id],
    note: "Make the requested adjustment",
  });
  const secondReview = await taskWhen(service, taskId, (task) => task.status === "in_review");
  assert.equal(secondReview.subtasks[1].runId, second.runId);
  assert.notEqual(secondReview.subtasks[0].runId, first.runId);
  assert.equal(started.at(-1).session, "session-Frontend");
  assert.equal(started.at(-1).cwd, original.cwd);
  assert.equal(started.length, 3);
  assert.equal(summaryCount, 2);
  assert.throws(
    () => service.tasks.review(taskId, { decision: "accept", summaryRunId: review.summaryRunId }),
    /deliveries have changed/,
  );
  const accepted = service.tasks.review(taskId, { decision: "accept", summaryRunId: secondReview.summaryRunId });
  assert.equal(accepted.status, "accepted");
  assert.equal(git("status", "--porcelain"), "");
  assert.deepEqual(service.tasks.artifact(taskId, first.runId), original);
  const restored = new SuperAgentService(data, () => undefined, {});
  assert.equal(restored.tasks.get(taskId).status, "accepted");
  assert.deepEqual(restored.tasks.artifact(taskId, first.runId), original);
});

test("task mode validates delegation atomically and retries only the blocked worker in a folder snapshot", async (t) => {
  let room;
  let planning = 0;
  let frontend = 0;
  let tests = 0;
  const { service, cwd } = await fixture(
    t,
    async ({ outputSchema, prompt, cwd: assigned }) => {
      if (outputSchema.properties.assignments) {
        planning++;
        if (planning === 1) return plan(room.members[0], room.members[1]);
        if (planning === 2) return plan(room.members[1], room.members[1]);
        if (planning === 3) return { assignments: [], question: "What should change?" };
        assert.match(prompt, /Keep the original folder intact/);
        return plan(...room.members.slice(1));
      }
      if (!outputSchema.properties.tests) return summary;
      if (prompt.startsWith("Role: Tests")) {
        tests++;
        return delivery();
      }
      frontend++;
      if (frontend === 1) {
        return { report: "", tests: "", blocker: "Missing fixture", question: "" };
      }
      assert.equal(await readFile(path.join(assigned, "role.txt"), "utf8"), "original\n");
      await writeFile(path.join(assigned, "role.txt"), "folder delivery\n");
      return delivery();
    },
    "folder",
  );
  room = await createTaskRoom(service, cwd);
  const created = await createTask(service, room);
  assert.equal(created.base, null);
  for (let i = 0; i < 2; i++) {
    const blocked = await taskWhen(service, created.id, (task) => task.status === "blocked");
    assert.equal(blocked.subtasks.length, 0);
    assert.match(blocked.runs.find((run) => run.id === blocked.planRunId).error, /unknown or duplicate/);
    service.tasks.retry(created.id, blocked.planRunId);
  }
  const question = await taskWhen(service, created.id, (task) => task.status === "waiting");
  service.tasks.answer(created.id, question.planRunId, "Keep the original folder intact");
  const blocked = await taskWhen(service, created.id, (task) => task.status === "blocked");
  const failure = blocked.runs.find((run) => run.status === "blocked");
  assert.equal(failure.error, "Missing fixture");
  service.tasks.retry(created.id, failure.id);
  const review = await taskWhen(service, created.id, (task) => task.status === "in_review");
  assert.equal(tests, 1);
  assert.equal(frontend, 2);
  assert.equal(await readFile(path.join(cwd, "role.txt"), "utf8"), "original\n");
  assert.match(service.tasks.artifact(created.id, review.subtasks[0].runId).diff, /\+folder delivery/);
});

test("host reload pauses unfinished runs and resumes with the same assignment and native session", async (t) => {
  let room;
  let pendingStarted;
  const started = new Promise((resolve) => {
    pendingStarted = resolve;
  });
  const { service, cwd, data } = await fixture(
    t,
    async (turn) => {
      if (turn.outputSchema.properties.assignments) return plan(...room.members.slice(1));
      if (turn.prompt.startsWith("Role: Tests")) return delivery();
      turn.session("durable-session");
      pendingStarted();
      await delay(60_000, undefined, { signal: turn.signal });
      return delivery();
    },
    "folder",
  );
  room = await createTaskRoom(service, cwd);
  const created = await createTask(service, room);
  await started;
  const before = await taskWhen(service, created.id, (task) =>
    task.runs.some((run) => run.status === "succeeded" && run.kind === "work"),
  );
  const record = path.join(data, `${created.id}.task.json`);
  const interrupted = await readFile(record);
  await service.tasks.shutdown();
  // Restore the last on-disk state before shutdown to exercise crash recovery.
  await writeFile(record, interrupted);
  const executed = [];
  const restored = new SuperAgentService(
    data,
    () => undefined,
    {},
    async (turn) => {
      executed.push(turn.prompt.split("\n")[0]);
      if (!turn.outputSchema.properties.tests) return summary;
      assert.equal(turn.sessionId, "durable-session");
      return delivery();
    },
  );
  t.after(() => restored.shutdown());
  const paused = restored.tasks.get(created.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.runs.filter((run) => run.status === "interrupted").length, 1);
  assert.deepEqual(executed, []);
  restored.tasks.resume(created.id);
  const recovered = await taskWhen(restored, created.id, (task) => task.status === "in_review");
  assert.equal(recovered.subtasks[1].runId, before.subtasks[1].runId);
  assert.deepEqual(executed, ["Role: Frontend", "Role: Lead"]);
});

test("task rooms share two execution slots and release a slot when a run is paused", async (t) => {
  let active = 0;
  let peak = 0;
  const { service, cwd } = await fixture(
    t,
    async ({ signal }) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(60_000, undefined, { signal });
      } finally {
        active--;
      }
    },
    "folder",
  );
  const first = await createTaskRoom(service, cwd);
  const makeRoom = (number) =>
    service.createRoom({
      title: `Team ${number}`,
      project: cwd,
      roleIds: first.members.map(({ id }) => id),
      mode: "tasks",
      team: first.team,
    });
  const second = await makeRoom(2);
  const third = await makeRoom(3);
  const initial = await createTask(service, first);
  const concurrent = await createTask(service, second);
  const queued = await createTask(service, third);
  assert.equal(queued.status, "queued");
  await taskWhen(service, queued.id, () => active === 2);
  await service.tasks.stop(initial.id, "paused");
  const next = await taskWhen(service, queued.id, (task) => task.status === "running");
  assert.equal(next.runs.length, 1);
  assert.equal(service.tasks.get(concurrent.id).status, "running");
  assert.equal(peak, 2);
  await service.tasks.stop(concurrent.id, "cancelled");
  await service.tasks.stop(queued.id, "cancelled");
});

test("only validated reply envelopes can route a turn, with duplicate recipients collapsed", () => {
  assert.equal(parseReply("@Codex please continue"), null);
  assert.equal(parseReply('{"message":"hello","to":[1],"question":""}'), null);
  assert.equal(parseReply('{"message":"hello","to":[],"question":"","unrecognized":1}'), null);
  assert.deepEqual(parseReply('```json\n{"message":"你好","to":["codex","codex"],"question":""}\n```'), {
    message: "你好",
    to: ["codex"],
    question: "",
  });
});

test("room worktrees use the selected commit, expose new files, and survive a Host reload", async (t) => {
  parent({ claude: process.execPath, codex: process.execPath, dsh: process.execPath });
  const { cwd, data, git, service } = await fixture(t);
  await writeFile(path.join(cwd, "role.txt"), "uncommitted user change\n");
  const room = await createRoom(service, cwd);
  assert.equal(room.base, git("rev-parse", "HEAD"));
  assert.equal(new Set(room.members.map((member) => member.cwd)).size, 3);
  for (const member of room.members)
    assert.equal(await readFile(path.join(member.cwd, "role.txt"), "utf8"), "original\n");
  await writeFile(path.join(room.members[0].cwd, "new.txt"), "different worktree\n");
  const artifact = await service.artifact(room.id, room.members[0].id);
  assert.ok(artifact.diff.includes("+different worktree"));
  assert.equal((await service.artifact(room.id, room.members[1].id)).diff, "");
  assert.equal(await readFile(path.join(cwd, "role.txt"), "utf8"), "uncommitted user change\n");
  const restored = new SuperAgentService(data, () => undefined, {});
  assert.deepEqual(restored.getRoom(room.id), service.getRoom(room.id));
});

for (const mode of ["unborn", "folder", "git-unavailable"]) {
  test(`directory copies support ${mode} projects and report changes against their baseline`, async (t) => {
    parent({ claude: process.execPath, codex: process.execPath, dsh: process.execPath });
    let room;
    const { cwd, data, git, service } = await fixture(
      t,
      async (turn) => {
        assert.equal(turn.cwd, room.members.find((member) => member.cli === turn.cli).cwd);
        assert.match(turn.prompt, /assigned local directory copy/);
        if (turn.cli === "claude") {
          await writeFile(path.join(turn.cwd, "role.txt"), "changed!\n");
          return { message: "Edited", to: [room.members[1].id], question: "" };
        }
        if (turn.cli === "codex") assert.match(turn.prompt, /\+changed!/);
        return { message: "Done", to: [], question: "" };
      },
      mode === "unborn" ? mode : "folder",
    );
    if (mode === "git-unavailable") {
      t.after(
        setGitCommandRunner({
          async run() {
            throw Object.assign(new Error("Git not installed"), { code: "TOOLCHAIN_GIT_REQUIRED" });
          },
        }),
      );
    }

    if (mode === "folder") {
      await symlink(
        path.dirname(cwd),
        path.join(cwd, "external-link"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    room = await createRoom(service, cwd);
    assert.equal(room.base, null);
    assert.equal(new Set(room.members.map((member) => member.cwd)).size, 3);
    for (const member of room.members) {
      assert.equal(member.branch, null);
      assert.equal(await readFile(path.join(member.cwd, "role.txt"), "utf8"), "original\n");
      await assert.rejects(access(path.join(member.cwd, ".git")), { code: "ENOENT" });
      await assert.rejects(access(path.join(member.cwd, "external-link")), { code: "ENOENT" });
    }
    if (mode === "unborn") {
      assert.throws(() => git("rev-parse", "--verify", "HEAD"));
      assert.equal(git("status", "--porcelain"), "A  check.cjs\nA  role.txt");
    } else {
      await assert.rejects(access(path.join(cwd, ".git")), { code: "ENOENT" });
    }

    if (mode === "folder") {
      service.send(room.id, "Check the fixture without Git");
      await waitForRoom(service, room, "done");
    } else {
      await writeFile(path.join(room.members[0].cwd, "role.txt"), "changed!\n");
    }
    assert.equal(await readFile(path.join(cwd, "role.txt"), "utf8"), "original\n");
    await writeFile(path.join(cwd, "role.txt"), "edited after snapshot\n");
    await writeFile(path.join(room.members[0].cwd, "new.txt"), "new\n");
    await rm(path.join(room.members[0].cwd, "check.cjs"));
    const artifact = await service.artifact(room.id, room.members[0].id);
    assert.equal(artifact.status.isGit, false);
    assert.deepEqual(
      artifact.status.entries.map((entry) => [entry.path, entry.workingTree]),
      [
        ["check.cjs", "D"],
        ["new.txt", "A"],
        ["role.txt", "M"],
      ],
    );
    assert.match(artifact.diff, /-original\n\+changed!/);
    assert.doesNotMatch(artifact.diff, /edited after snapshot/);
    assert.equal((await service.artifact(room.id, room.members[1].id)).status.clean, true);
    const restored = new SuperAgentService(data, () => undefined, {});
    assert.deepEqual(restored.getRoom(room.id), service.getRoom(room.id));
    assert.deepEqual(await restored.artifact(room.id, room.members[0].id), artifact);
  });
}

async function waitForRoom(service, room, status) {
  const deadline = Date.now() + 6_000;
  for (;;) {
    const current = service.getRoom(room.id);
    if (current.status === status) return current;
    assert.ok(Date.now() < deadline, `Expected ${status}, got ${current.status}: ${current.messages.at(-1)?.text}`);
    await delay(20);
  }
}

test("declining permission resumes the role and duplicate handoffs run only once", async (t) => {
  const calls = [];
  let room;
  const { service, cwd } = await fixture(t, async (turn) => {
    calls.push(turn.cli);
    if (turn.cli !== "claude") return { message: "@Claude is only text", to: [], question: "" };
    const denied = await turn.approval({ title: "fixture", options: [{ id: "deny", label: "Deny" }] });
    assert.equal(denied, "deny");
    const target = room.members[1].id;
    return { message: "Continuing after denial", to: [target, target, "unknown"], question: "" };
  });
  room = await createRoom(service, cwd);
  service.send(room.id, "Check the fixture");
  const paused = await waitForRoom(service, room, "approval");
  assert.deepEqual(calls, ["claude"]);
  assert.throws(() => service.decide(room.id, paused.approval.id, "allow"), /choice is invalid/);
  service.decide(room.id, paused.approval.id, "deny");
  const finished = await waitForRoom(service, room, "done");
  assert.deepEqual(calls, ["claude", "codex", "dsh"]);
  assert.deepEqual(finished.messages.find((message) => message.author === room.members[0].id).to, [room.members[1].id]);
});

test("enabling local edits resumes a pending edit, without approving commands or another member's files", async (t) => {
  parent({ claude: process.execPath, codex: process.execPath, dsh: process.execPath });
  let room;
  const options = [
    { id: "allow", label: "Allow once" },
    { id: "deny", label: "Deny" },
  ];
  const { service, cwd, data } = await fixture(
    t,
    async (turn) => {
      if (turn.cli !== "claude") return { message: "Done", to: [], question: "" };
      const edit = (file) =>
        turn.approval({
          title: "Edit",
          options,
          workspaceEdit: { paths: [file], allowChoice: "allow" },
        });
      const pending = [
        edit(path.join(turn.cwd, "role.txt")),
        turn.approval({ title: "Shell", options }),
        edit(path.join(room.members[1].cwd, "role.txt")),
        edit("new.txt"),
      ];
      assert.deepEqual(await Promise.all(pending), ["allow", "deny", "deny", "allow"]);
      return { message: "Edited", to: [], question: "" };
    },
    "folder",
  );
  room = await createRoom(service, cwd);
  assert.equal(room.permissionMode, "ask");
  assert.throws(() => service.setPermissionMode(room.id, "unrestricted"), /Unknown permission mode/);
  service.setPermissionMode(room.id, "workspaceEdits");
  const reopened = new SuperAgentService(data, () => undefined, {});
  assert.equal(reopened.getRoom(room.id).permissionMode, "ask");
  service.setPermissionMode(room.id, "ask");
  service.send(room.id, "Edit the local fixture");
  assert.equal((await waitForRoom(service, room, "approval")).approval?.title, "Edit");
  const shell = service.setPermissionMode(room.id, "workspaceEdits");
  assert.equal(shell.approval?.title, "Shell");
  assert.equal(shell.permissionMode, "workspaceEdits");
  const outside = service.decide(room.id, shell.approval.id, "deny");
  assert.equal(outside.approval?.title, "Edit");
  service.decide(room.id, outside.approval.id, "deny");
  assert.equal((await waitForRoom(service, room, "done")).permissionMode, "ask");
});

test("workspace auto-approval accepts ordinary file edits and leaves ambiguous paths and broader grants pending", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "serphia-approval-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "role");
  await mkdir(cwd);
  await writeFile(path.join(root, "outside.txt"), "outside");
  await link(path.join(root, "outside.txt"), path.join(cwd, "linked.txt"));
  await symlink(root, path.join(cwd, "junction"), process.platform === "win32" ? "junction" : "dir");
  const choice = (...targets) => workspaceEditChoice(cwd, { paths: targets, allowChoice: "allow" });
  assert.equal(choice(path.join(cwd, "new.txt"), "new-dir/file.txt"), "allow");
  assert.equal(choice("."), undefined);
  assert.equal(choice("good.txt", "../outside.txt"), undefined);
  assert.equal(choice(path.join(root, "outside.txt")), undefined);
  assert.equal(choice("junction/outside.txt"), undefined);
  assert.equal(choice("linked.txt"), undefined);
  assert.equal(choice(".git/config"), undefined);
  if (process.platform === "win32") {
    assert.equal(choice("C:wrong.txt"), undefined);
    assert.equal(choice("foo.txt:secret"), undefined);
    assert.equal(choice("NUL.txt"), undefined);
  }
  const patch = (kind) => ({ type: "fileChange", changes: [{ path: "file.txt", kind }] });
  assert.deepEqual(codexFileEdit({ grantRoot: null }, patch({ type: "update", move_path: null })), {
    paths: ["file.txt"],
    allowChoice: "allow",
  });
  assert.equal(codexFileEdit({ grantRoot: root }, patch({ type: "add" })), undefined);
  assert.equal(codexFileEdit({}, patch({ type: "delete" })), undefined);
  assert.equal(codexFileEdit({}, patch({ type: "update", move_path: "other.txt" })), undefined);
});

test("stop waits for the role to exit and a new Host resumes the saved session", async (t) => {
  let first = true;
  const sessionId = "fixture-native-session";
  const runTurn = async (turn) => {
    if (first) {
      first = false;
      turn.session(sessionId);
      await new Promise((_, reject) =>
        turn.signal.addEventListener("abort", () => reject(turn.signal.reason), { once: true }),
      );
    }
    if (turn.cli === "claude") assert.equal(turn.sessionId, sessionId);
    return { message: "Work preserved", to: [], question: "" };
  };
  const { service, cwd, data } = await fixture(t, runTurn);
  const room = await createRoom(service, cwd);
  service.send(room.id, "Start the fixture");
  const deadline = Date.now() + 5_000;
  while (!service.getRoom(room.id).members[0].nativeSessionId) {
    assert.ok(Date.now() < deadline, "The first role never started");
    await delay(20);
  }
  assert.equal((await service.stop(room.id)).status, "stopped");
  const restored = new SuperAgentService(data, () => undefined, {}, runTurn);
  t.after(() => restored.shutdown());
  assert.equal(restored.getRoom(room.id).members[0].nativeSessionId, sessionId);
  await restored.resume(room.id);
  await waitForRoom(restored, room, "done");
});

test(
  "three installed CLIs edit and test separate worktrees through a real handoff",
  {
    skip: process.env.SERPHIA_SUPERAGENT_LIVE !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const clis = await discoverSuperAgentCliPaths({ homeDir: homedir() });
    assert.ok(clis.claude && clis.codex && clis.dsh, "Install and sign in to all three official CLIs first");
    parent(clis);
    const { cwd, git, service } = await fixture(t);
    const room = await createRoom(service, cwd);
    service.send(
      room.id,
      "Use the test fixture to edit role.txt and run node check.cjs, then hand off in order Claude, Codex, DeepSeek. DeepSeek also summarizes. Only modify role.txt.",
    );
    let snapshot;
    do {
      await delay(250);
      snapshot = service.getRoom(room.id);
      if (snapshot.approval) {
        const { id, memberId, title, detail = "", options } = snapshot.approval;
        const member = snapshot.members.find((value) => value.id === memberId);
        assert.ok(member);
        const allow = options.find((option) => option.id === "allow" || /allow once/i.test(option.label));
        let safe = detail.trim() === "node check.cjs" || detail.startsWith("node check.cjs\n");
        if (title === "Codex file changes")
          safe = path.resolve(member.cwd, detail.split("\n")[0] ?? "") === path.join(member.cwd, "role.txt");
        if (title === "Codex command") safe = /^[\s\S]*?-Command\s+["']?node check\.cjs["']?(?:\n|$)/iu.test(detail);
        try {
          const data = JSON.parse(detail);
          if (["Write", "Edit"].includes(title))
            safe = path.resolve(data.file_path) === path.join(member.cwd, "role.txt");
          if (data?.command === "node check.cjs") safe = true;
        } catch {
          /* The adapter can present a plain-text command. */
        }
        assert.ok(allow && safe, `Unexpected approval (${title}): ${detail}`);
        service.decide(room.id, id, allow.id);
      }
    } while (snapshot.status === "running" || snapshot.status === "approval");
    assert.equal(snapshot.status, "done", snapshot.messages.map((message) => message.text).join("\n"));
    for (const member of snapshot.members) {
      assert.ok(member.nativeSessionId);
      assert.equal((await readFile(path.join(member.cwd, "role.txt"), "utf8")).trim(), member.name);
      assert.ok(
        snapshot.messages.some((message) => message.author === member.id && /FIXTURE_OK/.test(message.text)),
        member.name,
      );
    }
    assert.ok(snapshot.messages.some((message) => message.summary));
    assert.equal(git("status", "--porcelain"), "");
  },
);
