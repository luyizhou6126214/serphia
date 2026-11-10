import type { ContextUsage } from "@shared/pi-types";
import type { AgentMessage } from "@shared/types";

/** Conservative characters-per-token estimate used only for trailing messages. */
const CHARS_PER_TOKEN = 4;

function estimateMessageTokens(message: AgentMessage): number {
  const content = "content" in message ? message.content : "";
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Derive context occupancy from the settled transcript when the runtime has no
 * live `contextUsage` (for example a session restored from disk). The last
 * assistant request's prompt-side usage is the authoritative context size at
 * that step; only messages after it are estimated. Returns null rather than a
 * fabricated reading when the transcript has no usable usage or a compaction
 * has replaced the context since that assistant step.
 */
export function contextUsageFromMessages(
  messages: readonly AgentMessage[],
  contextWindow: number | null | undefined,
): ContextUsage | null {
  if (contextWindow === undefined || contextWindow === null || !(contextWindow > 0)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "custom" && message.customType === "compaction") return null;
    if (message.role !== "assistant" || message.usage === undefined) continue;
    if (message.stopReason === "error" || message.stopReason === "aborted") continue;
    const usage = message.usage;
    const usedTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (usedTokens <= 0) continue;
    let trailingTokens = 0;
    for (let trailingIndex = index + 1; trailingIndex < messages.length; trailingIndex += 1) {
      trailingTokens += estimateMessageTokens(messages[trailingIndex]);
    }
    const tokens = usedTokens + trailingTokens;
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }
  return null;
}
