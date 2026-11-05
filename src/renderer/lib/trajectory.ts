import type { TrajectoryContextEntry } from "@contract/types";
import { stripAnsi } from "../../shared/ansi.ts";
import type {
  AgentMessage,
  AssistantMessage,
  CustomMessage,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from "./types";

/**
 * Pure projection of the loaded chat transcript into a trajectory ledger.
 *
 * Timing is derived from the session timestamps pi persists on messages. Some
 * intervals (for example an assistant message followed by a tool result) also
 * contain tool execution, so the UI labels these as recorded intervals rather
 * than claiming exact model latency.
 */

export type TrajectoryRowKind = "user" | "assistant" | "tool" | "context" | "system";
export type TrajectoryStatus = "completed" | "running" | "pending" | "failed" | "aborted";
export type TrajectoryLane = "input" | "model" | "tool";
export type TrajectoryNotice = "model" | "compaction" | "system-prompt";

export interface TrajectoryUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

export interface TrajectoryRow {
  id: string;
  kind: TrajectoryRowKind;
  turn: number;
  timestamp?: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status: TrajectoryStatus;
  /** Localizable identity: a tool name, model name or custom message type. */
  title: string;
  text: string;
  detailText: string;
  model?: string;
  provider?: string;
  previousModel?: string;
  usage?: TrajectoryUsage;
  toolName?: string;
  toolCallId?: string;
  toolInput?: string;
  toolOutput?: string;
  isError?: boolean;
  errorMessage?: string;
  images?: number;
  files?: number;
  thinking?: string;
  notice?: TrajectoryNotice;
  compactedTokens?: number;
}

export interface TrajectorySpan {
  id: string;
  rowId: string;
  kind: TrajectoryRowKind;
  lane: TrajectoryLane;
  start: number;
  end: number;
  durationMs: number;
  status: TrajectoryStatus;
}

export interface TrajectoryTurn {
  /** 1-based user turn. 0 is the section before the first user message. */
  index: number;
  rows: TrajectoryRow[];
  spans: TrajectorySpan[];
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
  usage?: TrajectoryUsage;
  toolCount: number;
  assistantCount: number;
  status: TrajectoryStatus;
}

export interface TrajectorySnapshot {
  turns: TrajectoryTurn[];
  rows: TrajectoryRow[];
  start?: number;
  end?: number;
  durationMs?: number;
  totalTokens: number;
  totalCost: number;
  toolCount: number;
  userCount: number;
  assistantCount: number;
  status: TrajectoryStatus;
  hasTiming: boolean;
}

export interface TrajectoryAgentPhase {
  kind: "waiting_model" | "running_command" | "running_tools";
  tools?: readonly { id: string; name: string }[];
}

export interface BuildTrajectoryOptions {
  entryIds?: readonly string[];
  runningToolCallIds?: ReadonlySet<string>;
  streamingMessage?: Partial<AgentMessage> | null;
  agentRunning?: boolean;
  agentPhase?: TrajectoryAgentPhase | null;
  now?: number;
  /** Display names keyed by `provider:model` and by bare model id. */
  modelNames?: Record<string, string>;
  /** Persisted system/custom/context-edit records that are not chat messages. */
  contextEntries?: readonly TrajectoryContextEntry[];
}

const PREVIEW_LIMIT = 220;
const DETAIL_LIMIT = 120_000;
const TOOL_DETAIL_LIMIT = 64_000;

function textPreview(text: string, limit = PREVIEW_LIMIT): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

function limitDetail(text: string): string {
  return text.length <= DETAIL_LIMIT ? text : `${text.slice(0, DETAIL_LIMIT)}\n\n… [truncated]`;
}

function textFromContent(content: unknown): { text: string; images: number; files: number } {
  if (typeof content === "string") return { text: content, images: 0, files: 0 };
  if (!Array.isArray(content)) return { text: "", images: 0, files: 0 };
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
    else if (typed.type === "image") images += 1;
  }
  return { text: parts.join("\n"), images, files: 0 };
}

function attachmentCounts(message: UserMessage): { images: number; files: number } {
  let images = 0;
  let files = 0;
  for (const attachment of message.channelAttachments ?? []) {
    if (attachment.kind === "image") images += 1;
    else files += 1;
  }
  return { images, files };
}

function displayModel(
  provider: string | undefined,
  model: string | undefined,
  names: Record<string, string> | undefined,
): string | undefined {
  if (!model) return undefined;
  if (!names) return model;
  return names[`${provider ?? ""}:${model}`] ?? names[model] ?? model;
}

