/**
 * Pure row-model derivation for tool summary rows, following DeepSeek
 * Harness's `tool-call-model`: variant classification, a one-line argument
 * summary, the expansion-time body, and the flattened result output.
 */
import { abbreviateHomePath } from "@/lib/display-path";
import { getRelativeFilePath } from "@shared/file-paths";

export type ToolRowVariant = "search" | "read" | "bash" | "write" | "edit" | "code" | "others";

/** Row lifecycle state used by summary styling and accessible status text. */
export type ToolRowState = "preparing" | "running" | "ok" | "error" | "stopped";

type Translate = (key: string, fallback: string) => string;

/** Known wire tool name → row variant. */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  bash: "bash",
  pwsh: "bash",
  read: "read",
  read_image: "read",
  web_fetch: "read",
  grep: "search",
  glob: "search",
  search: "search",
  list: "search",
  ls: "search",
  web_search: "search",
  write: "write",
  edit: "edit",
  codemode: "code",
  run_code: "code",
};

export function classifyTool(toolName: string): ToolRowVariant {
  return TOOL_VARIANTS[toolName] ?? "others";
}

/**
 * Resolve the localized row title for a tool. Tool-owned titles refine the
 * generic variant without replacing it, so one row family keeps one glyph.
 */
export function toolRowTitle(toolName: string, t: Translate): string {
  switch (toolName) {
    case "read_image":
      return t("toolTitleReadImage", "Read image");
    case "pwsh":
      return t("toolTitleBash", "Bash");
    case "grep":
      return t("toolTitleGrep", "Grep");
    case "glob":
      return t("toolTitleGlob", "Glob");
    case "web_search":
      return t("toolTitleWebSearch", "Search");
    case "web_fetch":
      return t("toolTitleWebFetch", "Fetch");
    case "todowrite":
    case "todo_write":
      return t("toolTitleTodo", "Update to-do list");
    case "ask_user_question":
      return t("toolTitleAsk", "Ask question");
    default:
      break;
  }
  switch (classifyTool(toolName)) {
    case "search":
      return t("toolTitleSearch", "Search");
    case "read":
      return t("toolTitleRead", "Read");
    case "bash":
      return t("toolTitleBash", "Bash");
    case "write":
      return t("toolTitleWrite", "Write");
    case "edit":
      return t("toolTitleEdit", "Edit");
    case "code":
      return t("toolTitleCode", "Code");
    case "others":
    default:
      return t("toolTitleGeneric", "Tool call");
  }
}
function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** Summary key preference per variant (arguments-derived first). */
const SUMMARY_KEYS: Record<ToolRowVariant, readonly string[]> = {
  bash: ["description", "command"],
  read: ["path", "file_path", "url"],
  search: ["query", "pattern", "url", "path"],
  write: ["path", "file_path"],
  edit: ["path", "file_path"],
  code: ["description"],
  others: [],
};

const FILE_PATH_KEYS = ["path", "file_path"] as const;
const FILE_PATH_VARIANTS: ReadonlySet<ToolRowVariant> = new Set(["read", "write", "edit"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Display a workspace path relative to the session root, then abbreviate home. */
export function displayToolPath(filePath: string, cwd?: string, home?: string): string {
  return abbreviateHomePath(getRelativeFilePath(filePath, cwd), home);
}

function deriveSummary(variant: ToolRowVariant, args: Record<string, unknown>): string {
  const picked = pickString(args, SUMMARY_KEYS[variant]);
  if (picked !== undefined) return firstLine(picked);
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value !== "") return firstLine(value);
  }
  return "";
}

export interface ToolRowModel {
  variant: ToolRowVariant;
  /** Localized row title. */
  title: string;
  /** One-line argument summary rendered beside the title. */
  summary: string;
  /** Filesystem path from the arguments when this row is a file tool. */
  filePath: string | undefined;
  /** Pretty-printed argument JSON for the expanded body. */
  bodyRaw: string | null;
  /** Flattened result text; null while the call has not settled. */
  output: string | null;
  /** First result line shown when the row failed. */
  errorSummary: string | null;
  state: ToolRowState;
}

/**
 * Derive the full row model for one call and its optional settled result.
 * @param toolName - wire tool name.
 * @param input - call arguments as recorded by the provider.
 * @param result - settled result, or undefined while the call is in flight.
 * @param running - whether the owning turn still reports this call as running.
 * @param cwd - session workspace root used for relative path summaries.
 * @param home - host account home directory used for `~` abbreviation.
 * @param t - translator for the row title.
 */
export function toolRowModel(
  toolName: string,
  input: unknown,
  result: { isError?: boolean; text?: string | null } | undefined,
  running: boolean,
  cwd: string | undefined,
  home: string | undefined,
  t: Translate,
): ToolRowModel {
  const variant = classifyTool(toolName);
  const title = toolRowTitle(toolName, t);
  const args = asRecord(input);
  const state: ToolRowState =
    result === undefined ? (running ? "running" : "stopped") : result.isError ? "error" : "ok";
  const output = result?.text ?? null;
  const summaryBase = args === null ? "" : deriveSummary(variant, args);
  const rawPath = args === null ? undefined : pickString(args, FILE_PATH_KEYS);
  const filePath = FILE_PATH_VARIANTS.has(variant) && rawPath ? rawPath : undefined;
  const summaryText =
    filePath !== undefined ? displayToolPath(filePath, cwd, home) : summaryBase === "" ? "" : summaryBase;
  // Unclassified rows keep the wire name inside the summary slot so the header
  // still says which tool ran without a second title style.
  const summary = variant === "others" ? [toolName, summaryText].filter(Boolean).join(" · ") : summaryText;
  const errorSummary = state === "error" && output !== null ? firstLine(output) : null;
  return {
    variant,
    title,
    summary,
    filePath,
    bodyRaw: args === null ? null : JSON.stringify(args, null, 2),
    output,
    errorSummary,
    state,
  };
}

/** Format the collapsed row's one-line result hint used by browser tools. */
export function formatToolBody(variant: ToolRowVariant, bodyRaw: string): string | null {
  if (bodyRaw === "") return null;
  try {
    const parsed: unknown = JSON.parse(bodyRaw);
    if (variant === "code") {
      const record = asRecord(parsed);
      const code = record?.code;
      if (typeof code === "string" && code !== "") return code;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return bodyRaw;
  }
}
