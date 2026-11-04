import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";

interface Props {
  messageCount: number;
  toolCallCount: number;
  children: ReactNode;
  stateKey: string;
  expansionStore: ThinkingExpansionStore;
}

export function ProcessDetailsGroup({ messageCount, toolCallCount, children, stateKey, expansionStore }: Props) {
  const getSnapshot = useMemo(() => () => expansionStore.getSnapshot(stateKey), [expansionStore, stateKey]);
  const expanded = useSyncExternalStore(expansionStore.subscribe, getSnapshot, getSnapshot);
  const { language, t } = useI18n();
  const parts = [
    t("processDetails", "Process details"),
    language !== "en-US"
      ? `${messageCount} ${t("messagesCount", "messages")}`
      : `${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
  ];
  if (toolCallCount > 0) {
    parts.push(
      language !== "en-US"
        ? `${toolCallCount} ${t("toolCallsCount", "tool calls")}`
        : `${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`,
    );
  }

  return (
    <div className="process-details-group" data-expanded={expanded}>
      <button
        className="process-details-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => expansionStore.toggle(stateKey)}
        title={
          expanded
            ? t("collapseProcessDetails", "Collapse process details")
            : t("expandProcessDetails", "Expand process details")
        }
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span>{parts[0]}</span>
          <span className="process-details-count">{parts.slice(1).join(" · ")}</span>
        </span>
      </button>
      {expanded && <div className="process-details-body">{children}</div>}
    </div>
  );
}
