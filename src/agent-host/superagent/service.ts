import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdtemp, realpath, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SUPERAGENT_CLIS,
  type SuperAgentApproval,
  type SuperAgentCli,
  type SuperAgentCreateRoom,
  type SuperAgentMember,
  type SuperAgentMessage,
  type SuperAgentPermissionMode,
  type SuperAgentRole,
  type SuperAgentRoom,
  type SuperAgentRoomInfo,
  type SuperAgentRuntime,
  type SuperAgentTaskTeam,
} from "../../contract/superagent";
import { RpcError } from "../../contract/types";
import {
  addWorktree,
  diffWorktree,
  findWorktreeBase,
  getGitStatus,
  removeWorktree,
  resolveProject,
} from "../../shared/worktree";
import { allowFileRoot } from "../file-access";
import { resourceHandlers } from "../handlers/resources";
import type { HerdrBridge } from "../herdr/bridge";
import { assertPathAllowed } from "../path-authorization";
import { runLocalAgentTurn } from "./adapters";
import { createDirectorySnapshot, diffDirectorySnapshot } from "./directory-snapshot";
import { workspaceEditChoice, type AgentApprovalRequest } from "./permissions";
import { discoverLocalAgents, resolveLocalAgent } from "./process";
import { diagnostic, parseReply } from "./protocol";
import { readJson, uuid, writeJson } from "./storage";
import { SuperAgentTasks, type TaskRoom } from "./tasks";

const turnLimit = 24;
const timeLimit = 20 * 60_000;
const maxRoomMembers = 8;
const maxRoomMessages = 1_000;

interface QueueEntry {
  memberId: string;
  summary?: boolean;
  fromId?: string;
}
interface RoomRecord extends Omit<SuperAgentRoom, "members" | "permissionMode"> {
  members: SuperAgentMember[];
  task?: { topic: string; queue: QueueEntry[]; current?: QueueEntry; turns: number; elapsed: number };
}
interface LiveTurn {
  abort: AbortController;
  settled: Promise<void>;
  started?: number;
  timer?: ReturnType<typeof setTimeout>;
  approvals: {
    request: SuperAgentApproval;
    edit?: AgentApprovalRequest["workspaceEdit"];
    answer: (choice?: string) => void;
  }[];
}

function bad(message: string): never {
  throw new RpcError({ code: "BAD_REQUEST", message });
}

function input(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) bad(`Invalid ${label}`);
  return value.trim();
}

function roomInfo(room: RoomRecord): SuperAgentRoomInfo {
  const { id, title, project, status, updatedAt, mode } = room;
  return { id, title, project, status, updatedAt, ...(mode ? { mode } : {}) };
}

export class SuperAgentService {
  readonly tasks: SuperAgentTasks;
  private roles: SuperAgentRole[] | undefined;
  private rooms: Map<string, RoomRecord> | undefined;
  private readonly live = new Map<string, LiveTurn>();
  private readonly permissionModes = new Map<string, SuperAgentPermissionMode>();
  private readonly handoffs = new Set<string>();
  private readonly runtimeChecks = new Map<SuperAgentCli, SuperAgentRuntime>();
  private readonly probes = new Map<SuperAgentCli, AbortController>();
  private closing = false;

  constructor(
    private readonly directory: string,
    private readonly changed: (roomId?: string) => void,
    private readonly herdr: HerdrBridge,
    private readonly runTurn = runLocalAgentTurn,
    taskChanged: (roomId: string, taskId: string) => void = () => undefined,
  ) {
    this.tasks = new SuperAgentTasks(directory, (id) => this.taskRoom(id), taskChanged, runTurn);
  }

