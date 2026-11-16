export const SUPERAGENT_CLIS = ["claude", "codex", "dsh"] as const;
export type SuperAgentCli = (typeof SUPERAGENT_CLIS)[number];

export interface SuperAgentRuntime {
  cli: SuperAgentCli;
  state: "missing" | "detected" | "ready" | "error";
  detail?: string;
}

export interface SuperAgentRole {
  id: string;
  name: string;
  instructions: string;
  cli: SuperAgentCli;
  skillPaths: string[];
}

export interface SuperAgentMember extends Omit<SuperAgentRole, "skillPaths"> {
  skills: { name: string; content: string; hasResources: boolean }[];
  cwd: string;
  branch: string | null;
  nativeSessionId?: string;
  paneId?: string;
  workspaceId?: string;
}

export interface SuperAgentMessage {
  id: string;
  at: number;
  author: "user" | "system" | string;
  text: string;
  to?: string[];
  summary?: boolean;
}

export interface SuperAgentApproval {
  id: string;
  memberId: string;
  title: string;
  detail?: string;
  options: { id: string; label: string }[];
}

export type SuperAgentPermissionMode = "ask" | "workspaceEdits";

export type SuperAgentRoomStatus = "idle" | "running" | "question" | "approval" | "stopped" | "done" | "error";

export interface SuperAgentRoomInfo {
  id: string;
  title: string;
  project: string;
  status: SuperAgentRoomStatus;
  updatedAt: number;
  mode?: "tasks";
}

export interface SuperAgentTaskTeam {
  leaderId: string;
  instructions: string;
  responsibilities: Record<string, string>;
}

export interface SuperAgentRoom extends SuperAgentRoomInfo {
  base: string | null;
  members: (Omit<SuperAgentMember, "skills"> & { skills: { name: string; hasResources: boolean }[] })[];
  starterId: string;
  summarizerId: string;
  activeMemberId?: string;
  messages: SuperAgentMessage[];
  approval?: SuperAgentApproval;
  permissionMode: SuperAgentPermissionMode;
  team?: SuperAgentTaskTeam;
}

interface SuperAgentRoomDraft {
  title: string;
  project: string;
  roleIds: string[];
}

export type SuperAgentCreateRoom = SuperAgentRoomDraft &
  ({ mode?: undefined; starterId: string; summarizerId: string } | { mode: "tasks"; team: SuperAgentTaskTeam });

export interface SuperAgentReply {
  message: string;
  to: string[];
  question: string;
}

export type SuperAgentTaskStatus =
  "queued" | "running" | "waiting" | "blocked" | "paused" | "in_review" | "accepted" | "cancelled";

export type SuperAgentTaskRunStatus =
  "queued" | "running" | "approval" | "question" | "blocked" | "failed" | "interrupted" | "succeeded" | "cancelled";

export interface SuperAgentTaskBrief {
  title: string;
  goal: string;
  criteria: string;
}

export interface SuperAgentTaskDraft extends SuperAgentTaskBrief {
  roomId: string;
  permissionMode?: SuperAgentPermissionMode;
}

export interface SuperAgentAssignment {
  memberId: string;
  description: string;
  criteria: string;
}

export interface SuperAgentSubtask extends SuperAgentAssignment {
  id: string;
  runId: string;
}

export interface SuperAgentTaskArtifactInfo {
  branch: string | null;
  cwd: string;
  paths: string[];
  truncated: boolean;
}

export interface SuperAgentTaskArtifact extends SuperAgentTaskArtifactInfo {
  diff: string;
}

export interface SuperAgentTaskRun {
  id: string;
  memberId: string;
  kind: "plan" | "work" | "summary";
  subtaskId?: string;
  status: SuperAgentTaskRunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  input?: string;
  question?: string;
  error?: string;
  report?: string;
  tests?: string;
  artifact?: SuperAgentTaskArtifactInfo;
  approvals?: SuperAgentApproval[];
}

export type SuperAgentTaskEventKind =
  | "created"
  | "delegated"
  | "started"
  | "settled"
  | "answered"
  | "approval_requested"
  | "approval_decided"
  | "paused"
  | "resumed"
  | "retried"
  | "cancelled"
  | "accepted"
  | "returned";

export interface SuperAgentTaskEvent {
  kind: SuperAgentTaskEventKind;
  at: number;
  runId?: string;
  text?: string;
}

export interface SuperAgentTaskInfo {
  id: string;
  roomId: string;
  title: string;
  status: SuperAgentTaskStatus;
  updatedAt: number;
  revision: number;
}

export interface SuperAgentTask extends SuperAgentTaskInfo, SuperAgentTaskBrief {
  base: string | null;
  permissionMode: SuperAgentPermissionMode;
  subtasks: SuperAgentSubtask[];
  runs: SuperAgentTaskRun[];
  planRunId: string;
  summaryRunId?: string;
  overlaps: string[];
  timeline: SuperAgentTaskEvent[];
}

export type SuperAgentTaskReview = { summaryRunId: string } & (
  { decision: "accept"; note?: string } | { decision: "return"; subtaskIds: string[]; note: string }
);