function normalizeUsage(usage: AssistantMessage["usage"]): TrajectoryUsage | undefined {
  if (!usage) return undefined;
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total,
    cost: usage.cost.total,
  };
}

function addUsage(total: TrajectoryUsage | undefined, usage: TrajectoryUsage | undefined): TrajectoryUsage | undefined {
  if (!usage) return total;
  if (!total) return usage;
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead,
    cacheWrite: total.cacheWrite + usage.cacheWrite,
    total: total.total + usage.total,
    cost: total.cost + usage.cost,
  };
}

function safeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function limitToolDetail(text: string): string {
  return text.length <= TOOL_DETAIL_LIMIT ? text : `${text.slice(0, TOOL_DETAIL_LIMIT)}\n\n… [truncated]`;
}

function toolInputText(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const preview = input.preview;
  if (typeof preview === "string" && Object.keys(input).length === 1) return limitToolDetail(preview);
  return limitToolDetail(safeJson(input));
}

function toolInputSummary(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const keys = [
    "command",
    "cmd",
    "script",
    "pattern",
    "query",
    "path",
    "file_path",
    "filePath",
    "url",
    "description",
    "prompt",
    "name",
    "id",
  ];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return textPreview(value, 140);
  }
  const preview = input.preview;
  if (typeof preview === "string" && preview.trim()) return textPreview(preview, 140);
  const keysList = Object.keys(input);
  if (keysList.length === 0) return "";
  return textPreview(safeJson(input), 140);
}

function toolResultText(result: ToolResultMessage | undefined): string {
  if (!result) return "";
  return stripAnsi(textFromContent(result.content).text).replace(/\r\n?/g, "\n");
}

function assistantBlocks(message: AssistantMessage): {
  text: string;
  thinking: string;
  images: number;
  toolCalls: ToolCallContent[];
} {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCallContent[] = [];
  let images = 0;
  for (const block of message.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text.trim()) textParts.push(block.text);
        break;
      case "thinking":
        if (block.thinking.trim()) thinkingParts.push(block.thinking);
        break;
      case "toolCall":
        toolCalls.push(block);
        break;
      case "image":
        images += 1;
        break;
    }
  }
  return { text: textParts.join("\n"), thinking: thinkingParts.join("\n"), images, toolCalls };
}

function blockImages(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter(
    (block) => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "image",
  ).length;
}

function statusForAssistant(message: AssistantMessage): TrajectoryStatus {
  if (message.stopReason === "error") return "failed";
  if (message.stopReason === "aborted") return "aborted";
  return "completed";
}

function nextTimestamp(rows: readonly TrajectoryRow[], index: number): number | undefined {
  for (let next = index + 1; next < rows.length; next += 1) {
    if (typeof rows[next].timestamp === "number") return rows[next].timestamp;
  }
  return undefined;
}

function laneFor(kind: TrajectoryRowKind): TrajectoryLane {
  if (kind === "assistant") return "model";
  if (kind === "tool") return "tool";
  return "input";
}

function firstDefined(...values: Array<number | undefined>): number | undefined {
  for (const value of values) if (typeof value === "number") return value;
  return undefined;
}

function latestTimestamp(rows: readonly TrajectoryRow[]): number | undefined {
  let latest: number | undefined;
  for (const row of rows) {
    const value = row.endedAt ?? row.timestamp;
    if (typeof value === "number" && (latest === undefined || value > latest)) latest = value;
  }
  return latest;
}

function turnStatus(rows: readonly TrajectoryRow[], running: boolean): TrajectoryStatus {
  if (running) return "running";
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "aborted")) return "aborted";
  if (rows.some((row) => row.status === "running")) return "running";
  return "completed";
}

/**
 * Build a trajectory snapshot from the session messages already loaded by the
 * chat view. Tool results are paired with their calls; orphan results still
 * appear so no recorded activity disappears.
 */
