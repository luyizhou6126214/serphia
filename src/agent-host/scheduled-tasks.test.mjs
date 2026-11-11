import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { firstScheduleTarget, consumeScheduleTarget } from "./schedule-recurrence.ts";
import { importTestBundle } from "#test-bundle";

const { ScheduledTasks } = await importTestBundle("scheduled-tasks", {
  entryPoints: [path.join(import.meta.dirname, "scheduled-tasks.ts")],
  packages: "external",
});

async function waitFor(predicate) {
  const until = Date.now() + 5_000;
  while (!(await predicate())) {
    assert.ok(Date.now() < until, "timed out waiting for the scheduler");
    await delay(10);
  }
}

async function storage(t) {
  const folder = await mkdtemp(path.join(tmpdir(), "serphia-schedule-"));
  t.after(() => rm(folder, { force: true, recursive: true }));
  return path.join(folder, "scheduled-tasks.json");
}

const server = { emit() {} };
const draft = {
  name: "Check the project",
  prompt: "Summarize the recent changes",
  sessionId: "original-session",
  rule: { kind: "interval", minutes: 10 },
};

test("wall-clock recurrence skips the DST gap and uses the earlier instant in the overlap", () => {
  const rule = { kind: "weekly", weekdays: [7], time: "02:30", timeZone: "America/New_York" };
  assert.equal(firstScheduleTarget(rule, Date.parse("2026-03-08T00:00:00Z")), Date.parse("2026-03-15T06:30:00Z"));
  const fall = { ...rule, time: "01:30" };
  const earliest = Date.parse("2026-11-01T05:30:00Z");
  assert.equal(firstScheduleTarget(fall, Date.parse("2026-11-01T00:00:00Z")), earliest);
  assert.deepEqual(consumeScheduleTarget(fall, earliest, Date.parse("2026-11-01T06:30:00Z")), {
    scheduledAt: earliest,
    nextAt: Date.parse("2026-11-08T06:30:00Z"),
  });
});

test("startup delivers one missed occurrence and keeps its cadence through edits and restart", async (t) => {
  const file = await storage(t);
  const runs = [];
  const sessionExists = async (id) => id === draft.sessionId;
  const unexpectedRun = async () => assert.fail("An occurrence was replayed");
  const initial = new ScheduledTasks(file, server, unexpectedRun, sessionExists);
  const task = await initial.save(draft);
  initial.stop();
  await initial.settled();

  const { tasks } = JSON.parse(await readFile(file, "utf8"));
  const due = Date.now() - 26 * 60_000;
  await writeFile(file, JSON.stringify({ version: 1, tasks: [{ ...tasks[0], nextAt: due }] }));

  const { promise, resolve } = Promise.withResolvers();
  const restarted = new ScheduledTasks(
    file,
    server,
    async (task, run) => {
      runs.push({ task, run });
      await promise;
    },
    sessionExists,
  );
  t.after(() => {
    resolve();
    restarted.stop();
  });
  restarted.start();
  await waitFor(() => runs.length === 1);
  assert.equal(runs[0].task.sessionId, draft.sessionId);
  assert.equal(runs[0].run.scheduledAt, due + 20 * 60_000);
  await assert.rejects(restarted.runNow(task), { code: "CONFLICT" });
  const changed = await restarted.save({
    ...draft,
    id: task.id,
    revision: task.revision,
    name: "Edited while running",
  });
  assert.equal(changed.nextAt, due + 30 * 60_000);
  await restarted.pause({ id: task.id, revision: changed.revision, paused: true });
  resolve();
  await waitFor(async () => (await restarted.list())[0].runs[0].status === "succeeded");
  restarted.stop();
  await restarted.settled();

  const restored = new ScheduledTasks(file, server, unexpectedRun, sessionExists);
  const [latest] = await restored.list();
  restored.stop();
  assert.equal(latest.name, "Edited while running");
  assert.equal(latest.status, "paused");
  assert.equal(latest.nextAt, null);
  assert.equal(latest.runs.length, 1);
  assert.equal(latest.runs[0].status, "succeeded");
});

test("a claimed one-time task is recovered as interrupted without replay", async (t) => {
  const file = await storage(t);
  const now = Date.now();
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      tasks: [
        {
          ...draft,
          id: "once",
          revision: 1,
          rule: { kind: "once", at: now },
          status: "completed",
          nextAt: null,
          runs: [
            { id: "claim", trigger: "scheduled", scheduledAt: now, sessionId: draft.sessionId, status: "running" },
          ],
        },
      ],
    }),
  );
  const service = new ScheduledTasks(
    file,
    server,
    async () => assert.fail("The claimed run was replayed"),
    async () => true,
  );
  service.start();
  const [task] = await service.list();
  service.stop();
  await service.settled();
  assert.equal(task.status, "completed");
  assert.equal(task.runs[0].status, "interrupted");
  assert.equal(JSON.parse(await readFile(file, "utf8")).tasks[0].runs[0].status, "interrupted");
});
