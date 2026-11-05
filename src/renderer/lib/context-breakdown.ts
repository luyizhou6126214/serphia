import type { AgentMessage, UserMessage } from "./types";

/** Tokens reserved per message for role and transport overhead. */
const MESSAGE_OVERHEAD_TOKENS = 4;
/** Coarse estimate for an image block; providers bill by visual tokens. */
const IMAGE_TOKENS = 800;
/** Coarse estimate for one tool schema (name, description and parameters). */
const TOOL_SCHEMA_TOKENS = 80;

export interface ContextUsageSnapshot {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ContextMessageCounts {
  user: number;
  assistant: number;
  toolResult: number;
  custom: number;
}

export interface ContextBreakdown {
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
  totalTokens: number;
  usedTokens: number;
  contextWindow: number;
  percent: number | null;
  runtimeReported: boolean;
  estimatesOnly: boolean;
  loadedMessages: number;
  messageCounts: ContextMessageCounts;
}

export interface BuildContextBreakdownInput {
  messages: readonly AgentMessage[];
  systemPrompt?: string | null;
  toolNames?: readonly string[];
  contextUsage?: ContextUsageSnapshot | null;
}

/**
 * Estimate tokens for mixed English/CJK text. CJK characters are counted
 * individually; other characters are grouped at four per token. This is a
 * deterministic display heuristic, not a tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}

function contentText(content: unknown): { text: string; images: number } {
  if (typeof content === "string") return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: "", images: 0 };
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const value = block as { type?: unknown; text?: unknown; thinking?: unknown; input?: unknown };
    if (value.type === "text" && typeof value.text === "string") parts.push(value.text);
    else if (value.type === "thinking" && typeof value.thinking === "string") parts.push(value.thinking);
    else if (value.type === "toolCall") {
      try {
        parts.push(JSON.stringify(value.input ?? {}));
      } catch {
        /* ignore unserializable tool input in the estimate */
      }
    } else if (value.type === "image") images += 1;
  }
  return { text: parts.join("\n"), images };
}

function estimateMessageTokens(message: AgentMessage): number {
  const content = contentText(message.content);
  const attachmentImages = (message as UserMessage).channelAttachments?.filter(
    (attachment) => attachment.kind === "image",
  ).length;
  const imageTokens = (content.images + (attachmentImages ?? 0)) * IMAGE_TOKENS;
  return MESSAGE_OVERHEAD_TOKENS + estimateTokens(content.text) + imageTokens;
}

function countMessages(messages: readonly AgentMessage[]): ContextMessageCounts {
  const counts: ContextMessageCounts = { user: 0, assistant: 0, toolResult: 0, custom: 0 };
  for (const message of messages) {
    if (message.role === "user") counts.user += 1;
    else if (message.role === "assistant") counts.assistant += 1;
    else if (message.role === "toolResult") counts.toolResult += 1;
    else if (message.role === "custom") counts.custom += 1;
  }
  return counts;
}

function reportedTokens(contextUsage: ContextUsageSnapshot | null | undefined): number | null {
  const tokens = contextUsage?.tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
}

function reportedPercent(contextUsage: ContextUsageSnapshot | null | undefined, used: number): number | null {
  const percent = contextUsage?.percent;
  if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0) return Math.min(100, percent);
  const window = contextUsage?.contextWindow ?? 0;
  return window > 0 ? Math.min(100, (used / window) * 100) : null;
}

/**
 * Build the estimated composition of the current context. When the runtime
 * reports a used-token count, system and tool estimates are fitted under it
 * and the conversation receives the remainder, which also covers context
 * injected outside the loaded transcript.
 */
export function buildContextBreakdown(input: BuildContextBreakdownInput): ContextBreakdown {
  const systemTokens = input.systemPrompt ? estimateTokens(input.systemPrompt) : 0;
  const toolsTokens = (input.toolNames?.length ?? 0) * TOOL_SCHEMA_TOKENS;
  const messageEstimate = input.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  const reported = reportedTokens(input.contextUsage);

  let system = systemTokens;
  let tools = toolsTokens;
  let messages = messageEstimate;
  if (reported !== null) {
    system = Math.min(systemTokens, reported);
    tools = Math.min(toolsTokens, Math.max(0, reported - system));
    messages = Math.max(0, reported - system - tools);
  }

  const totalTokens = system + tools + messages;
  const usedTokens = reported ?? totalTokens;
  const contextWindow = input.contextUsage?.contextWindow ?? 0;
  return {
    systemTokens: system,
    toolsTokens: tools,
    messageTokens: messages,
    totalTokens,
    usedTokens,
    contextWindow,
    percent: reportedPercent(input.contextUsage, usedTokens),
    runtimeReported: reported !== null,
    estimatesOnly: reported === null,
    loadedMessages: input.messages.length,
    messageCounts: countMessages(input.messages),
  };
}
