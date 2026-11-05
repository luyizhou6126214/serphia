import type { AgentMessage, AssistantMessage } from "@/lib/types";
import { countToolCallBlocks, getDisplayableAssistantBlocks } from "@/lib/message-display";

/** Count tool calls across the selected transcript messages. */
export function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

/** Whether an intermediate transcript message contributes process rows. */
export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}
