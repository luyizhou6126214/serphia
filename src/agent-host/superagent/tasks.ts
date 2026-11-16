import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  SuperAgentApproval,
  SuperAgentMember,
  SuperAgentTask,
  SuperAgentTaskArtifact,
  SuperAgentTaskDraft,
  SuperAgentTaskEvent,
  SuperAgentTaskInfo,
  SuperAgentTaskReview,
  SuperAgentTaskRun,
  SuperAgentTaskStatus,
  SuperAgentTaskTeam,
} from "../../contract/superagent";
import { RpcError } from "../../contract/types";
import {
  addWorktree,
  diffWorktree,
  findWorktreeBase,
  listWorktreeChanges,
  removeWorktree,
} from "../../shared/worktree";
import { allowFileRoot } from "../file-access";
import { runLocalAgentTurn } from "./adapters";
import { createDirectorySnapshot, diffDirectorySnapshot } from "./directory-snapshot";
import { workspaceEditChoice, type AgentApprovalRequest } from "./permissions";
import { discoverLocalAgents, resolveLocalAgent } from "./process";
import { diagnostic } from "./protocol";
import { readJson, uuid, writeJson } from "./storage";
import { parseTaskReply, taskReplyInstructions, taskReplySchemas, type TaskReply } from "./task-replies";

const concurrency = 2;
const runTimeoutMs = 20 * 60_000;
const diffLimit = 180_000;

export interface TaskRoom {
  id: string;
  project: string;
  members: SuperAgentMember[];
  team: SuperAgentTaskTeam;
}

type Workspace = Pick<SuperAgentMember, "cwd" | "branch" | "nativeSessionId"> & { memberId: string };
type RunRecord = Omit<SuperAgentTaskRun, "artifact" | "approvals"> & { artifact?: SuperAgentTaskArtifact };

interface TaskRecord extends Omit<SuperAgentTask, "status" | "overlaps" | "runs"> {
  version: 1;
  state: "active" | "paused" | "accepted" | "cancelled";
  runs: RunRecord[];
  workspaces: Workspace[];
}

interface LiveRun {
  abort: AbortController;
  settled: Promise<void>;
  approvals: { request: SuperAgentApproval; resolve: (choice?: string) => void }[];
  remaining: number;
  started?: number;
  timer?: ReturnType<typeof setTimeout>;
}

function bad(message: string): never {
  throw new RpcError({ code: "BAD_REQUEST", message });
}

function required(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || value.includes("\0")) {
    bad(`Invalid ${label}`);
  }
  return value.trim();
}

function isFinished(task: TaskRecord): boolean {
  return task.state === "accepted" || task.state === "cancelled";
}

function currentRuns(task: TaskRecord): RunRecord[] {
  const ids = new Set([task.planRunId, task.summaryRunId, ...task.subtasks.map((subtask) => subtask.runId)]);
  return task.runs.filter((run) => ids.has(run.id));
}

function taskStatus(task: TaskRecord, live: Map<string, LiveRun>): SuperAgentTaskStatus {
  if (task.state !== "active") return task.state;
  const runs = currentRuns(task);
  if (runs.some((run) => run.status === "question" || live.get(run.id)?.approvals.length)) return "waiting";
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "queued")) return "queued";
  if (task.summaryRunId && runs.some((run) => run.id === task.summaryRunId && run.status === "succeeded")) {
    return "in_review";
  }
  return "blocked";
}

function log(task: TaskRecord, kind: SuperAgentTaskEvent["kind"], runId?: string, text?: string): void {
  task.timeline.push({ kind, at: Date.now(), runId, text });
}

function queueRun(
  task: TaskRecord,
  kind: RunRecord["kind"],
  memberId: string,
  subtaskId?: string,
  input?: string,
): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    memberId,
    kind,
    subtaskId,
    input,
    status: "queued",
    createdAt: Date.now(),
  };
  task.runs.push(run);
  if (kind === "plan") task.planRunId = run.id;
  else if (kind === "summary") task.summaryRunId = run.id;
  else task.subtasks.find((subtask) => subtask.id === subtaskId)!.runId = run.id;
  return run;
}

function recentAttempts(task: TaskRecord, run: RunRecord) {
  return task.runs
    .filter((item) => item.id !== run.id && item.kind === run.kind && item.subtaskId === run.subtaskId)
    .slice(-4)
    .map(({ status, input, question, error }) => ({ status, input, question, error }));
}

