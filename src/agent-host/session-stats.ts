import type { AgentSessionLike, SessionStatsInfo } from "../shared/pi-types.ts";
import type { SessionEntry, Usage } from "../shared/types.ts";

type StatsOptions = {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  contextUsage?: SessionStatsInfo["contextUsage"];
};

export function buildLiveSessionStats(session: AgentSessionLike): SessionStatsInfo {
  return buildSessionStats(session.sessionManager.getEntries() as unknown as SessionEntry[], {
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    sessionName: session.sessionManager.getSessionName(),
    contextUsage: session.getContextUsage(),
  });
}

/** Read-only equivalent of Pi's all-entry usage totals, with Desktop chat counts. */
export function buildSessionStats(entries: readonly SessionEntry[], options: StatsOptions): SessionStatsInfo {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  const modelUsage = new Map<string, { provider: string; model: string; tokens: number; cost: number }>();
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  let decodeDurationMs = 0;
  let decodeOutputTokens = 0;
  let llmDurationMs = 0;
  let toolDurationMs = 0;

  function includeUsage(usage?: Usage, provider = "", model = ""): void {
    if (!usage) return;
    tokens.input += usage.input;
    tokens.output += usage.output;
    tokens.cacheRead += usage.cacheRead;
    tokens.cacheWrite += usage.cacheWrite;
    cost += usage.cost.total;
    const key = `${provider}\u0000${model}`;
    const row = modelUsage.get(key) ?? { provider, model, tokens: 0, cost: 0 };
    row.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    row.cost += usage.cost.total;
    modelUsage.set(key, row);
  }

  for (const entry of entries) {
    if (entry.type === "usage") {
      includeUsage(entry.usage, entry.provider, entry.model);
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      includeUsage(entry.usage);
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user") userMessages++;
    else if (message.role === "toolResult") {
      toolResults++;
      includeUsage(message.usage);
      if (typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs > 0) {
        toolDurationMs += message.durationMs;
      }
    } else if (message.role === "assistant") {
      assistantMessages++;
      toolCalls += message.content.filter((block) => block.type === "toolCall").length;
      includeUsage(message.usage, message.provider, message.model);
      // Pi records the response wall time on each assistant message; folding
      // the timed steps gives the same whole-session throughput reading the
      // composer shows, while legacy or failed steps without timing stay out.
      if (typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs > 0) {
        llmDurationMs += message.durationMs;
        if (message.usage !== undefined && message.usage.output > 0) {
          decodeDurationMs += message.durationMs;
          decodeOutputTokens += message.usage.output;
        }
      }
    }
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    sessionId: options.sessionId,
    ...(options.sessionFile ? { sessionFile: options.sessionFile } : {}),
    ...(options.sessionName ? { sessionName: options.sessionName } : {}),
    ...(options.contextUsage ? { contextUsage: options.contextUsage } : {}),
    userMessages,
    assistantMessages,
    toolResults,
    toolCalls,
    totalMessages: userMessages + assistantMessages + toolResults,
    tokens,
    cost,
    modelUsage: [...modelUsage.values()].sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model)),
    ...(decodeDurationMs > 0 ? { tokensPerSecond: decodeOutputTokens / (decodeDurationMs / 1000) } : {}),
    ...(llmDurationMs > 0 ? { llmDurationMs } : {}),
    ...(toolDurationMs > 0 ? { toolDurationMs } : {}),
  };
}
