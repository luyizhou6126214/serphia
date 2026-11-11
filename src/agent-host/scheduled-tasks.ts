import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import type { RpcServer } from "../contract/rpc";
import {
  schedulePause,
  scheduleSave,
  scheduleTask,
  scheduleTaskId,
  scheduleTaskRef,
  type ScheduleRun,
  type ScheduleTask,
} from "../contract/schedule.ts";
import { RpcError } from "../contract/types.ts";
import { withLockedJsonFile } from "../shared/node/locked-json-file.ts";
import { consumeScheduleTarget, firstScheduleTarget, normalizeScheduleRule } from "./schedule-recurrence.ts";

const storeSchema = Type.Object({ version: Type.Literal(1), tasks: Type.Array(scheduleTask) });
const MAX_RUNS = 20;
const CLOCK_CHECK_MS = 60_000;

function badRequest(message: string): never {
  throw new RpcError({ code: "BAD_REQUEST", message });
}

function check<T extends TSchema>(schema: T, value: unknown): asserts value is Static<T> {
  if (!Check(schema, value)) badRequest("Invalid scheduled task parameters");
}

const isRunning = (task: ScheduleTask) => task.runs[0]?.status === "running";

export class ScheduledTasks {
  private tasks: ScheduleTask[] = [];
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly active = new Set<Promise<void>>();
  private readonly pendingResults = new Map<string, ScheduleRun>();
  private readonly shutdown = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly filename: string,
    private readonly server: Pick<RpcServer, "emit">,
    private readonly run: (task: ScheduleTask, occurrence: ScheduleRun, signal: AbortSignal) => Promise<void>,
    private readonly sessionExists: (id: string) => Promise<boolean>,
  ) {}

  start(): void {
    void this.drive();
  }

  stop(): void {
    this.shutdown.abort();
    clearTimeout(this.timer);
  }

  async settled(): Promise<void> {
    await this.tail;
    await Promise.all([...this.active]);
    await this.serialize(() => this.flushResults());
  }

  list(): Promise<ScheduleTask[]> {
    return this.serialize(() => this.tasks);
  }

  save(input: unknown): Promise<ScheduleTask> {
    check(scheduleSave, input);
    const { id, revision, name, prompt, sessionId } = input;
    if (!name.trim() || !prompt.trim() || (id === undefined) !== (revision === undefined))
      badRequest("A name, instruction and valid task revision are required");
    let rule: ScheduleTask["rule"];
    try {
      rule = normalizeScheduleRule(input.rule);
    } catch {
      badRequest("Enter a valid IANA time zone");
    }

    return this.serialize(async () => {
      const prior = id ? this.requireTask(id, revision) : undefined;
      if (sessionId !== prior?.sessionId && !(await this.sessionExists(sessionId))) {
        throw new RpcError({ code: "NOT_FOUND", message: "The selected session no longer exists" });
      }
      const sameRule = prior && JSON.stringify(prior.rule) === JSON.stringify(rule);
      const status = prior?.status === "paused" ? "paused" : sameRule ? prior.status : "active";
      const nextAt = sameRule ? prior.nextAt : firstScheduleTarget(rule, Date.now());
      if (status === "active" && nextAt === null) badRequest("Choose a future run time");

      const task: ScheduleTask = {
        id: prior?.id ?? randomUUID(),
        revision: (prior?.revision ?? 0) + 1,
        name: name.trim(),
        prompt: prompt.trim(),
        sessionId,
        rule,
        status,
        nextAt: status === "active" ? nextAt : null,
        runs: prior?.runs ?? [],
      };
      await this.put(task);
      return task;
    });
  }

  pause(input: unknown): Promise<ScheduleTask> {
    check(schedulePause, input);
    return this.serialize(async () => {
      const task = this.requireTask(input.id, input.revision);
      if (task.status === "completed" || (task.status === "paused") === input.paused) return task;
      const nextAt = input.paused ? null : firstScheduleTarget(task.rule, Date.now());
      if (!input.paused && nextAt === null) badRequest("Edit the task to choose a future run time");
      const next: ScheduleTask = {
        ...task,
        status: input.paused ? "paused" : "active",
        nextAt,
        revision: task.revision + 1,
      };
      await this.put(next);
      return next;
    });
  }

  runNow(input: unknown): Promise<ScheduleTask> {
    check(scheduleTaskRef, input);
    return this.serialize(() => {
      const task = this.requireTask(input.id, input.revision);
      if (isRunning(task)) throw new RpcError({ code: "CONFLICT", message: "This task is already running" });
      return this.dispatch(task, "manual", Date.now());
    });
  }

  remove(input: unknown): Promise<{ ok: true }> {
    check(scheduleTaskId, input);
    return this.serialize(async () => {
      const task = this.requireTask(input.id);
      if (isRunning(task)) throw new RpcError({ code: "CONFLICT", message: "This task is already running" });
      await this.write(this.tasks.filter(({ id }) => id !== task.id));
      return { ok: true };
    });
  }

  private serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.load();
      return operation();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      await stat(this.filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.loaded = true;
      return;
    }
    this.tasks = await withLockedJsonFile(this.filename, async (stored, save, text) => {
      if (text === null) return [];
      if (!Check(storeSchema, stored)) throw new Error("Scheduled task storage is invalid");
      let changed = false;
      const tasks = stored.tasks.map((task): ScheduleTask => {
        if (!isRunning(task)) return task;
        changed = true;
        const [run, ...history] = task.runs;
        return { ...task, runs: [{ ...run, status: "interrupted" }, ...history] };
      });
      if (changed) await save({ version: 1, tasks });
      return tasks;
    });
    this.loaded = true;
    this.arm();
  }

  private requireTask(id: string, revision?: number): ScheduleTask {
    const task = this.tasks.find((task) => task.id === id);
    if (!task) throw new RpcError({ code: "NOT_FOUND", message: "Scheduled task not found" });
    if (revision !== undefined && task.revision !== revision)
      throw new RpcError({ code: "CONFLICT", message: "The scheduled task changed. Reopen it and try again." });
    return task;
  }

  private async put(task: ScheduleTask): Promise<void> {
    const index = this.tasks.findIndex(({ id }) => id === task.id);
    const next = index === -1 ? [task, ...this.tasks] : this.tasks.with(index, task);
    await this.write(next);
  }

  private async write(next: ScheduleTask[]): Promise<void> {
    await withLockedJsonFile(this.filename, async (_stored, save) => save({ version: 1, tasks: next }));
    this.tasks = next;
    this.arm();
    this.server.emit("schedule.changed", "*", {});
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.shutdown.signal.aborted) return;
    const nextAt = this.tasks.reduce(
      (at, task) => (!isRunning(task) && task.nextAt !== null ? Math.min(at, task.nextAt) : at),
      this.pendingResults.size ? Date.now() + CLOCK_CHECK_MS : Infinity,
    );
    if (!Number.isFinite(nextAt)) return;
    this.timer = setTimeout(() => void this.drive(), Math.max(0, Math.min(CLOCK_CHECK_MS, nextAt - Date.now())));
    this.timer.unref();
  }

  private async drive(): Promise<void> {
    try {
      await this.serialize(async () => {
        if (this.shutdown.signal.aborted) return;
        await this.flushResults();
        for (const task of this.tasks) {
          if (this.shutdown.signal.aborted) return;
          const now = Date.now();
          if (task.nextAt !== null && task.nextAt <= now && !isRunning(task)) {
            await this.dispatch(task, "scheduled", now);
          }
        }
        this.arm();
      });
    } catch (error) {
      console.warn("[pi-desktop] scheduled task dispatch failed:", error);
      clearTimeout(this.timer);
      if (!this.shutdown.signal.aborted) {
        this.timer = setTimeout(() => void this.drive(), CLOCK_CHECK_MS);
        this.timer.unref();
      }
    }
  }

  private async dispatch(task: ScheduleTask, trigger: ScheduleRun["trigger"], now: number): Promise<ScheduleTask> {
    this.shutdown.signal.throwIfAborted();
    const occurrence =
      trigger === "scheduled" && task.nextAt !== null
        ? consumeScheduleTarget(task.rule, task.nextAt, now)
        : { scheduledAt: now, nextAt: task.nextAt };
    const run: ScheduleRun = {
      id: randomUUID(),
      trigger,
      scheduledAt: occurrence.scheduledAt,
      sessionId: task.sessionId,
      status: "running",
    };
    const next: ScheduleTask = {
      ...task,
      status: trigger === "scheduled" && occurrence.nextAt === null ? "completed" : task.status,
      nextAt: occurrence.nextAt,
      runs: [run, ...task.runs].slice(0, MAX_RUNS),
    };
    // Claim the occurrence before submitting work. After a crash its result is
    // uncertain, so recovery records an interruption instead of replaying it.
    await this.put(next);
    const execution = this.execute(task, run).catch((error: unknown) => {
      console.warn("[pi-desktop] could not save scheduled task result:", error);
      this.arm();
    });
    this.active.add(execution);
    void execution.then(() => this.active.delete(execution));
    return next;
  }

  private async execute(task: ScheduleTask, run: ScheduleRun): Promise<void> {
    let result: ScheduleRun;
    try {
      this.shutdown.signal.throwIfAborted();
      await this.run(task, run, this.shutdown.signal);
      result = { ...run, status: "succeeded" };
    } catch (error) {
      result = this.shutdown.signal.aborted
        ? { ...run, status: "interrupted" }
        : { ...run, status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
    }
    this.pendingResults.set(task.id, result);
    await this.serialize(() => this.flushResults());
  }

  private async flushResults(): Promise<void> {
    if (!this.pendingResults.size) return;
    const results = new Map(this.pendingResults);
    await this.write(
      this.tasks.map((task) => {
        const result = results.get(task.id);
        return result ? { ...task, runs: [result, ...task.runs.slice(1)] } : task;
      }),
    );
    for (const id of results.keys()) this.pendingResults.delete(id);
    this.arm();
  }
}
