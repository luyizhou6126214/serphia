import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { workStepDisplayPolicy, type WorkStepDisplayPolicy } from "@shared/work-step-display";
import { ProcessGroup } from "./chat/ProcessGroup";
import { TurnProcessHeader, type TurnProcessStatus } from "./chat/TurnProcessHeader";
import type { ProcessActivityKind, ProcessActivitySummary } from "./chat/process-activity";

export type { TurnProcessStatus } from "./chat/TurnProcessHeader";

interface Props {
  stateKey: string;
  expansionStore: ThinkingExpansionStore;
  /** Frozen policy for this row; usually derived from the live appearance mode. */
  policy?: WorkStepDisplayPolicy;
  /** Ranked activity evidence for the settled group title. */
  summary: ProcessActivitySummary;
  children: ReactNode;
  startedAt?: number;
  endedAt?: number;
  status?: TurnProcessStatus;
}

function readStored(store: ThinkingExpansionStore, key: string): boolean | undefined {
  return store.has(key) ? store.getSnapshot(key) : undefined;
}

/**
 * A settled Turn's process section: the whole-Turn header folds the rows behind
 * it, and the group header inside folds the rows themselves. Following DeepSeek
 * Harness, a failed or stopped Turn keeps its rows visible and the header only
 * announces the outcome.
 */
export function ProcessDetailsGroup({
  stateKey,
  expansionStore,
  policy: policyProp,
  summary,
  children,
  startedAt,
  endedAt,
  status = "completed",
}: Props) {
  const { t } = useI18n();
  const policy = policyProp ?? workStepDisplayPolicy(undefined);
  const settled = status !== "running";
  const alwaysOpen = status === "failed" || status === "aborted";
  const groupHeader = policy.stepGrouping !== "none";
  const foldable = policy.foldCompletedTurns && settled && !alwaysOpen;
  const turnKey = `${stateKey}:turn`;
  const getSnapshot = () => readStored(expansionStore, turnKey) ?? !foldable;
  const turnOpen = useSyncExternalStore(expansionStore.subscribe, getSnapshot, getSnapshot);
  const announcement =
    status === "aborted"
      ? t("turnHeaderStopped", "Stopped")
      : status === "failed"
        ? t("turnHeaderFailed", "Failed")
        : t("turnHeaderWorked", "Completed");

  return (
    <div className="dsh-turn-section" data-turn-status={status}>
      <TurnProcessHeader
        status={status}
        startedAt={startedAt}
        endedAt={endedAt}
        foldable={foldable}
        open={turnOpen}
        onToggle={() => expansionStore.set(turnKey, !turnOpen)}
        announcement={announcement}
      />
      {/* The rows stay mounted while the Turn folds them so their own open
          state, scroll position, and keyed seats survive a fold toggle. */}
      <div data-turn-process-body="" hidden={foldable && !turnOpen}>
        <ProcessGroup
          stateKey={stateKey}
          readStored={(key) => readStored(expansionStore, key)}
          writeStored={(key, expanded) => expansionStore.set(key, expanded)}
          policy={policy}
          grouped={groupHeader}
          settled={settled}
          running={status === "running"}
          liveActivity={"thinking" as ProcessActivityKind}
          livePreparing={false}
          liveDetail=""
          summary={summary}
        >
          {children}
        </ProcessGroup>
      </div>
    </div>
  );
}
