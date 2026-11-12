import type { ThinkingLevelOption } from "../shared/thinking-levels";

export type ReviewModelSelection = { provider: string; modelId: string; thinking: ThinkingLevelOption };
export type ReviewScope =
  | { kind: "workspace" }
  | { kind: "branch"; from: string; to?: string }
  | { kind: "commit"; ref: string }
  | { kind: "scan"; paths?: string };
export type ReviewOptions = {
  background?: string;
  backgroundFile?: string;
  exclude?: string;
  rule?: string;
  tools?: string;
  effort?: "auto" | "low" | "medium" | "high";
  concurrency?: number;
  maxTokens?: number;
  maxTokensBudget?: number;
  maxTools?: number;
  maxGitProcs?: number;
  noFilter?: boolean;
  noPlan?: boolean;
  noDedup?: boolean;
  noSummary?: boolean;
  batch?: "none" | "by-language" | "by-directory";
  resume?: string;
};
export const REVIEW_OPTION_DEFAULTS = {
  effort: "low",
  concurrency: 1,
  maxTokens: 0,
  maxTokensBudget: 0,
  maxTools: 0,
} as const satisfies ReviewOptions;

export type ReviewRequest = { cwd: string; scope: ReviewScope; options?: ReviewOptions };
export type ReviewDiffRequest = ReviewRequest & { path: string };
export type ReviewDiff = { path: string; text: string; truncated: boolean };
export type ReviewBranches = {
  current: string | null;
  base: string | null;
  refs: { ref: string; label: string; kind: "local" | "remote" | "pull" }[];
};
export type ReviewExportFormat = "text" | "json" | "sarif" | "html";
export const OCR_CONFIG_LIMIT = 256 * 1024;
export type ReviewConfigSnapshot = { revision: string; text: string };
export type ReviewEngineStatus = { effort: "low" | "medium" | "high" };
export type ReviewMcpSnapshot = { revision: string; text: string };

export type ReviewCommand =
  | { kind: "sessions"; cwd: string; limit?: number; format?: "text" | "json" }
  | { kind: "sessionShow"; cwd: string; id: string; format?: "text" | "json" }
  | { kind: "sessionDelete"; cwd: string; id: string }
  | { kind: "sessionComments"; cwd: string; id: string; severity?: string; category?: string; format?: "text" | "json" }
  | { kind: "sessionCompare"; cwd: string; before: string; after: string; format?: "text" | "json" }
  | { kind: "sessionExport"; cwd: string; id?: string; runId?: string; format?: ReviewExportFormat }
  | { kind: "ruleCheck"; cwd: string; file: string; rule?: string }
  | { kind: "delegatePreview"; request: ReviewRequest; format?: "text" | "json" }
  | { kind: "delegateRule"; request: ReviewRequest; files: string; format?: "text" | "json" }
  | { kind: "engineConfig"; key: "language" | "max_tokens" | "effort"; value?: string }
  | { kind: "completion"; shell: "bash" | "zsh" | "fish" | "powershell" }
  | {
      kind: "help";
      command:
        "review" | "scan" | "session" | "rules" | "delegate" | "config" | "auth" | "llm" | "viewer" | "completion";
    }
  | { kind: "version" | "providers" | "viewer" | "viewerStop" };

export type ReviewCommandOutput = { text: string; filename?: string; viewerUrl?: string };

export type ReviewFile = {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
  included: boolean;
  reason?: string;
};

export type ReviewPreview = {
  id: string;
  root: string;
  version: string;
  scope: ReviewScope;
  diffScope?: ReviewScope;
  files: ReviewFile[];
};

export type ReviewFinding = {
  id: number;
  path: string;
  line: number | null;
  endLine: number | null;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  category?: string;
  message: string;
  suggestion?: string;
};

export type ReviewState = "running" | "cancelling" | "complete" | "partial" | "skipped" | "failed" | "cancelled";
export type ReviewIssue =
  | "runtime"
  | "gitMissing"
  | "gitOld"
  | "notRepository"
  | "stalePreview"
  | "scopeLimit"
  | "busy"
  | "profile"
  | "credentials"
  | "authentication"
  | "rateLimit"
  | "tokenBudget"
  | "timeout"
  | "invalidOutput"
  | "configInvalid"
  | "configChanged"
  | "mcpConfig"
  | "mcpChanged"
  | "mcpSetup"
  | "containment"
  | "failed";

export type ReviewRun = {
  id: string;
  root: string;
  projectRoot?: string;
  request: ReviewRequest;
  state: ReviewState;
  startedAt: number;
  finishedAt?: number;
  model: string;
  contextWindow?: number;
  activityStats?: ReviewActivityStats;
  worktreeBranch?: string;
  scope: ReviewScope;
  diffScope?: ReviewScope;
  files: ReviewFile[];
  sessionId?: string;
  findings: ReviewFinding[];
  warningCount: number;
  mcpWarning?: boolean;
  filesReviewed?: number;
  stale?: boolean;
  issue?: ReviewIssue;
};

export type ReviewReply<T> = { ok: true; value: T } | { ok: false; issue: ReviewIssue };

type ActivityBase = { id: number; at: number; truncated?: boolean };
export type ReviewActivityEntry = ActivityBase &
  (
    | {
        kind: "model";
        model: string;
        provider: string;
        text: string;
        reasoning: string;
        status: "running" | "done" | "error";
        durationMs?: number;
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        contextWindow?: number;
        toolUse?: boolean;
        issue?: ReviewIssue;
        diagnostic?: string;
      }
    | {
        kind: "tool";
        name: string;
        input: string;
        output?: string;
        path?: string;
        task?: string;
        status: "running" | "done" | "error";
        durationMs?: number;
      }
    | { kind: "warning" | "engine"; message: string }
  );
export type ReviewActivityStats = {
  modelCalls: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  context?: { tokens: number; window: number };
  modelDurationMs?: number;
  toolDurationMs?: number;
};
export type ReviewActivityPage = {
  entries: ReviewActivityEntry[];
  cursor: number;
  more: boolean;
  truncated: boolean;
  firstId?: number;
  stats?: ReviewActivityStats;
};

export type ReviewHistoryRef = { archiveId: string } | { cwd: string; sessionId: string };
export type ReviewHistoryRow = {
  ref: ReviewHistoryRef;
  root: string;
  projectRoot?: string;
  sessionId?: string;
  startedAt: number;
  model: string;
  scope: ReviewScope;
  state: ReviewState;
};
export type ReviewHistoryDetail = {
  ref: ReviewHistoryRef;
  run: ReviewRun;
  snapshot: "saved" | "partial" | "unavailable";
  legacy: boolean;
};
