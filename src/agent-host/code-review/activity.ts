import { StringDecoder } from "node:string_decoder";
import type { ReviewActivityEntry, ReviewActivityPage } from "../../contract/code-review";

type ModelEntry = Extract<ReviewActivityEntry, { kind: "model" }>;
type ToolEntry = Extract<ReviewActivityEntry, { kind: "tool" }>;
type Slot = { entry: ReviewActivityEntry; revision: number; size: number };

const MAX_FIELD = 96_000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const PAGE_BYTES = 512 * 1024;

function sameArguments(left: string, right: string) {
  if (left === right) return true;
  const canonical = (value: string) =>
    JSON.stringify(JSON.parse(value), (_, input: unknown) =>
      input && typeof input === "object" && !Array.isArray(input)
        ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : input,
    );
  try {
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

/** A cursor tracks updates to existing rows as well as new rows. */
export class ReviewActivityLog {
  private rows = new Map<number, Slot>();
  private tools = new Map<string, number>();
  private pending = new Set<number>();
  private revision = 0;
  private nextId = 0;
  private size = 0;
  private secrets = new Set<string>();
  private warnings = new Set<string>();
  onSettled?: (entry: ReviewActivityEntry) => void;
  truncated = false;

  setGatewayToken(token: string) {
    this.addSecrets([token]);
  }

  addSecrets(values: unknown[]) {
    for (const value of values) {
      if (typeof value !== "string" || value.trim().length < 6) continue;
      this.secrets.add(value);
      this.secrets.add(JSON.stringify(value).slice(1, -1));
    }
  }

  redactReport(text: string) {
    if (!text || !this.secrets.size) return text;
    try {
      return JSON.stringify(
        JSON.parse(text, (key: string, value: unknown) =>
          typeof value === "string" && key !== "session_id" && key !== "status" ? this.safe(value) : value,
        ),
      );
    } catch {
      return this.safe(text);
    }
  }

  private safe(text: string) {
    for (const secret of this.secrets) text = text.replaceAll(secret, "[redacted]");
    return text;
  }

  private diagnostic(text: string) {
    return this.safe(text)
      .replace(/\bBearer\s+[^\s"',;]+/giu, "Bearer [redacted]")
      .replace(
        /(["']?(?:api[-_ ]?key|authorization|password|secret|access[-_ ]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
        "$1[redacted]",
      )
      .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (value) => {
        const url = URL.canParse(value) ? new URL(value) : null;
        return url ? url.origin + url.pathname : "[url]";
      })
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/gu, "[redacted]")
      .trim()
      .slice(0, 2000);
  }

  private put(row: ReviewActivityEntry) {
    const size =
      row.kind === "model"
        ? row.text.length + row.reasoning.length
        : row.kind === "tool"
          ? row.input.length + (row.output?.length ?? 0)
          : row.message.length;
    this.size += size - (this.rows.get(row.id)?.size ?? 0);
    this.rows.set(row.id, { entry: row, revision: ++this.revision, size });
    if (!("status" in row) || row.status !== "running") this.onSettled?.(row);
    while (this.rows.size > MAX_ENTRIES || this.size > MAX_BYTES) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.size -= this.rows.get(oldest)!.size;
      this.rows.delete(oldest);
      this.pending.delete(oldest);
      this.truncated = true;
    }
  }

  beginModel(model: string, provider: string, at = Date.now()) {
    const id = ++this.nextId;
    this.put({ kind: "model", id, at, model, provider, text: "", reasoning: "", status: "running" });
    return id;
  }

  delta(id: number, key: "text" | "reasoning", value: string) {
    const row = this.rows.get(id)?.entry;
    if (row?.kind !== "model" || !value || row[key].length >= MAX_FIELD) return;
    // Keep enough overlap to redact a token split across chunks. Redact before returning a page as well.
    const text = row[key] + value;
    this.put({ ...row, [key]: text.slice(0, MAX_FIELD), truncated: row.truncated || text.length > MAX_FIELD });
  }

  finishModel(
    id: number,
    patch: Pick<ModelEntry, "status"> &
      Partial<
        Pick<
          ModelEntry,
          | "model"
          | "provider"
          | "text"
          | "reasoning"
          | "inputTokens"
          | "outputTokens"
          | "durationMs"
          | "issue"
          | "diagnostic"
        >
      >,
  ) {
    const row = this.rows.get(id)?.entry;
    if (row?.kind !== "model") return;
    const text = this.safe(patch.text ?? row.text);
    const reasoning = this.safe(patch.reasoning ?? row.reasoning);
    this.put({
      ...row,
      ...patch,
      text: text.slice(0, MAX_FIELD),
      reasoning: reasoning.slice(0, MAX_FIELD),
      diagnostic: patch.diagnostic ? this.diagnostic(patch.diagnostic) : undefined,
      durationMs: patch.durationMs ?? Date.now() - row.at,
      truncated: row.truncated || text.length > MAX_FIELD || reasoning.length > MAX_FIELD,
    });
  }

  beginTool(callId: string, name: string, args: string) {
    const id = ++this.nextId;
    this.tools.set(callId, id);
    if (this.tools.size > MAX_ENTRIES) this.tools.delete(this.tools.keys().next().value!);
    this.pending.add(id);
    this.put({
      kind: "tool",
      id,
      at: Date.now(),
      name,
      input: this.safe(args).slice(0, MAX_FIELD),
      status: "running",
      truncated: args.length > MAX_FIELD,
    });
  }

  forwardedToolResult(callId: string, result: string) {
    const id = this.tools.get(callId);
    const row = id === undefined ? undefined : this.rows.get(id)?.entry;
    if (row?.kind !== "tool" || row.output !== undefined) return;
    this.put({
      ...row,
      output: this.safe(result).slice(0, MAX_FIELD),
      status: "done",
      truncated: row.truncated || result.length > MAX_FIELD,
    });
  }

  nativeToolResult(input: {
    name: string;
    input: string;
    output: string;
    ok: boolean;
    at: number;
    path?: string;
    task?: string;
    durationMs?: number;
  }) {
    const args = this.safe(input.input).slice(0, MAX_FIELD);
    let found: ToolEntry | undefined;
    for (const id of this.pending) {
      const row = this.rows.get(id)?.entry;
      if (row?.kind === "tool" && row.name === input.name && sameArguments(row.input, args)) {
        found = row;
        this.pending.delete(id);
        break;
      }
    }
    this.put({
      kind: "tool",
      id: found?.id ?? ++this.nextId,
      at: found?.at ?? input.at,
      name: input.name,
      input: args,
      output: this.safe(input.output).slice(0, MAX_FIELD),
      path: input.path,
      task: input.task,
      durationMs: input.durationMs,
      status: input.ok ? "done" : "error",
      truncated: input.input.length > MAX_FIELD || input.output.length > MAX_FIELD,
    });
  }

  warning(message: string) {
    const safe = this.diagnostic(message);
    if (!safe || this.warnings.has(safe)) return;
    if (this.warnings.size < MAX_ENTRIES) this.warnings.add(safe);
    this.put({ kind: "warning", id: ++this.nextId, at: Date.now(), message: safe });
  }

  reportWarnings(raw: string) {
    if (!raw) return;
    try {
      const { warnings } = JSON.parse(raw);
      if (Array.isArray(warnings))
        for (const entry of warnings) {
          if (typeof entry?.message === "string") this.warning(entry.message);
        }
    } catch {
      /* The report parser exposes malformed output separately. */
    }
  }

  stderr() {
    const decoder = new StringDecoder("utf8");
    let tail = "";
    const readLine = (line: string) => {
      const message = /^\[ocr\]\s+(.+)/u.exec(line)?.[1];
      if (!message) return;
      const warning = /^(?:WARNING|ERROR)(?:\s+\[[^\]]+\])?\s*:?\s+(.+)/u.exec(message);
      if (warning) {
        this.warning(warning[1]);
      } else {
        const safe = this.diagnostic(message);
        if (safe) this.put({ kind: "engine", id: ++this.nextId, at: Date.now(), message: safe });
      }
    };
    return {
      write(chunk: Buffer) {
        const lines = (tail + decoder.write(chunk)).split(/\r\n|\n|\r/u);
        tail = (lines.pop() ?? "").slice(0, 4096);
        for (const line of lines) readLine(line);
      },
      flush() {
        readLine(tail + decoder.end());
      },
    };
  }

  page(after: number): ReviewActivityPage {
    const changed = [...this.rows.values()]
      .filter((row) => row.revision > after)
      .sort((a, b) => a.revision - b.revision);
    const entries: ReviewActivityEntry[] = [];
    let cursor = after;
    let bytes = 0;
    for (const { entry, revision, size } of changed) {
      if (entries.length && (entries.length >= 80 || bytes + size * 2 > PAGE_BYTES)) break;
      cursor = revision;
      bytes += size * 2;
      entries.push(
        entry.kind === "model"
          ? { ...entry, text: this.safe(entry.text), reasoning: this.safe(entry.reasoning) }
          : entry,
      );
    }
    return {
      entries,
      cursor,
      more: entries.length < changed.length,
      truncated: this.truncated,
      firstId: this.rows.keys().next().value,
    };
  }

  pendingEntries(): ReviewActivityEntry[] {
    return [...this.rows.values()].flatMap(({ entry }) => {
      if (!("status" in entry) || entry.status !== "running") return [];
      return [
        entry.kind === "model"
          ? { ...entry, text: this.safe(entry.text), reasoning: this.safe(entry.reasoning) }
          : entry,
      ];
    });
  }
}