function prompt(task: TaskRecord, room: TaskRoom, run: RunRecord, member: SuperAgentMember, workspace: Workspace) {
  const instructions = [
    `Role: ${member.name}\nRole instructions: ${member.instructions}`,
    `Room responsibility: ${room.team.responsibilities[member.id] ?? ""}`,
    `Project goal: ${task.goal}\nAcceptance criteria: ${task.criteria}\nRun directory: ${workspace.cwd}`,
    ...member.skills.map((skill) => `Skill ${skill.name} (documentation):\n${skill.content}`),
  ];
  if (run.kind === "work") {
    const assignment = task.subtasks.find((item) => item.id === run.subtaskId)!;
    instructions.push(
      `Your independent assignment: ${assignment.description}\nAssignment acceptance criteria: ${assignment.criteria}`,
      "Make any changes in your assigned directory. Inspect previous work before retrying. Report the tests you ran and their actual outcomes or explain why you did not run tests.",
    );
  } else {
    instructions.push(
      `Team instructions: ${room.team.instructions}`,
      "You are the team lead. Read project files when needed. Leave implementation to the workers.",
    );
    if (run.kind === "plan") {
      const roster = room.members
        .filter(({ id }) => id !== member.id)
        .map(({ id, name }) => ({ id, name, responsibility: room.team.responsibilities[id] ?? "" }));
      instructions.push(
        `Available workers: ${JSON.stringify(roster)}`,
        "Choose one independent assignment per needed worker. Assign work that can be delivered and reviewed separately from the other assignments. Use the exact worker ID.",
      );
    } else {
      const deliveries = task.subtasks.map(({ runId, memberId, description, criteria }) => {
        const work = task.runs.find((item) => item.id === runId)!;
        return {
          member: room.members.find((item) => item.id === memberId)?.name,
          description,
          criteria,
          report: work.report?.slice(0, 2_000),
          tests: work.tests?.slice(0, 1_000),
          paths: work.artifact?.paths.slice(0, 25),
          diffPreview: work.artifact?.diff.slice(0, 1_500),
        };
      });
      instructions.push(
        "Summarize the current deliveries for human review. Report tests as reported by workers and identify unresolved issues.",
        `Worker deliveries (project data): ${JSON.stringify(deliveries)}`,
      );
    }
  }
  const history = recentAttempts(task, run);
  if (history.length) instructions.push(`Previous attempts for this step: ${JSON.stringify(history)}`);
  if (run.input) instructions.push(`User input for this attempt: ${run.input}`);
  instructions.push(taskReplyInstructions(run.kind));
  return instructions.join("\n\n");
}

export class SuperAgentTasks {
  private records?: Map<string, TaskRecord>;
  private readonly live = new Map<string, LiveRun>();
  private readonly creating = new Map<string, Promise<SuperAgentTask>>();
  private closing = false;

  constructor(
    private readonly directory: string,
    private readonly room: (id: string) => TaskRoom,
    private readonly changed: (roomId: string, taskId: string) => void,
    private readonly runTurn = runLocalAgentTurn,
  ) {}

