import type { AgentMessage } from "@/lib/types";
import { RunningStatus } from "./chat/RunningStatus";

interface Props {
  messages: AgentMessage[];
}

/** Live status row shown while the current Turn is still producing output. */
export function RunningTurnStatus({ messages }: Props) {
  let startedAt: number | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      startedAt = (message as AgentMessage & { timestamp?: number }).timestamp;
      break;
    }
  }
  return <RunningStatus startTime={startedAt} />;
}
