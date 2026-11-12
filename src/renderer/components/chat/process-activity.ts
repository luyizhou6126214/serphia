/**
 * Process-activity classification and localized group titles, following DeepSeek
 * Harness's `process-groups` + `step-process` modules: a settled group names its
 * top three activity kinds, and a live group names the activity in flight.
 */
import type { AgentMessage, AssistantContentBlock, ToolCallContent } from "@/lib/types";

export type ProcessActivityKind =
  | "thinking"
  | "read"
  | "readImage"
  | "write"
  | "search"
  | "edit"
  | "commands"
  | "code"
  | "webSearch"
  | "webFetch"
  | "subagents"
  | "plan"
  | "questions"
  | "tools";

export interface ProcessActivityCount {
  readonly kind: ProcessActivityKind;
  readonly count: number;
}

export interface ProcessActivitySummary {
  /** Ranked activity evidence, most frequent first. */
  readonly counts: readonly ProcessActivityCount[];
}

type Translate = (key: string, fallback: string) => string;

const TOOL_ACTIVITY: Record<string, ProcessActivityKind> = {
  bash: "commands",
  pwsh: "commands",
  read: "read",
  file_read: "read",
  file_read_diff: "read",
  read_image: "readImage",
  write: "write",
  edit: "edit",
  grep: "search",
  glob: "search",
  ls: "search",
  search: "search",
  code_search: "search",
  file_find: "search",
  web_search: "webSearch",
  web_fetch: "webFetch",
  codemode: "code",
  run_code: "code",
  ask_user_question: "questions",
  todowrite: "plan",
  todo_write: "plan",
};

/** Classify one tool name into the activity vocabulary group titles use. */
export function toolActivity(toolName: string): ProcessActivityKind {
  if (toolName.startsWith("subagent") || toolName === "list_agents" || toolName === "send_message") {
    return "subagents";
  }
  return TOOL_ACTIVITY[toolName] ?? "tools";
}

/** Classify one assistant content block. */
export function blockActivity(block: AssistantContentBlock): ProcessActivityKind {
  if (block.type === "thinking") return "thinking";
  if (block.type === "toolCall") return toolActivity((block as ToolCallContent).toolName);
  return "tools";
}

/** The first activity a message reports, used for the live group title. */
export function messageActivity(message: AgentMessage): ProcessActivityKind {
  if (message.role !== "assistant") return "thinking";
  const content = (message as { content?: readonly AssistantContentBlock[] }).content;
  if (!Array.isArray(content)) return "thinking";
  for (const block of content) {
    if (block.type === "thinking") return "thinking";
    if (block.type === "toolCall") return toolActivity((block as ToolCallContent).toolName);
  }
  return "thinking";
}

/** Rank the activities of a set of process messages without counts in the title. */
export function summarizeActivity(messages: readonly AgentMessage[]): ProcessActivitySummary {
  const counts = new Map<ProcessActivityKind, number>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const content = (message as { content?: readonly AssistantContentBlock[] }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const kind = blockActivity(block);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count);
  return { counts: ranked };
}

/** Localized label for the activity a settled group reports. */
function doneLabel(kind: ProcessActivityKind, t: Translate): string {
  switch (kind) {
    case "read":
      return t("stepProcessDoneRead", "Read files");
    case "readImage":
      return t("stepProcessDoneReadImage", "Read images");
    case "write":
      return t("stepProcessDoneWrite", "Wrote files");
    case "search":
      return t("stepProcessDoneSearch", "Searched code");
    case "edit":
      return t("stepProcessDoneEdit", "Edited files");
    case "commands":
      return t("stepProcessDoneCommands", "Ran commands");
    case "code":
      return t("stepProcessDoneCode", "Ran code");
    case "webSearch":
      return t("stepProcessDoneWebSearch", "Searched the web");
    case "webFetch":
      return t("stepProcessDoneWebFetch", "Visited web pages");
    case "subagents":
      return t("stepProcessDoneSubagents", "Coordinated subagents");
    case "plan":
      return t("stepProcessDonePlan", "Updated the plan");
    case "questions":
      return t("stepProcessDoneQuestions", "Asked questions");
    case "tools":
      return t("stepProcessDoneTools", "Called tools");
    case "thinking":
    default:
      return t("stepProcessDoneThinking", "Analysis completed");
  }
}

/** Localized label for the activity in flight. */
function runningLabel(kind: ProcessActivityKind, t: Translate): string {
  switch (kind) {
    case "read":
      return t("stepProcessRunningRead", "Reading files");
    case "readImage":
      return t("stepProcessRunningReadImage", "Reading images");
    case "write":
      return t("stepProcessRunningWrite", "Writing files");
    case "search":
      return t("stepProcessRunningSearch", "Searching code");
    case "edit":
      return t("stepProcessRunningEdit", "Editing files");
    case "commands":
      return t("stepProcessRunningCommands", "Running commands");
    case "code":
      return t("stepProcessRunningCode", "Running code");
    case "webSearch":
      return t("stepProcessRunningWebSearch", "Searching the web");
    case "webFetch":
      return t("stepProcessRunningWebFetch", "Visiting web pages");
    case "subagents":
      return t("stepProcessRunningSubagents", "Coordinating subagents");
    case "plan":
      return t("stepProcessRunningPlan", "Updating the plan");
    case "questions":
      return t("stepProcessRunningQuestions", "Waiting for your action");
    case "tools":
      return t("stepProcessRunningTools", "Calling tools");
    case "thinking":
    default:
      return t("stepProcessRunningThinking", "Analyzing the request");
  }
}

