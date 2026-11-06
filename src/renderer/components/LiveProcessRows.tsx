import type { ReactNode } from "react";
import type { AgentMessage } from "@/lib/types";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { hasDisplayableProcessMessage } from "@/lib/chat-process";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { groupsStepsForTurn, workStepDisplayPolicy } from "@shared/work-step-display";
import { ProcessGroup } from "./chat/ProcessGroup";
import {
  liveActivityDetail,
  messageActivity,
  summarizeActivity,
  type ProcessActivityKind,
} from "./chat/process-activity";

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

/**
 * Process rows for the Turn that is still receiving output. Without grouping the
 * rows join the transcript flow directly; with grouping they fold behind the
 * live activity header, which names the work in flight.
 */
export function LiveProcessRows({
  messages,
  userIdx,
  endIdx,
  entryId,
  expansionStore,
  workStepDisplay,
  renderMessage,
}: Props) {
  const policy = workStepDisplayPolicy(workStepDisplay);
  const processIndices: number[] = [];
  for (let idx = userIdx + 1; idx < endIdx; idx += 1) processIndices.push(idx);
  const visibleIndices = processIndices.filter((idx) => hasDisplayableProcessMessage(messages[idx]));
  const grouped = groupsStepsForTurn(policy, false);
  const renderRows = () => visibleIndices.map((idx) => renderMessage(idx, { attachRef: false, renderRole: "process" }));

  if (!grouped || visibleIndices.length === 0) return <>{renderRows()}</>;

  const lastVisible = visibleIndices.at(-1);
  const activity: ProcessActivityKind = lastVisible === undefined ? "thinking" : messageActivity(messages[lastVisible]);
  return (
    <ProcessGroup
      stateKey={`process-group-live:${entryId ?? userIdx}`}
      readStored={(key) => (expansionStore.has(key) ? expansionStore.getSnapshot(key) : undefined)}
      writeStored={(key, expanded) => expansionStore.set(key, expanded)}
      policy={policy}
      grouped
      settled={false}
      running
      liveActivity={activity}
      livePreparing={false}
      liveDetail={lastVisible === undefined ? "" : liveActivityDetail(messages[lastVisible])}
      summary={summarizeActivity(visibleIndices.map((idx) => messages[idx]))}
    >
      {renderRows()}
    </ProcessGroup>
  );
}
