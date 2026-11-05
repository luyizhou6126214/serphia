import type { ReactNode } from "react";
import type { AgentMessage } from "@/lib/types";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { countToolCalls, hasDisplayableProcessMessage } from "@/lib/chat-process";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { ProcessDetailsGroup } from "./ProcessDetailsGroup";

export interface LiveProcessRenderOptions {
  attachRef?: boolean;
  renderRole?: "process";
}

interface Props {
  messages: AgentMessage[];
  userIdx: number;
  endIdx: number;
  entryId?: string;
  expansionStore: ThinkingExpansionStore;
  workStepDisplay: WorkStepDisplay;
  renderMessage: (idx: number, options?: LiveProcessRenderOptions) => ReactNode;
}

/** Process rows for the turn that is still receiving output. */
export function LiveProcessRows({
  messages,
  userIdx,
  endIdx,
  entryId,
  expansionStore,
  workStepDisplay,
  renderMessage,
}: Props) {
  const processIndices: number[] = [];
  for (let idx = userIdx + 1; idx < endIdx; idx += 1) processIndices.push(idx);
  const visibleIndices = processIndices.filter((idx) => hasDisplayableProcessMessage(messages[idx]));

  if (workStepDisplay !== "verbose" && visibleIndices.length > 0) {
    const stateKey = `process-group-live:${entryId ?? userIdx}`;
    return (
      <ProcessDetailsGroup
        stateKey={stateKey}
        expansionStore={expansionStore}
        workStepDisplay={workStepDisplay}
        messageCount={visibleIndices.length}
        toolCallCount={countToolCalls(messages, visibleIndices)}
      >
        {visibleIndices.map((idx) => renderMessage(idx, { attachRef: false, renderRole: "process" }))}
      </ProcessDetailsGroup>
    );
  }

  return <>{processIndices.map((idx) => renderMessage(idx))}</>;
}
