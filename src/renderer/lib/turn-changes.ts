/**
 * Turn changes: the files an assistant turn edited through its tools, with the
 * diff each tool recorded. The `edit` tool reports a unified patch in its
 * result details; a full `write` only records the new content, so that case is
 * marked approximate instead of pretending to know the previous file.
 */

import { abbreviateHomePath } from "@/lib/display-path";
import { getRelativeFilePath, joinFilePath, normalizeFilePathSlashes } from "@shared/file-paths";
import type { AgentMessage } from "@shared/types";

/** One rendered diff line; `meta` lines are patch headers the card hides. */
export type TurnChangeDiffLineKind = "add" | "remove" | "context" | "hunk" | "meta";

export interface TurnChangeDiffLine {
  kind: TurnChangeDiffLineKind;
  text: string;
}

export interface TurnChangedFile {
  /** Absolute path when the workspace root was known, else the recorded path. */
  path: string;
  /** Workspace-relative, home-abbreviated label shown in the card. */
  display: string;
  added: number;
  deleted: number;
  diff: TurnChangeDiffLine[];
  /** True when the previous content was unavailable (a full-file write). */
  approximate: boolean;
  /** True when the diff itself was capped. */
  truncated: boolean;
}

/** Most diff lines kept per file; the rest collapse into one truncated marker. */
const MAX_DIFF_LINES = 600;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, keys: readonly string[]): string | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field !== "") return field;
  }
  return undefined;
}

/**
 * Split one unified patch into diff lines.
 * @param patch - `git`-style patch text reported by the edit tool.
 * @returns the lines the card renders.
 */
export function parseUnifiedPatch(patch: string): TurnChangeDiffLine[] {
  const lines: TurnChangeDiffLine[] = [];
  for (const raw of patch.split(/\r?\n/)) {
    if (raw.startsWith("@@")) {
      lines.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("Index:")) {
      lines.push({ kind: "meta", text: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "remove", text: raw.slice(1) });
    } else if (raw !== "" || lines.length > 0) {
      lines.push({ kind: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return lines;
}

/** Rebuild a diff from the edit arguments when a result carried no patch. */
function diffFromEdits(input: unknown): TurnChangeDiffLine[] {
  const record = asRecord(input);
  if (record === null) return [];
  const edits = Array.isArray(record.edits)
    ? record.edits
    : typeof record.oldText === "string" && typeof record.newText === "string"
      ? [{ oldText: record.oldText, newText: record.newText }]
      : [];
  const lines: TurnChangeDiffLine[] = [];
  for (const edit of edits) {
    const entry = asRecord(edit);
    if (entry === null) continue;
    const oldText = typeof entry.oldText === "string" ? entry.oldText : "";
    const newText = typeof entry.newText === "string" ? entry.newText : "";
    if (oldText !== "") lines.push(...oldText.split("\n").map((text) => ({ kind: "remove" as const, text })));
    if (newText !== "") lines.push(...newText.split("\n").map((text) => ({ kind: "add" as const, text })));
  }
  return lines;
}

/** Diff lines for a full-file write; only the new text is known. */
function diffFromWrittenContent(content: string): TurnChangeDiffLine[] {
  return content.split(/\r?\n/).map((text) => ({ kind: "add" as const, text }));
}

/** Cap one file's diff so a huge patch cannot freeze the transcript. */
function capDiff(lines: TurnChangeDiffLine[]): { diff: TurnChangeDiffLine[]; truncated: boolean } {
  if (lines.length <= MAX_DIFF_LINES) return { diff: lines, truncated: false };
  return {
    diff: [...lines.slice(0, MAX_DIFF_LINES), { kind: "meta", text: "…" }],
    truncated: true,
  };
}

/**
 * Collect the files one assistant turn changed.
 * @param messages - the whole transcript.
 * @param startIdx - the turn's user message index.
 * @param endIdx - the next user message index (exclusive).
 * @param options - workspace root and home directory for display labels.
 * @returns changed files in first-touched order; empty when nothing changed.
 */
export function collectTurnChanges(
  messages: readonly AgentMessage[],
  startIdx: number,
  endIdx: number,
  options: { cwd?: string | undefined; home?: string | undefined } = {},
): TurnChangedFile[] {
  const results = new Map<string, { isError?: boolean; details?: unknown }>();
  for (let index = startIdx; index < endIdx; index += 1) {
    const message = messages[index];
    if (message?.role === "toolResult") {
      results.set(message.toolCallId, { isError: message.isError, details: message.details });
    }
  }
  const files = new Map<string, TurnChangedFile>();
  for (let index = startIdx; index < endIdx; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const toolName = block.toolName;
      if (toolName !== "edit" && toolName !== "write") continue;
      const result = results.get(block.toolCallId);
      if (result?.isError === true) continue;
      const recordedPath = stringField(block.input, ["path", "file_path"]);
      if (recordedPath === undefined) continue;
      const absolutePath =
        options.cwd !== undefined && !recordedPath.match(/^(?:[a-zA-Z]:[\\/]|[\\/])/)
          ? joinFilePath(options.cwd, recordedPath)
          : normalizeFilePathSlashes(recordedPath);

      let lines: TurnChangeDiffLine[];
      let approximate = false;
      if (toolName === "edit") {
        const patch = stringField(result?.details, ["patch"]);
        lines = patch !== undefined ? parseUnifiedPatch(patch) : diffFromEdits(block.input);
        approximate = patch === undefined;
      } else {
        const content = stringField(block.input, ["content"]) ?? "";
        lines = diffFromWrittenContent(content);
        approximate = true;
      }
      const visible = lines.filter((line) => line.kind === "add" || line.kind === "remove");
      if (visible.length === 0) continue;
      const capped = capDiff(lines);
      const key = normalizeFilePathSlashes(recordedPath);
      const existing = files.get(key);
      const added = visible.filter((line) => line.kind === "add").length;
      const deleted = visible.filter((line) => line.kind === "remove").length;
      if (existing !== undefined) {
        existing.added += added;
        existing.deleted += deleted;
        existing.approximate ||= approximate;
        existing.truncated ||= capped.truncated;
        existing.diff = [...existing.diff, { kind: "meta" as const, text: "" }, ...capped.diff].slice(
          0,
          MAX_DIFF_LINES,
        );
        continue;
      }
      files.set(key, {
        path: absolutePath,
        display: abbreviateHomePath(getRelativeFilePath(absolutePath, options.cwd), options.home),
        added,
        deleted,
        diff: capped.diff,
        approximate,
        truncated: capped.truncated,
      });
    }
  }
  return [...files.values()];
}
