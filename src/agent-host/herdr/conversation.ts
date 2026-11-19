import { open, opendir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HerdrConversation, HerdrConversationMessage, HerdrPane } from "../../contract/herdr";

type Provider = "claude" | "codex" | "pi";
type LogRow = Record<string, unknown>;
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const TAIL_LIMIT = 192 * 1024;
const MESSAGE_LIMIT = 80;

function record(value: unknown): LogRow | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LogRow) : undefined;
}

function lines(data: string): LogRow[] {
  const result: LogRow[] = [];
  for (const line of data.split("\n")) {
    try {
      const row = record(JSON.parse(line));
      if (row) result.push(row);
    } catch {
      /* A writer can still be appending the last JSONL record. */
    }
  }
  return result;
}

function contained(root: string, target: string) {
  const relative = path.relative(root, target);
  return !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

async function findBySuffix(root: string, directory: string, suffix: string) {
  const safeDirectory = await realpath(directory).catch(() => null);
  if (!safeDirectory || !contained(root, safeDirectory)) return;
  const entries = await opendir(safeDirectory);
  for await (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(suffix)) return path.join(safeDirectory, entry.name);
  }
}

async function resolveFile(root: string, provider: Provider, reference: string, cwd: string) {
  if (path.isAbsolute(reference)) return reference;
  if (!uuid.test(reference)) return;
  if (provider === "claude") return path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, "-"), reference + ".jsonl");
  if (provider === "pi") {
    const directory = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
    return findBySuffix(root, path.join(root, directory), reference + ".jsonl");
  }
  // Codex rollout filenames contain UUIDv7 thread IDs; the log directory uses the local creation date.
  if (reference[14] !== "7") return;
  const created = parseInt(reference.replaceAll("-", "").slice(0, 12), 16);
  for (const delta of [0, -1, 1]) {
    const day = new Date(created + delta * 86_400_000).toISOString().slice(0, 10).split("-");
    const file = await findBySuffix(root, path.join(root, ...day), "-" + reference + ".jsonl");
    if (file) return file;
  }
}

function messages(provider: Provider, rows: LogRow[]): HerdrConversationMessage[] {
  const result: HerdrConversationMessage[] = [];
  for (const row of rows) {
    if (provider === "codex" && row.type !== "response_item") continue;
    if (provider === "pi" && row.type !== "message") continue;
    if (provider === "claude" && (row.isMeta || row.isSidechain || (row.type !== "assistant" && row.type !== "user")))
      continue;
    const message = record(provider === "codex" ? row.payload : row.message);
    if (!message) continue;
    const time = message.timestamp ?? row.timestamp;
    const timestamp = typeof time === "string" ? Date.parse(time) : time;
    function add(role: HerdrConversationMessage["role"], text: unknown, id?: unknown, isError?: boolean) {
      if (typeof text !== "string" || (!text.trim() && role !== "toolResult")) return;
      result.push({
        role,
        text,
        ...(typeof id === "string" && id ? { toolCallId: id } : {}),
        ...(isError ? { isError: true } : {}),
        ...(typeof timestamp === "number" && Number.isFinite(timestamp) ? { timestamp } : {}),
      });
    }
    const resultText = (content: unknown) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map(record)
              .filter((part) => part?.type === "text" || part?.type === "output_text")
              .map((part) => part?.text)
              .filter((s) => typeof s === "string")
              .join("\n")
          : "";
    if (message.type === "function_call" || message.type === "custom_tool_call")
      add("tool", message.name, message.call_id);
    if (message.type === "function_call_output" || message.type === "custom_tool_call_output")
      add("toolResult", resultText(message.output), message.call_id);
    if (message.type === "reasoning" && Array.isArray(message.summary)) {
      for (const part of message.summary)
        if (record(part)?.type === "summary_text") add("thinking", record(part)?.text);
    }
    if (message.role === "toolResult")
      add("toolResult", resultText(message.content), message.toolCallId, message.isError === true);
    const role = message.role;
    if (role !== "assistant" && role !== "user") continue;
    if (message.stopReason === "error") add("error", message.errorMessage);
    if (typeof message.content === "string") add(role, message.content);
    if (!Array.isArray(message.content)) continue;
    for (const item of message.content) {
      const part = record(item);
      if (!part) continue;
      if (part.type === "text" || part.type === "input_text" || part.type === "output_text") add(role, part.text);
      if (part.type === "tool_use" || part.type === "toolCall") add("tool", part.name, part.id);
      if (part.type === "tool_result")
        add("toolResult", resultText(part.content), part.tool_use_id, part.is_error === true);
      if (role === "assistant" && part.type === "thinking") add("thinking", part.thinking);
    }
  }
  return result;
}

/** Only the Host sees the private session reference. Never accept a log path from the renderer. */
export async function readHerdrConversation(
  pane: HerdrPane,
  reference: string | undefined,
): Promise<HerdrConversation | null> {
  const kind = pane.agent?.kind;
  if (!pane.cwd || !reference || (kind !== "claude" && kind !== "codex" && kind !== "pi")) return null;
  const home = os.homedir();
  const roots = {
    claude: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects"),
    codex: path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "sessions"),
    pi:
      process.env.PI_CODING_AGENT_SESSION_DIR ||
      path.join(process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), "sessions"),
  };
  try {
    const root = await realpath(roots[kind]);
    const candidate = await resolveFile(root, kind, reference, pane.cwd);
    if (!candidate || !contained(root, candidate) || path.extname(candidate) !== ".jsonl") return null;
    const file = await realpath(candidate);
    if (!contained(root, file) || path.extname(file) !== ".jsonl" || !(await stat(file)).isFile()) return null;
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const read = async (start: number, length: number) => {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, start);
        return buf.toString("utf8", 0, bytesRead);
      };
      const offset = Math.max(0, size - TAIL_LIMIT);
      const tail = await read(offset, size - offset);
      const rows = lines(offset ? tail.slice(tail.indexOf("\n") + 1) : tail);
      const header = offset ? lines(await read(0, Math.min(size, 65536))) : rows;
      // Confirm the log belongs to the pane's project before returning any of its content.
      const matchesProject = header.some((row) => {
        const metadata = kind === "codex" ? row.type === "session_meta" && record(row.payload) : row;
        return !!metadata && typeof metadata.cwd === "string" && path.relative(pane.cwd!, metadata.cwd) === "";
      });
      if (!matchesProject) return null;
      const turns = messages(kind, rows);
      return turns.length
        ? { messages: turns.slice(-MESSAGE_LIMIT), truncated: offset > 0 || turns.length > MESSAGE_LIMIT }
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