  private loadRooms(): Map<string, RoomRecord> {
    if (this.rooms) return this.rooms;
    const rooms = new Map<string, RoomRecord>();
    try {
      for (const name of readdirSync(this.directory)) {
        if (!name.endsWith(".room.json")) continue;
        const stored = readJson<RoomRecord | null>(path.join(this.directory, name), null);
        if (!stored || name !== `${stored.id}.room.json` || !uuid.test(stored.id)) continue;
        if (stored.status === "running" || stored.status === "approval") {
          stored.status = "stopped";
          stored.activeMemberId = undefined;
          this.message(stored, "system", "The previous application run ended. Continue to resume the task.");
          this.writeRoom(stored);
        }
        if (stored.mode !== "tasks") stored.members.forEach((member) => allowFileRoot(member.cwd));
        rooms.set(stored.id, stored);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return (this.rooms = rooms);
  }

  private room(id: string): RoomRecord {
    const room = this.loadRooms().get(id);
    if (!room) throw new RpcError({ code: "NOT_FOUND", message: "SuperAgent room not found" });
    return room;
  }

  private taskRoom(id: string): TaskRoom {
    const { mode, project, members, team } = this.room(id);
    if (mode !== "tasks" || !team) bad("This room does not use task mode");
    return { id, project, members, team };
  }

  private chatRoom(id: string): RoomRecord {
    const room = this.room(id);
    if (room.mode === "tasks") bad("Use the task controls for this room");
    return room;
  }

  private member(room: RoomRecord, id: string): SuperAgentMember {
    const member = room.members.find((item) => item.id === id);
    if (!member) bad("Unknown room member");
    return member;
  }

  private writeRoom(room: RoomRecord): void {
    const { approval: _approval, ...persisted } = room;
    writeJson(path.join(this.directory, `${room.id}.room.json`), persisted);
  }

  private publish(room: RoomRecord): void {
    room.updatedAt = Date.now();
    this.writeRoom(room);
    this.changed(room.id);
  }

  private message(
    room: RoomRecord,
    author: string,
    text: string,
    extra?: Pick<SuperAgentMessage, "to" | "summary">,
  ): void {
    room.messages.push({ id: randomUUID(), at: Date.now(), author, text, ...extra });
    if (room.messages.length > maxRoomMessages) room.messages.splice(0, room.messages.length - maxRoomMessages);
  }

  listRoles(): SuperAgentRole[] {
    return (this.roles ??= readJson(path.join(this.directory, "roles.json"), []));
  }

  saveRole(draft: Omit<SuperAgentRole, "id"> & { id?: string }): SuperAgentRole {
    if (!draft || !SUPERAGENT_CLIS.includes(draft.cli)) bad("Unknown CLI");
    if (draft.id && !this.listRoles().some((role) => role.id === draft.id)) bad("Unknown role");
    if (!Array.isArray(draft.skillPaths) || draft.skillPaths.length > 8) bad("Select up to eight skills");
    const role: SuperAgentRole = {
      id: draft.id || randomUUID(),
      name: input(draft.name, 80, "role name"),
      cli: draft.cli,
      instructions: input(draft.instructions, 8_000, "role instructions"),
      skillPaths: [...new Set(draft.skillPaths.map((skill) => input(skill, 4_096, "skill path")))],
    };
    const roles = [...this.listRoles().filter((item) => item.id !== role.id), role];
    writeJson(path.join(this.directory, "roles.json"), roles);
    this.roles = roles;
    this.changed();
    return role;
  }

  deleteRole(id: string): void {
    const roles = this.listRoles().filter((role) => role.id !== id);
    writeJson(path.join(this.directory, "roles.json"), roles);
    this.roles = roles;
    this.changed();
  }

  async runtimes(probe?: SuperAgentCli): Promise<SuperAgentRuntime[]> {
    const found = await discoverLocalAgents();
    if (probe && !SUPERAGENT_CLIS.includes(probe)) bad("Unknown CLI");
    if (probe && found[probe] && !this.probes.has(probe)) {
      const controller = new AbortController();
      this.probes.set(probe, controller);
      let directory: string | undefined;
      try {
        directory = await mkdtemp(path.join(tmpdir(), "serphia-superagent-probe-"));
        const command = await resolveLocalAgent(probe, found[probe]!, found.node);
        const reply = await this.runTurn({
          command,
          cli: probe,
          cwd: directory,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
          prompt: 'Connectivity check. Do not call tools. Reply with only {"message":"ok","to":[],"question":""}.',
          session: () => undefined,
          approval: async () => undefined,
        });
        if (!parseReply(reply)) throw new Error("The CLI did not return a valid structured reply");
        this.runtimeChecks.set(probe, { cli: probe, state: "ready" });
      } catch (error) {
        this.runtimeChecks.set(probe, { cli: probe, state: "error", detail: diagnostic(error) });
      } finally {
        this.probes.delete(probe);
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        this.changed();
      }
    }
    return SUPERAGENT_CLIS.map((cli) =>
      found[cli] ? (this.runtimeChecks.get(cli) ?? { cli, state: "detected" }) : { cli, state: "missing" },
    );
  }

  listRooms(): SuperAgentRoomInfo[] {
    return [...this.loadRooms().values()].map(roomInfo).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getRoom(id: string): SuperAgentRoom {
    const room = this.room(id);
    return structuredClone({
      ...roomInfo(room),
      base: room.base,
      ...(room.team ? { team: room.team } : {}),
      starterId: room.starterId,
      summarizerId: room.summarizerId,
      members: room.members.map(({ skills, ...member }) => ({
        ...member,
        skills: skills.map(({ name, hasResources }) => ({ name, hasResources })),
      })),
      messages: room.messages,
      activeMemberId: room.activeMemberId,
      approval: room.approval,
      permissionMode: this.permissionModes.get(id) ?? "ask",
    });
  }

  async createRoom(draft: SuperAgentCreateRoom): Promise<SuperAgentRoom> {
    const title = input(draft?.title, 120, "room title");
    const requested = input(draft?.project, 4_096, "project path");
    if (!path.isAbsolute(requested)) bad("Select an absolute project directory");
    const cwd = await realpath(requested);
    await assertPathAllowed(cwd);
    if (!(await stat(cwd)).isDirectory()) bad("Select a project folder");
    if (draft.mode !== undefined && draft.mode !== "tasks") bad("Unknown room mode");
    const leader = draft.mode === "tasks" ? draft.team?.leaderId : draft.starterId;
    const summarizer = draft.mode === "tasks" ? leader : draft.summarizerId;
    if (
      !Array.isArray(draft.roleIds) ||
      draft.roleIds.length < 2 ||
      draft.roleIds.length > maxRoomMembers ||
      new Set(draft.roleIds).size !== draft.roleIds.length ||
      !draft.roleIds.includes(leader) ||
      !draft.roleIds.includes(summarizer)
    )
      bad("Select two to eight different roles and choose who leads the room");
    let team: SuperAgentTaskTeam | undefined;
    if (draft.mode === "tasks") {
      const { instructions, responsibilities } = draft.team;
      if (
        typeof instructions !== "string" ||
        instructions.length > 8_000 ||
        instructions.includes("\0") ||
        !responsibilities ||
        typeof responsibilities !== "object" ||
        Array.isArray(responsibilities)
      )
        bad("Invalid team instructions or responsibilities");
      const entries = Object.entries(responsibilities);
      for (const [id, value] of entries) {
        if (!draft.roleIds.includes(id) || typeof value !== "string" || value.length > 2_000 || value.includes("\0")) {
          bad("Invalid member responsibility");
        }
      }
      team = {
        leaderId: leader,
        instructions: instructions.trim(),
        responsibilities: Object.fromEntries(entries.map(([id, value]) => [id, value.trim()])),
      };
    }
    const roles = draft.roleIds.map((id) => {
      const role = this.listRoles().find((item) => item.id === id);
      if (!role) bad("Unknown role");
      return role;
    });
    const found = await discoverLocalAgents();
    for (const role of roles) {
      const candidate = found[role.cli];
      if (!candidate) bad(`${role.cli} is not installed`);
      await resolveLocalAgent(role.cli, candidate, found.node);
    }
    const base = team ? null : await findWorktreeBase(cwd);
    const project = base ? (await resolveProject(cwd)).projectRoot : cwd;
    const available = roles.some((role) => role.skillPaths.length)
      ? (await resourceHandlers.listSkills({ cwd })).skills
      : [];
    const room: RoomRecord = {
      id: randomUUID(),
      title,
      project,
      base,
      members: [],
      messages: [],
      status: "idle",
      updatedAt: Date.now(),
      starterId: leader,
      summarizerId: summarizer,
      ...(team ? { mode: "tasks" as const, team } : {}),
    };
    const snapshots = await Promise.all(
      roles.map(async ({ skillPaths, ...role }) => {
        let size = 0;
        const skills = await Promise.all(
          skillPaths.map(async (filePath) => {
            const skill = available.find((item) => item.filePath === filePath);
            if (!skill) bad(`Skill is unavailable for this project: ${path.basename(path.dirname(filePath))}`);
            if ((await stat(skill.filePath)).size > 32_000) bad(`Skill is too large: ${skill.name}`);
            const { content } = await resourceHandlers.getSkillContent({ cwd, filePath });
            size += content.length;
            if (size > 48_000) bad(`Selected skills are too large for ${role.name}`);
            const siblings = await readdir(skill.baseDir);
            return {
              name: skill.name,
              content,
              hasResources: siblings.some((name) => /^(?:scripts|references|assets|resources)$/iu.test(name)),
            };
          }),
        );
        return { ...role, skills };
      }),
    );
    const rooms = this.loadRooms();
    if (this.closing) throw new Error("Agent Host is shutting down");
    if (team) {
      room.members = snapshots.map((role) => ({ ...role, cwd, branch: null }));
      this.publish(room);
      rooms.set(room.id, room);
      return this.getRoom(room.id);
    }
    const copies = base ? undefined : await createDirectorySnapshot(this.directory, room.id, cwd, snapshots.length);
    try {
      for (const [index, role] of snapshots.entries()) {
        if (this.closing) throw new Error("Agent Host is shutting down");
        const { path: memberCwd, branch } = copies
          ? { path: copies.directories[index], branch: null }
          : await addWorktree(cwd, `codex/superagent-${room.id}-${index + 1}`, base ?? undefined);
        room.members.push({ ...role, cwd: memberCwd, branch });
      }
      this.publish(room);
      rooms.set(room.id, room);
      if (copies) room.members.forEach((member) => allowFileRoot(member.cwd));
      return this.getRoom(room.id);
    } catch (error) {
      if (copies) await copies.discard().catch(() => undefined);
      else await Promise.allSettled(room.members.map((member) => removeWorktree(cwd, member.cwd)));
      throw error;
    }
  }

  send(id: string, text: string, targetId?: string): SuperAgentRoom {
    const room = this.chatRoom(id);
    const message = input(text, 16_000, "message");
    if (targetId) this.member(room, targetId);
    this.assertNoHandoff(room);
    if (room.status === "stopped" && this.live.has(id)) bad("Wait for the stopped process to exit");
    if (room.status === "approval") bad("Resolve the CLI permission request first");
    this.message(room, "user", message, targetId ? { to: [targetId] } : undefined);
    if (room.status === "question" && room.task) {
      const current = room.task.current;
      if (current) room.task.queue.unshift(current);
      room.task.current = undefined;
    } else if (room.status === "running" && room.task) {
      this.enqueue(room, { memberId: targetId ?? room.starterId });
    } else {
      room.task = { topic: message, queue: [{ memberId: targetId ?? room.starterId }], turns: 0, elapsed: 0 };
    }
    room.status = "running";
    this.publish(room);
    this.schedule(room);
    return this.getRoom(id);
  }

  private enqueue(room: RoomRecord, entry: QueueEntry): void {
    const queue = room.task?.queue;
    if (queue && !queue.some((pending) => pending.memberId === entry.memberId)) queue.push(entry);
  }

  private assertNoHandoff(room: RoomRecord): void {
    if (this.closing) bad("Agent Host is shutting down");
    if (this.handoffs.has(room.id) || room.members.some((member) => member.paneId))
      bad("Close the Herdr handoff before continuing");
  }

  async stop(id: string): Promise<SuperAgentRoom> {
    const room = this.chatRoom(id);
    const live = this.live.get(id);
    if (room.status === "running" || room.status === "approval" || room.status === "question") {
      room.status = "stopped";
      room.approval = undefined;
      room.activeMemberId = undefined;
      live?.abort.abort();
      live?.approvals.splice(0).forEach((pending) => pending.answer());
      this.publish(room);
    }
    await live?.settled;
    return this.getRoom(id);
  }

  async resume(id: string): Promise<SuperAgentRoom> {
    const room = this.chatRoom(id);
    await this.live.get(id)?.settled;
    this.assertNoHandoff(room);
    if (room.status !== "stopped" && room.status !== "error") bad("This room is not stopped");
    if (!room.task || room.task.turns >= turnLimit || room.task.elapsed >= timeLimit)
      bad("Start a new task to continue");
    if (room.task.current) room.task.queue.unshift(room.task.current);
    room.task.current = undefined;
    room.status = "running";
    this.message(
      room,
      "system",
      "The user continued the task. Before repeating interrupted work, inspect your working folder and prior results.",
    );
    this.publish(room);
    this.schedule(room);
    return this.getRoom(id);
  }

  decide(id: string, approvalId: string, choice: string): SuperAgentRoom {
    const room = this.chatRoom(id);
    const live = this.live.get(id);
    if (
      !live?.approvals.length ||
      room.approval?.id !== approvalId ||
      !room.approval.options.some((option) => option.id === choice)
    ) {
      bad("The permission request is no longer active or the choice is invalid");
    }
    const { answer } = live.approvals.shift()!;
    answer(choice);
    this.advanceApprovals(room, live);
    this.publish(room);
    return this.getRoom(id);
  }

  setPermissionMode(id: string, mode: SuperAgentPermissionMode): SuperAgentRoom {
    const room = this.chatRoom(id);
    if (mode !== "ask" && mode !== "workspaceEdits") bad("Unknown permission mode");
    this.assertNoHandoff(room);
    if (mode === "ask") this.permissionModes.delete(id);
    else this.permissionModes.set(id, mode);
    const live = this.live.get(id);
    if (room.status === "approval" && live && !live.abort.signal.aborted) {
      this.advanceApprovals(room, live);
      this.publish(room);
    } else {
      this.changed(id);
    }
    return this.getRoom(id);
  }

  private editChoice(room: RoomRecord, memberId: string, edit?: AgentApprovalRequest["workspaceEdit"]) {
    if (!edit || this.permissionModes.get(room.id) !== "workspaceEdits") return;
    return workspaceEditChoice(this.member(room, memberId).cwd, edit);
  }

  private advanceApprovals(room: RoomRecord, live: LiveTurn): void {
    while (!live.abort.signal.aborted && live.approvals.length) {
      const next = live.approvals[0];
      const choice = this.editChoice(room, next.request.memberId, next.edit);
      if (!choice || !next.request.options.some((option) => option.id === choice)) break;
      live.approvals.shift();
      next.answer(choice);
    }
    room.approval = live.approvals[0]?.request;
    if (!room.approval) {
      room.status = "running";
      this.startClock(room, live);
    }
  }

  private startClock(room: RoomRecord, live: LiveTurn): void {
    if (!room.task) return;
    live.started = Date.now();
    live.timer = setTimeout(
      () => live.abort.abort(new Error("SuperAgent task reached its time limit")),
      timeLimit - room.task.elapsed,
    );
  }

  private stopClock(room: RoomRecord, live: LiveTurn): void {
    clearTimeout(live.timer);
    if (room.task && live.started !== undefined) room.task.elapsed += Date.now() - live.started;
    live.started = undefined;
  }

  private schedule(room: RoomRecord): void {
    if (this.closing || this.live.has(room.id) || room.status !== "running" || !room.task) return;
    const live: LiveTurn = { abort: new AbortController(), settled: Promise.resolve(), approvals: [] };
    this.live.set(room.id, live);
    live.settled = this.runRoom(room, live)
      .catch((error: unknown) => {
        if (room.status !== "stopped") {
          room.status = "error";
          this.message(
            room,
            "system",
            diagnostic(live.abort.signal.aborted ? live.abort.signal.reason : error) || "The role failed",
          );
        }
      })
      .finally(() => {
        this.stopClock(room, live);
        live.approvals.splice(0).forEach((pending) => pending.answer());
        room.activeMemberId = undefined;
        room.approval = undefined;
        this.live.delete(room.id);
        this.publish(room);
        this.schedule(room);
      });
    void live.settled.catch(() => undefined);
  }

  private async runRoom(room: RoomRecord, live: LiveTurn): Promise<void> {
    const task = room.task!;
    const discovered = await discoverLocalAgents();
    while (room.status === "running") {
      live.abort.signal.throwIfAborted();
      if (task.turns >= turnLimit || task.elapsed >= timeLimit) throw new Error("SuperAgent task reached its limit");
      const entry = task.queue.shift() ?? { memberId: room.summarizerId, summary: true };
      const member = this.member(room, entry.memberId);
      task.current = entry;
      task.turns++;
      room.activeMemberId = member.id;
      this.publish(room);
      this.startClock(room, live);
      const candidate = discovered[member.cli];
      if (!candidate) throw new Error(`${member.cli} is not installed`);
      const command = await resolveLocalAgent(member.cli, candidate, discovered.node);
      const prompt = await this.prompt(room, member, entry);
      const raw = await this.runTurn({
        cli: member.cli,
        command,
        cwd: member.cwd,
        sessionId: member.nativeSessionId,
        prompt,
        signal: live.abort.signal,
        session: (nativeSessionId) => {
          member.nativeSessionId = nativeSessionId;
          this.publish(room);
        },
        approval: (request) => this.requestApproval(room, member.id, live, request),
      });
      live.abort.signal.throwIfAborted();
      this.stopClock(room, live);
      if (room.approval) {
        live.approvals.splice(0).forEach((pending) => pending.answer());
        room.approval = undefined;
        room.status = "running";
      }
      const reply = parseReply(raw);
      if (!reply) {
        if (typeof raw === "string" && raw.trim()) this.message(room, member.id, raw.slice(0, 32_000));
        throw new Error(`${member.name} did not return a valid structured reply`);
      }
      if (entry.summary && !reply.message.trim() && !reply.question.trim())
        throw new Error(`${member.name} returned an empty summary`);
      const targets = entry.summary
        ? []
        : reply.to.filter((id) => id !== member.id && room.members.some((item) => item.id === id));
      if (reply.message.trim()) {
        this.message(room, member.id, reply.message, entry.summary ? { to: targets, summary: true } : { to: targets });
      }
      for (const id of targets) this.enqueue(room, { memberId: id, fromId: member.id });
      if (reply.question.trim()) {
        this.message(room, member.id, reply.question);
        room.status = "question";
      } else {
        task.current = undefined;
        if (entry.summary && task.queue.length === 0) {
          room.status = "done";
          this.permissionModes.delete(room.id);
        }
      }
      this.publish(room);
    }
  }

  private requestApproval(
    room: RoomRecord,
    memberId: string,
    live: LiveTurn,
    request: AgentApprovalRequest,
  ): Promise<string | undefined> {
    if (live.abort.signal.aborted || !request.options.length) return Promise.resolve(undefined);
    if (!live.approvals.length) {
      const choice = this.editChoice(room, memberId, request.workspaceEdit);
      if (choice && request.options.some((option) => option.id === choice)) return Promise.resolve(choice);
    }
    if (live.approvals.length >= 16) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const approval = {
        id: randomUUID(),
        memberId,
        title: diagnostic(request.title),
        detail: diagnostic(request.detail),
        options: request.options,
      };
      live.approvals.push({ request: approval, edit: request.workspaceEdit, answer: resolve });
      if (live.approvals.length === 1) {
        this.stopClock(room, live);
        room.status = "approval";
        room.approval = approval;
        this.publish(room);
      }
    });
  }

  private async prompt(room: RoomRecord, member: SuperAgentMember, entry: QueueEntry): Promise<string> {
    const artifact = entry.fromId ? await this.artifact(room.id, entry.fromId).catch(() => undefined) : undefined;
    const recent = room.messages
      .slice(-16)
      .map(
        ({ author, text }) =>
          `${room.members.find((item) => item.id === author)?.name ?? author}: ${text.slice(0, 2_000)}`,
      )
      .join("\n");
    return [
      `You are ${member.name}, a role in the Serphia SuperAgent room. Your role instructions:\n${member.instructions}`,
      `Work in your assigned ${room.base ? "Git worktree" : "local directory copy"} (${member.cwd}). Make changes there, and report exact test results in your reply.`,
      `Members: ${room.members.map((item) => `${item.name} (${item.id})`).join(", ")}`,
      `Task: ${room.task?.topic}`,
      entry.summary
        ? "Summarize the outcome for the user, including changes, tests and unresolved issues. Do not delegate."
        : "Work toward the task. Delegate only when a teammate has a concrete next step. Use their exact member ID.",
      ...member.skills.map(
        (skill) =>
          `Assigned skill ${skill.name}${skill.hasResources ? " (documentation only; resources are not copied)" : ""}:\n${skill.content}`,
      ),
      `Recent room messages (context):\n${recent}`,
      artifact
        ? `Previous role's changed files: ${artifact.status.entries
            .slice(0, 40)
            .map((file) => file.path)
            .join(", ")}\nDiff preview:\n${artifact.diff.slice(0, 14_000)}`
        : "",
      'Return only one final JSON object: {"message":"visible reply in the user’s language", "to":["member-id"], "question":""}. Use [] if no handoff, and a nonempty question only when you need the user. Do not put other text before or after the JSON.',
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async artifact(id: string, memberId: string) {
    const room = this.chatRoom(id);
    const member = this.member(room, memberId);
    if (!room.base) return diffDirectorySnapshot(this.directory, room.id, member.cwd);
    const [status, diff] = await Promise.all([getGitStatus(member.cwd), diffWorktree(member.cwd, room.base)]);
    return { status, diff: diff.slice(0, 180_000), truncated: diff.length > 180_000 };
  }

  async handoff(id: string, memberId: string, close?: boolean): Promise<SuperAgentRoom> {
    const room = this.chatRoom(id);
    const member = this.member(room, memberId);
    if (this.live.has(id) || this.handoffs.has(id)) bad("Stop the automatic turn before opening a terminal");
    if (member.cli === "dsh" || !member.nativeSessionId || !uuid.test(member.nativeSessionId))
      bad("This role has no resumable Herdr session");
    this.handoffs.add(id);
    try {
      const fleet = await this.herdr.refreshSnapshot();
      const exists = member.workspaceId && fleet.workspaces.some((workspace) => workspace.id === member.workspaceId);
      if (!exists) {
        member.workspaceId = undefined;
        member.paneId = undefined;
      }
      if (close) {
        if (member.workspaceId) await this.herdr.closeWorkspace(member.workspaceId);
        member.workspaceId = undefined;
        member.paneId = undefined;
      } else if (member.paneId) {
        await this.herdr.focusPane(member.paneId);
      } else {
        const discovered = await discoverLocalAgents();
        const candidate = discovered[member.cli];
        if (!candidate) bad(`${member.cli} is not installed`);
        const command = await resolveLocalAgent(member.cli, candidate, discovered.node);
        const workspace = await this.herdr.createWorkspace(member.cwd, member.name);
        try {
          await this.herdr.resumeAgent(workspace.rootPaneId, member.cli, member.nativeSessionId, command);
        } catch (error) {
          await this.herdr.closeWorkspace(workspace.workspaceId).catch(() => undefined);
          throw error;
        }
        member.paneId = workspace.rootPaneId;
        member.workspaceId = workspace.workspaceId;
      }
      this.publish(room);
      return this.getRoom(id);
    } finally {
      this.handoffs.delete(id);
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const controller of this.probes.values()) controller.abort();
    await Promise.allSettled([this.tasks.shutdown(), ...[...this.live.keys()].map((id) => this.stop(id))]);
  }
}