export function buildTrajectory(
  messages: readonly AgentMessage[],
  options: BuildTrajectoryOptions = {},
): TrajectorySnapshot {
  const now = options.now ?? Date.now();
  const entryIds = options.entryIds ?? [];
  const runningToolCallIds = options.runningToolCallIds ?? new Set<string>();
  const modelNames = options.modelNames;
  const agentRunning = options.agentRunning === true;
  const rows: TrajectoryRow[] = [];

  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") results.set(message.toolCallId, message);
  }

  let turn = 0;
  let turnHasUser = false;
  let previousModel: string | undefined;
  let previousProvider: string | undefined;
  const consumedResults = new Set<string>();

  const pushRow = (row: TrajectoryRow) => {
    rows.push(row);
    if (row.kind === "user") turnHasUser = true;
  };

  const pushToolRows = (message: AssistantMessage, baseId: string, start: number | undefined, running: boolean) => {
    const blocks = assistantBlocks(message);
    blocks.toolCalls.forEach((call, index) => {
      const result = results.get(call.toolCallId);
      if (result) consumedResults.add(call.toolCallId);
      const startedAt = start;
      const endedAt = result?.timestamp;
      const durationMs =
        typeof startedAt === "number" && typeof endedAt === "number" && endedAt >= startedAt
          ? endedAt - startedAt
          : undefined;
      const isRunning = !result && (runningToolCallIds.has(call.toolCallId) || running);
      const status: TrajectoryStatus = result
        ? result.isError
          ? "failed"
          : "completed"
        : isRunning
          ? "running"
          : "pending";
      const output = toolResultText(result);
      const input = toolInputText(call.input);
      const summary = toolInputSummary(call.input);
      const outputPreview = textPreview(output.split(/\r?\n/).find((line) => line.trim()) ?? "", 160);
      pushRow({
        id: `${baseId}:tool:${call.toolCallId || index}`,
        kind: "tool",
        turn,
        timestamp: startedAt,
        startedAt,
        endedAt,
        durationMs,
        status,
        title: call.toolName || "tool",
        text: summary,
        detailText: outputPreview,
        toolName: call.toolName || undefined,
        toolCallId: call.toolCallId || undefined,
        toolInput: input,
        toolOutput: limitToolDetail(output),
        isError: result?.isError ?? false,
        images: result ? blockImages(result.content) : undefined,
      });
    });
  };

  const pushAssistant = (
    message: AssistantMessage,
    baseId: string,
    timestamp: number | undefined,
    running: boolean,
  ) => {
    if (turn === 0 && !turnHasUser && rows.length === 0) turn = 1;
    const blocks = assistantBlocks(message);
    const model = displayModel(message.provider, message.model, modelNames);
    if (previousModel && model && (model !== previousModel || message.provider !== previousProvider)) {
      pushRow({
        id: `${baseId}:model`,
        kind: "system",
        turn,
        timestamp,
        startedAt: timestamp,
        status: "completed",
        title: "model",
        text: "",
        detailText: "",
        model,
        provider: message.provider,
        previousModel,
        notice: "model",
      });
    }
    const status = running ? "running" : statusForAssistant(message);
    const errorMessage = status === "failed" && message.errorMessage ? limitDetail(message.errorMessage) : undefined;
    pushRow({
      id: baseId,
      kind: "assistant",
      turn,
      timestamp,
      startedAt: timestamp,
      status,
      title: model ?? message.provider ?? "assistant",
      text: textPreview(blocks.text) || (errorMessage ? textPreview(errorMessage) : ""),
      detailText: limitDetail(blocks.text),
      model,
      provider: message.provider,
      usage: normalizeUsage(message.usage),
      thinking: blocks.thinking ? limitDetail(blocks.thinking) : undefined,
      images: blocks.images || undefined,
      errorMessage,
    });
    pushToolRows(message, baseId, timestamp, running);
    if (model) {
      previousModel = model;
      previousProvider = message.provider;
    }
  };

  messages.forEach((message, index) => {
    const entryId = entryIds[index] || `message-${index}`;
    switch (message.role) {
      case "user": {
        if (turn === 0 || turnHasUser) {
          turn += 1;
          turnHasUser = false;
        }
        const { text, images } = textFromContent(message.content);
        const attachments = attachmentCounts(message);
        pushRow({
          id: entryId,
          kind: "user",
          turn,
          timestamp: message.timestamp,
          startedAt: message.timestamp,
          status: "completed",
          title: "user",
          text: textPreview(text),
          detailText: limitDetail(text),
          images: images + attachments.images || undefined,
          files: attachments.files || undefined,
        });
        break;
      }
      case "assistant":
        pushAssistant(message, entryId, message.timestamp, false);
        break;
      case "toolResult": {
        if (consumedResults.has(message.toolCallId)) break;
        const output = toolResultText(message);
        pushRow({
          id: entryId,
          kind: "tool",
          turn,
          timestamp: message.timestamp,
          startedAt: message.timestamp,
          endedAt: message.timestamp,
          status: message.isError ? "failed" : "completed",
          title: message.toolName || "tool",
          text: textPreview(output.split(/\r?\n/).find((line) => line.trim()) ?? ""),
          detailText: textPreview(output),
          toolName: message.toolName || undefined,
          toolCallId: message.toolCallId,
          toolOutput: limitToolDetail(output),
          isError: message.isError === true,
          images: blockImages(message.content) || undefined,
        });
        break;
      }
      case "custom": {
        const custom = message as CustomMessage;
        const { text, images } = textFromContent(custom.content);
        const tokensBefore =
          custom.customType === "compaction" &&
          custom.details &&
          typeof custom.details === "object" &&
          typeof (custom.details as { tokensBefore?: unknown }).tokensBefore === "number"
            ? (custom.details as { tokensBefore: number }).tokensBefore
            : undefined;
        pushRow({
          id: entryId,
          kind: "context",
          turn,
          timestamp: message.timestamp,
          startedAt: message.timestamp,
          status: "completed",
          title: custom.customType || "context",
          text: textPreview(text) || custom.customType,
          detailText: limitDetail(text),
          images: images || undefined,
          notice: custom.customType === "compaction" ? "compaction" : undefined,
          compactedTokens: tokensBefore,
        });
        break;
      }
      default:
        break;
    }
  });

  const streaming = options.streamingMessage;
  if (streaming && streaming.role === "assistant") {
    const message = streaming as AssistantMessage;
    const blocks = assistantBlocks(message);
    const model = displayModel(message.provider, message.model, modelNames);
    pushRow({
      id: "streaming",
      kind: "assistant",
      turn: Math.max(1, turn),
      timestamp: message.timestamp,
      startedAt: message.timestamp,
      status: "running",
      title: model ?? message.provider ?? "assistant",
      text: textPreview(blocks.text),
      detailText: limitDetail(blocks.text),
      model,
      provider: message.provider,
      usage: normalizeUsage(message.usage),
      thinking: blocks.thinking ? limitDetail(blocks.thinking) : undefined,
      images: blocks.images || undefined,
    });
    pushToolRows(message, "streaming", message.timestamp, true);
  }

  const contextEntries = options.contextEntries ?? [];
  if (contextEntries.length > 0) {
    const userTurns = rows
      .filter((row) => row.kind === "user" && typeof row.timestamp === "number")
      .map((row) => ({ timestamp: row.timestamp as number, turn: row.turn }));
    const turnForTimestamp = (timestamp: number | undefined): number => {
      if (typeof timestamp !== "number") return 0;
      let result = 0;
      for (const item of userTurns) {
        if (item.timestamp <= timestamp) result = item.turn;
        else break;
      }
      return result;
    };
    for (const entry of contextEntries) {
      const timestamp = entry.timestamp;
      const system = entry.kind === "system";
      const row: TrajectoryRow = {
        id: `trajectory-context:${entry.entryId}`,
        kind: system ? "system" : "context",
        turn: turnForTimestamp(timestamp),
        timestamp,
        startedAt: timestamp,
        status: "completed",
        title: entry.title,
        text: system ? "" : textPreview(entry.preview),
        detailText: limitDetail(entry.text),
        notice: system ? "system-prompt" : undefined,
      };
      let insertAt: number;
      if (typeof timestamp === "number") {
        const found = rows.findIndex(
          (candidate) => typeof candidate.timestamp === "number" && candidate.timestamp > timestamp,
        );
        insertAt = found < 0 ? rows.length : found;
      } else {
        const firstTimed = rows.findIndex((candidate) => typeof candidate.timestamp === "number");
        insertAt = firstTimed < 0 ? rows.length : firstTimed;
      }
      rows.splice(insertAt, 0, row);
    }
  }

  if (rows.length === 0) {
    return {
      turns: [],
      rows: [],
      totalTokens: 0,
      totalCost: 0,
      toolCount: 0,
      userCount: 0,
      assistantCount: 0,
      status: agentRunning ? "running" : "completed",
      hasTiming: false,
    };
  }

  const start = firstDefined(...rows.map((row) => row.timestamp));
  const completedTime = latestTimestamp(rows);
  const end = agentRunning ? Math.max(now, completedTime ?? now) : completedTime;
  const lastTurn = rows.at(-1)?.turn ?? 0;

  const turns: TrajectoryTurn[] = [];
  const byTurn = new Map<number, TrajectoryRow[]>();
  for (const row of rows) {
    const bucket = byTurn.get(row.turn);
    if (bucket) bucket.push(row);
    else byTurn.set(row.turn, [row]);
  }

  for (const [index, turnRows] of [...byTurn.entries()].sort((left, right) => left[0] - right[0])) {
    const running = agentRunning && index === lastTurn;
    const startedAt = firstDefined(...turnRows.map((row) => row.timestamp));
    const endedAt = latestTimestamp(turnRows);
    const durationMs =
      typeof startedAt === "number" && typeof endedAt === "number" && endedAt >= startedAt
        ? endedAt - startedAt
        : undefined;
    let usage: TrajectoryUsage | undefined;
    let model: string | undefined;
    let provider: string | undefined;
    let assistantCount = 0;
    const spans: TrajectorySpan[] = [];
    turnRows.forEach((row, rowIndex) => {
      if (row.kind === "assistant") {
        assistantCount += 1;
        usage = addUsage(usage, row.usage);
        if (row.model) model = row.model;
        if (row.provider) provider = row.provider;
      }
      if (typeof row.timestamp !== "number") return;
      const explicitEnd = row.endedAt;
      const inferredEnd = nextTimestamp(rows, rows.indexOf(row)) ?? endedAt;
      const spanEnd =
        explicitEnd ?? (running && rowIndex === turnRows.length - 1 ? Math.max(now, row.timestamp) : inferredEnd);
      if (typeof spanEnd !== "number" || spanEnd < row.timestamp) return;
      spans.push({
        id: `span:${row.id}`,
        rowId: row.id,
        kind: row.kind,
        lane: laneFor(row.kind),
        start: row.timestamp,
        end: spanEnd,
        durationMs: spanEnd - row.timestamp,
        status: row.status,
      });
    });
    turns.push({
      index,
      rows: turnRows,
      spans,
      startedAt,
      endedAt: running ? now : endedAt,
      durationMs: running && startedAt !== undefined ? Math.max(0, now - startedAt) : durationMs,
      model,
      provider,
      usage,
      toolCount: turnRows.filter((row) => row.kind === "tool").length,
      assistantCount,
      status: turnStatus(turnRows, running),
    });
  }

  let totalUsage: TrajectoryUsage | undefined;
  for (const row of rows) {
    if (row.kind === "assistant") totalUsage = addUsage(totalUsage, row.usage);
  }

  const hasTiming = typeof start === "number" && typeof end === "number" && end >= start;
  return {
    turns,
    rows,
    start,
    end,
    durationMs: hasTiming ? end - start : undefined,
    totalTokens: totalUsage?.total ?? 0,
    totalCost: totalUsage?.cost ?? 0,
    toolCount: rows.filter((row) => row.kind === "tool").length,
    userCount: rows.filter((row) => row.kind === "user").length,
    assistantCount: rows.filter((row) => row.kind === "assistant").length,
    status: turns.some((item) => item.status === "failed")
      ? "failed"
      : turns.some((item) => item.status === "running")
        ? "running"
        : "completed",
    hasTiming,
  };
}

/** Compact duration with a stable shape for table metadata. */
export function formatTrajectoryDuration(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
}

/** Compact token count used in row and turn metadata. */
export function formatTrajectoryTokens(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Four-decimal cost for small per-turn amounts, two decimals above one dollar. */
export function formatTrajectoryCost(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/** True when the row carries an expandable payload in the inspector. */
export function hasTrajectoryDetail(row: TrajectoryRow): boolean {
  return Boolean(
    row.detailText ||
    row.thinking ||
    row.toolInput ||
    row.toolOutput ||
    row.errorMessage ||
    row.notice === "model" ||
    row.notice === "compaction" ||
    row.images ||
    row.files,
  );
}

/** Total timeline width in milliseconds, or zero when no timestamp exists. */
export function trajectoryTimeDomain(
  snapshot: TrajectorySnapshot,
): { start: number; end: number; duration: number } | null {
  if (!snapshot.hasTiming || typeof snapshot.start !== "number" || typeof snapshot.end !== "number") return null;
  return { start: snapshot.start, end: snapshot.end, duration: Math.max(1, snapshot.end - snapshot.start) };
}