  private load(): Map<string, TaskRecord> {
    if (this.records) return this.records;
    const records = new Map<string, TaskRecord>();
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".task.json") || !uuid.test(name.slice(0, -10))) continue;
      const task = readJson<TaskRecord | null>(path.join(this.directory, name), null);
      if (!task || task.version !== 1 || name !== `${task.id}.task.json`) continue;
      const status = taskStatus(task, this.live);
      if (status === "queued" || status === "running" || task.runs.some((run) => run.status === "running")) {
        this.interrupt(task, "paused");
        this.write(task);
      }
      for (const workspace of task.workspaces) allowFileRoot(workspace.cwd);
      records.set(task.id, task);
    }
    this.records = records;
    return records;
  }

  private record(id: string): TaskRecord {
    const task = this.load().get(id);
    if (!task) throw new RpcError({ code: "NOT_FOUND", message: "SuperAgent task not found" });
    return task;
  }

  private write(task: TaskRecord): void {
    task.updatedAt = Date.now();
    task.revision++;
    writeJson(path.join(this.directory, `${task.id}.task.json`), task);
  }

  private commit(task: TaskRecord): void {
    this.write(task);
    this.load().set(task.id, task);
    this.changed(task.roomId, task.id);
  }

  private update(id: string, edit: (task: TaskRecord) => void): void {
    const task = structuredClone(this.record(id));
    edit(task);
    this.commit(task);
  }

  private info(task: TaskRecord): SuperAgentTaskInfo {
    const { id, roomId, title, updatedAt, revision } = task;
    return { id, roomId, title, updatedAt, revision, status: taskStatus(task, this.live) };
  }

  list(roomId: string): SuperAgentTaskInfo[] {
    this.room(roomId);
    return [...this.load().values()]
      .filter((task) => task.roomId === roomId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((task) => this.info(task));
  }

  get(id: string): SuperAgentTask {
    const task = this.record(id);
    const changes = new Map<string, string>();
    const overlaps = new Set<string>();
    for (const run of currentRuns(task)) {
      for (const file of run.artifact?.paths ?? []) {
        const key = process.platform === "win32" ? file.toLowerCase() : file;
        const previous = changes.get(key);
        if (previous !== undefined) overlaps.add(previous);
        else changes.set(key, file);
      }
    }
    return structuredClone({
      ...this.info(task),
      goal: task.goal,
      criteria: task.criteria,
      base: task.base,
      permissionMode: task.permissionMode,
      subtasks: task.subtasks,
      planRunId: task.planRunId,
      summaryRunId: task.summaryRunId,
      overlaps: [...overlaps].sort(),
      timeline: task.timeline,
      runs: task.runs.map(({ artifact, ...run }) => {
        const pending = this.live.get(run.id)?.approvals[0];
        return {
          ...run,
          ...(pending ? { status: "approval" as const, approvals: [pending.request] } : {}),
          ...(artifact
            ? {
                artifact: {
                  branch: artifact.branch,
                  cwd: artifact.cwd,
                  paths: artifact.paths,
                  truncated: artifact.truncated,
                },
              }
            : {}),
        };
      }),
    });
  }

  artifact(id: string, runId: string): SuperAgentTaskArtifact {
    const artifact = this.record(id).runs.find((run) => run.id === runId)?.artifact;
    if (!artifact) throw new RpcError({ code: "NOT_FOUND", message: "This run has no saved diff" });
    return structuredClone(artifact);
  }

  async create(draft: SuperAgentTaskDraft): Promise<SuperAgentTask> {
    const room = this.room(draft?.roomId);
    const title = required(draft.title, 120, "task title");
    const goal = required(draft.goal, 16_000, "task goal");
    const criteria = required(draft.criteria, 8_000, "task acceptance criteria");
    const permissionMode = draft.permissionMode ?? "ask";
    if (permissionMode !== "ask" && permissionMode !== "workspaceEdits") bad("Invalid permission mode");
    if (this.closing) bad("Agent Host is shutting down");
    if (
      this.creating.has(room.id) ||
      [...this.load().values()].some((task) => task.roomId === room.id && !isFinished(task))
    ) {
      bad("Finish or cancel the current room task first");
    }
    const create = this.prepare(room, { title, goal, criteria, permissionMode });
    this.creating.set(room.id, create);
    try {
      return await create;
    } finally {
      this.creating.delete(room.id);
    }
  }

  private async prepare(room: TaskRoom, draft: Pick<TaskRecord, "title" | "goal" | "criteria" | "permissionMode">) {
    const directory = await realpath(room.project);
    if (path.relative(room.project, directory) || !(await stat(directory)).isDirectory()) {
      bad("The room project directory moved or is unavailable");
    }
    const base = await findWorktreeBase(directory);
    const id = randomUUID();
    const task: TaskRecord = {
      ...draft,
      id,
      roomId: room.id,
      base,
      version: 1,
      state: "active",
      updatedAt: Date.now(),
      revision: 0,
      planRunId: "",
      runs: [],
      subtasks: [],
      timeline: [],
      workspaces: [],
    };
    const copies = base ? undefined : await createDirectorySnapshot(this.directory, id, directory, room.members.length);
    try {
      for (const [index, member] of room.members.entries()) {
        if (this.closing) throw new Error("Agent Host is shutting down");
        const workspace = copies
          ? { path: copies.directories[index], branch: null }
          : await addWorktree(directory, `codex/superagent-task-${id}-${index + 1}`, base!);
        task.workspaces.push({ memberId: member.id, cwd: workspace.path, branch: workspace.branch });
      }
      if (this.closing) throw new Error("Agent Host is shutting down");
      queueRun(task, "plan", room.team.leaderId);
      log(task, "created");
      this.commit(task);
    } catch (error) {
      if (copies) await copies.discard().catch(() => undefined);
      else await Promise.allSettled(task.workspaces.map(({ cwd }) => removeWorktree(directory, cwd)));
      throw error;
    }
    for (const workspace of task.workspaces) allowFileRoot(workspace.cwd);
    this.schedule();
    return this.get(id);
  }

  answer(id: string, runId: string, value: string): SuperAgentTask {
    const answer = required(value, 8_000, "answer");
    this.update(id, (task) => {
      const run = currentRuns(task).find((item) => item.id === runId);
      if (task.state !== "active" || run?.status !== "question") bad("This question is no longer active");
      queueRun(task, run.kind, run.memberId, run.subtaskId, answer);
      log(task, "answered", runId, answer);
    });
    this.schedule();
    return this.get(id);
  }

  retry(id: string, runId: string): SuperAgentTask {
    this.update(id, (task) => {
      const run = currentRuns(task).find((item) => item.id === runId);
      if (task.state !== "active" || !run || (run.status !== "failed" && run.status !== "blocked")) {
        bad("This run cannot be retried");
      }
      const next = queueRun(task, run.kind, run.memberId, run.subtaskId, run.input);
      log(task, "retried", next.id);
    });
    this.schedule();
    return this.get(id);
  }

  private interrupt(task: TaskRecord, state: "paused" | "cancelled"): void {
    task.state = state;
    const now = Date.now();
    for (const run of currentRuns(task)) {
      if (
        run.status === "running" ||
        (state === "cancelled" && ["queued", "question", "interrupted"].includes(run.status))
      ) {
        run.status = state === "paused" ? "interrupted" : "cancelled";
        run.finishedAt = now;
      }
    }
    log(task, state);
  }

  async stop(id: string, state: "paused" | "cancelled"): Promise<SuperAgentTask> {
    this.update(id, (task) => {
      if (
        isFinished(task) ||
        (state === "paused" && !["queued", "running", "waiting"].includes(taskStatus(task, this.live)))
      ) {
        bad("This task cannot change to that state");
      }
      this.interrupt(task, state);
    });
    const live = this.record(id).runs.flatMap((run) => this.live.get(run.id) ?? []);
    for (const run of live) {
      run.abort.abort();
      for (const approval of run.approvals.splice(0)) approval.resolve();
    }
    await Promise.allSettled(live.map((run) => run.settled));
    return this.get(id);
  }

  resume(id: string): SuperAgentTask {
    this.update(id, (task) => {
      if (task.state !== "paused" || task.runs.some((run) => this.live.has(run.id))) bad("This task cannot resume yet");
      task.state = "active";
      for (const run of currentRuns(task)) {
        if (run.status === "interrupted") queueRun(task, run.kind, run.memberId, run.subtaskId, run.input);
      }
      log(task, "resumed");
    });
    this.schedule();
    return this.get(id);
  }

  review(id: string, input: SuperAgentTaskReview): SuperAgentTask {
    this.update(id, (task) => {
      if (taskStatus(task, this.live) !== "in_review") bad("This task is not ready for review");
      if (input?.summaryRunId !== task.summaryRunId) bad("The deliveries have changed. Open the latest summary.");
      if (input?.decision === "accept") {
        const note = input.note === undefined ? undefined : required(input.note, 8_000, "review note");
        task.state = "accepted";
        log(task, "accepted", task.summaryRunId, note);
      } else {
        if (input?.decision !== "return" || !Array.isArray(input.subtaskIds) || !input.subtaskIds.length) {
          bad("Select at least one subtask to return");
        }
        const note = required(input.note, 8_000, "review reason");
        const ids = new Set(input.subtaskIds);
        const selected = task.subtasks.filter((subtask) => ids.has(subtask.id));
        if (selected.length !== ids.size) bad("Unknown subtask in review");
        log(task, "returned", task.summaryRunId, note);
        task.summaryRunId = undefined;
        for (const subtask of selected) {
          const run = queueRun(task, "work", subtask.memberId, subtask.id, note);
          log(task, "retried", run.id, note);
        }
      }
    });
    this.schedule();
    return this.get(id);
  }

  decide(id: string, runId: string, approvalId: string, choice: string): SuperAgentTask {
    const task = this.record(id);
    const live = this.live.get(runId);
    const pending = live?.approvals[0];
    if (
      task.state !== "active" ||
      !task.runs.some((run) => run.id === runId) ||
      !live ||
      !pending ||
      pending.request.id !== approvalId ||
      !pending.request.options.some((option) => option.id === choice)
    )
      bad("This approval is no longer active");
    // Store the decision before releasing the waiting tool call.
    live.approvals.shift();
    try {
      this.update(id, (draft) =>
        log(draft, "approval_decided", runId, pending.request.options.find((item) => item.id === choice)?.label),
      );
    } catch (error) {
      live.approvals.unshift(pending);
      throw error;
    }
    if (!live.approvals.length) this.startClock(live);
    pending.resolve(choice);
    return this.get(id);
  }

  private startClock(live: LiveRun): void {
    live.started = Date.now();
    live.timer = setTimeout(
      () => live.abort.abort(new Error("The SuperAgent run reached its time limit")),
      live.remaining,
    );
  }

  private stopClock(live: LiveRun): void {
    clearTimeout(live.timer);
    if (live.started !== undefined) live.remaining -= Date.now() - live.started;
    live.started = undefined;
  }

  private approval(
    id: string,
    run: RunRecord,
    workspace: Workspace,
    request: AgentApprovalRequest,
  ): Promise<string | undefined> {
    const live = this.live.get(run.id);
    if (!live || live.abort.signal.aborted || !request.options.length || live.approvals.length >= 16) {
      return Promise.resolve(undefined);
    }
    const task = this.record(id);
    const auto =
      run.kind === "work" && task.permissionMode === "workspaceEdits" && !live.approvals.length
        ? workspaceEditChoice(workspace.cwd, request.workspaceEdit)
        : undefined;
    if (auto && request.options.some((option) => option.id === auto)) return Promise.resolve(auto);
    const approval: SuperAgentApproval = {
      id: randomUUID(),
      memberId: run.memberId,
      title: diagnostic(request.title),
      detail: diagnostic(request.detail),
      options: request.options,
    };
    return new Promise((resolve, reject) => {
      live.approvals.push({ request: approval, resolve });
      try {
        this.update(id, (draft) => log(draft, "approval_requested", run.id, approval.title));
        this.stopClock(live);
      } catch (error) {
        live.approvals.pop();
        reject(error);
      }
    });
  }

  private schedule(): void {
    if (this.closing) return;
    for (const task of this.load().values()) {
      if (task.state !== "active") continue;
      for (const run of currentRuns(task)) {
        if (this.live.size >= concurrency) return;
        if (run.status === "queued") this.start(task.id, run);
      }
    }
  }

  private start(id: string, run: RunRecord): void {
    this.update(id, (task) => {
      const current = task.runs.find((item) => item.id === run.id)!;
      current.status = "running";
      current.startedAt = Date.now();
      log(task, "started", current.id);
    });
    const live: LiveRun = {
      abort: new AbortController(),
      approvals: [],
      settled: Promise.resolve(),
      remaining: runTimeoutMs,
    };
    this.live.set(run.id, live);
    this.startClock(live);
    live.settled = this.execute(id, run, live).finally(() => {
      this.stopClock(live);
      for (const approval of live.approvals.splice(0)) approval.resolve();
      this.live.delete(run.id);
      this.schedule();
    });
    void live.settled.catch((error: unknown) => console.error("SuperAgent task settlement failed", diagnostic(error)));
  }

  private async capture(task: TaskRecord, workspace: Workspace): Promise<SuperAgentTaskArtifact> {
    const { cwd, branch } = workspace;
    if (!task.base) {
      const { status, diff, truncated } = await diffDirectorySnapshot(this.directory, task.id, cwd);
      return { cwd, branch, paths: status.entries.map((item) => item.path), diff, truncated };
    }
    const [{ paths, untrackedCount }, diff] = await Promise.all([
      listWorktreeChanges(cwd, task.base),
      diffWorktree(cwd, task.base),
    ]);
    return {
      cwd,
      branch,
      paths,
      diff: diff.slice(0, diffLimit),
      truncated: diff.length > diffLimit || untrackedCount > 24,
    };
  }

  private async execute(id: string, run: RunRecord, live: LiveRun): Promise<void> {
    try {
      const task = this.record(id);
      const room = this.room(task.roomId);
      const member = room.members.find((item) => item.id === run.memberId)!;
      const workspace = task.workspaces.find((item) => item.memberId === member.id)!;
      const discovered = await discoverLocalAgents();
      const candidate = discovered[member.cli];
      if (!candidate) throw new Error(`${member.cli} is not installed`);
      const command = await resolveLocalAgent(member.cli, candidate, discovered.node);
      const cwd = await realpath(workspace.cwd);
      if (path.relative(cwd, workspace.cwd)) throw new Error("The run's work directory moved");
      live.abort.signal.throwIfAborted();
      const raw = await this.runTurn({
        cli: member.cli,
        command,
        cwd,
        prompt: prompt(task, room, run, member, workspace),
        outputSchema: taskReplySchemas[run.kind],
        sessionId: workspace.nativeSessionId,
        signal: live.abort.signal,
        session: (sessionId) => {
          if (live.abort.signal.aborted || !sessionId) return;
          this.update(id, (draft) => {
            draft.workspaces.find((item) => item.memberId === member.id)!.nativeSessionId = sessionId;
          });
        },
        approval: (request) => this.approval(id, run, workspace, request),
      });
      live.abort.signal.throwIfAborted();
      const reply = parseTaskReply(run.kind, raw);
      const artifact = reply.kind === "work" && !reply.blocker ? await this.capture(task, workspace) : undefined;
      live.abort.signal.throwIfAborted();
      for (const approval of live.approvals.splice(0)) approval.resolve();
      this.update(id, (draft) => this.settle(draft, run.id, room, reply, artifact));
    } catch (error) {
      if (this.record(id).runs.find((item) => item.id === run.id)?.status !== "running") return;
      for (const approval of live.approvals.splice(0)) approval.resolve();
      this.update(id, (task) => {
        const current = task.runs.find((item) => item.id === run.id)!;
        current.status = "failed";
        current.error =
          diagnostic(live.abort.signal.aborted ? live.abort.signal.reason : error) || "SuperAgent run failed";
        current.finishedAt = Date.now();
        log(task, "settled", run.id, current.status);
      });
    }
  }

  private settle(
    task: TaskRecord,
    runId: string,
    room: TaskRoom,
    reply: TaskReply,
    artifact?: SuperAgentTaskArtifact,
  ): void {
    const run = task.runs.find((item) => item.id === runId)!;
    run.finishedAt = Date.now();
    run.status = "succeeded";
    switch (reply.kind) {
      case "plan": {
        const members = new Set(room.members.map(({ id }) => id));
        members.delete(room.team.leaderId);
        for (const assignment of reply.assignments) {
          if (!members.delete(assignment.memberId))
            throw new Error("The leader assigned an unknown or duplicate worker");
        }
        for (const assignment of reply.assignments) {
          const id = randomUUID();
          task.subtasks.push({ ...assignment, id, runId: "" });
          const work = queueRun(task, "work", assignment.memberId, id);
          log(task, "delegated", work.id, assignment.description);
        }
        break;
      }
      case "question":
        run.status = "question";
        run.question = reply.question;
        run.report = reply.report;
        run.tests = reply.tests;
        break;
      case "work":
        run.report = reply.report;
        run.tests = reply.tests;
        run.artifact = artifact;
        if (reply.blocker) {
          run.status = "blocked";
          run.error = reply.blocker;
        } else if (
          task.subtasks.every(({ runId }) => task.runs.find((item) => item.id === runId)?.status === "succeeded")
        ) {
          queueRun(task, "summary", room.team.leaderId);
        }
        break;
      case "summary":
        run.report = reply.report;
        break;
    }
    log(task, "settled", runId, run.status);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const pending = [...this.load().values()]
      .filter(
        (task) =>
          task.state === "active" &&
          currentRuns(task).some((run) => run.status === "queued" || run.status === "running"),
      )
      .map((task) => this.stop(task.id, "paused"));
    await Promise.allSettled([...pending, ...this.creating.values()]);
  }
}
