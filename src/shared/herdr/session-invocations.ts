import type { AgentMessage } from "../types";

export function getInvokedHerdrPaneIds(messages: Iterable<AgentMessage>): string[] {
  const pending = new Map<string, string>();
  const invoked = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const call of message.content) {
        if (call.type !== "toolCall") continue;
        if (call.toolName !== "herdr_agent_start" && call.toolName !== "herdr_agent_prompt") continue;
        const paneId = call.input?.paneId;
        if (call.toolCallId && typeof paneId === "string" && paneId) pending.set(call.toolCallId, paneId);
      }
    } else if (message.role === "toolResult") {
      const paneId = pending.get(message.toolCallId);
      if (!paneId) continue;
      pending.delete(message.toolCallId);
      if (!message.isError) invoked.add(paneId);
    }
  }

  return [...invoked];
}