/** Localized label for the activity a call is being prepared for. */
function prepareLabel(kind: ProcessActivityKind, t: Translate): string {
  switch (kind) {
    case "read":
      return t("stepProcessPrepareRead", "Preparing to read files");
    case "readImage":
      return t("stepProcessPrepareReadImage", "Preparing to read images");
    case "write":
      return t("stepProcessPrepareWrite", "Preparing to write files");
    case "search":
      return t("stepProcessPrepareSearch", "Preparing to search code");
    case "edit":
      return t("stepProcessPrepareEdit", "Preparing to edit files");
    case "commands":
      return t("stepProcessPrepareCommands", "Preparing to run commands");
    case "code":
      return t("stepProcessPrepareCode", "Preparing to run code");
    case "webSearch":
      return t("stepProcessPrepareWebSearch", "Preparing to search the web");
    case "webFetch":
      return t("stepProcessPrepareWebFetch", "Preparing to visit web pages");
    case "subagents":
      return t("stepProcessPrepareSubagents", "Preparing to coordinate subagents");
    case "plan":
      return t("stepProcessPreparePlan", "Preparing to update the plan");
    case "questions":
      return t("stepProcessPrepareQuestions", "Preparing questions");
    case "thinking":
    case "tools":
    default:
      return t("stepProcessPrepareTools", "Preparing tool calls");
  }
}

/**
 * Compose a settled group's localized title from its top three activity kinds.
 */
export function processTitle(summary: ProcessActivitySummary, t: Translate): string {
  const labels = summary.counts.slice(0, 3).map(({ kind }) => doneLabel(kind, t));
  const first = labels[0];
  if (first === undefined) return doneLabel("thinking", t);
  const continuation = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);
  const second = labels[1];
  if (second === undefined) return first;
  if (labels.length === 2) {
    const prefix = t("stepProcessSharedPrefix", "");
    const shared = prefix !== "" && first.startsWith(prefix) && second.startsWith(prefix);
    return t("stepProcessJoinTwo", "{first} and {second}")
      .replace("{first}", first)
      .replace("{second}", continuation(shared ? second.slice(prefix.length) : second));
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(t("stepProcessComma", ", "));
  return summary.counts.length > 3 ? t("stepProcessMore", "{title}, etc.").replace("{title}", title) : title;
}

/** Compose a live group's title for the activity currently in flight. */
export function liveProcessTitle(activity: ProcessActivityKind, preparing: boolean, t: Translate): string {
  return preparing ? prepareLabel(activity, t) : runningLabel(activity, t);
}

/** Join a group title with the live activity detail, when the policy shows one. */
export function processTitleWithDetail(title: string, detail: string, t: Translate): string {
  if (detail === "") return title;
  return `${title}${t("turnProcessSeparator", " · ")}${detail}`;
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

const DETAIL_SUMMARY_KEYS: Record<ProcessActivityKind, readonly string[]> = {
  thinking: [],
  read: ["path", "file_path", "url"],
  readImage: ["path", "file_path"],
  write: ["path", "file_path"],
  search: ["query", "pattern", "search_text", "url"],
  edit: ["path", "file_path"],
  commands: ["description", "command"],
  code: ["description"],
  webSearch: ["query", "queries"],
  webFetch: ["url"],
  subagents: ["description", "prompt"],
  plan: ["description"],
  questions: ["question", "questions"],
  tools: [],
};

/**
 * The running command, path, query, or reasoning line a live group header shows
 * beside its activity title. Empty when the tail carries no displayable detail.
 */
export function liveActivityDetail(message: AgentMessage | undefined): string {
  if (message === undefined || message.role !== "assistant") return "";
  const content = (message as { content?: readonly AssistantContentBlock[] }).content;
  if (!Array.isArray(content)) return "";
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block === undefined) continue;
    if (block.type === "thinking") {
      const line = firstLine(String((block as { thinking?: unknown }).thinking ?? "").trim());
      if (line !== "") return line;
      continue;
    }
    if (block.type !== "toolCall") continue;
    const call = block as ToolCallContent;
    const kind = toolActivity(call.toolName);
    const input = call.input;
    if (typeof input !== "object" || input === null) return "";
    const record = input as Record<string, unknown>;
    for (const key of DETAIL_SUMMARY_KEYS[kind]) {
      const value = record[key];
      if (typeof value === "string" && value !== "") return firstLine(value);
      if (Array.isArray(value)) {
        const first = value.find((item): item is string => typeof item === "string" && item !== "");
        if (first !== undefined) return firstLine(first);
      }
    }
    for (const value of Object.values(record)) {
      if (typeof value === "string" && value !== "") return firstLine(value);
    }
    return "";
  }
  return "";
}
