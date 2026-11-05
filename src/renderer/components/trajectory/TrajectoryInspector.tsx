import { X } from "lucide-react";
import {
  formatTrajectoryCost,
  formatTrajectoryDuration,
  formatTrajectoryTokens,
  type TrajectoryRow,
  type TrajectoryStatus,
} from "@/lib/trajectory";

type Translate = (key: string, fallback: string) => string;

interface Props {
  row: TrajectoryRow;
  language: string;
  t: Translate;
  onClose: () => void;
}

function clock(timestamp: number | undefined, language: string): string | null {
  if (typeof timestamp !== "number") return null;
  const value = new Date(timestamp);
  const now = new Date();
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  const time = value.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (sameDay) return time;
  const date = value.toLocaleDateString(language, { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

function statusLabel(status: TrajectoryStatus, t: Translate): string {
  switch (status) {
    case "failed":
      return t("trajectoryStatusFailed", "Failed");
    case "running":
      return t("trajectoryStatusRunning", "Running");
    case "pending":
      return t("trajectoryStatusPending", "Pending");
    case "aborted":
      return t("trajectoryStatusAborted", "Aborted");
    default:
      return t("trajectoryStatusCompleted", "Completed");
  }
}

function kindLabel(row: TrajectoryRow, t: Translate): string {
  switch (row.kind) {
    case "user":
      return t("trajectoryKindUser", "User");
    case "assistant":
      return t("trajectoryKindAssistant", "Assistant");
    case "tool":
      return t("trajectoryKindTool", "Tool");
    case "context":
      return t("trajectoryKindContext", "Context");
    default:
      return t("trajectoryKindSystem", "System");
  }
}

function titleFor(row: TrajectoryRow, t: Translate): string {
  if (row.notice === "model") {
    return t("trajectoryModelChanged", "Model changed to {model}").replace("{model}", row.model ?? "");
  }
  if (row.notice === "compaction") return t("trajectoryCompaction", "Context compacted");
  if (row.notice === "system-prompt") return t("trajectorySystemPrompt", "Initial system prompt");
  if (row.kind === "context" && row.title === "context_edit") return t("trajectoryContextEdit", "Context edit");
  if (row.kind === "tool") return row.toolName ?? row.title;
  if (row.kind === "assistant") return row.model ?? row.title;
  if (row.kind === "user") return t("trajectoryKindUser", "User");
  if (row.kind === "context") return t("trajectoryKindContext", "Context");
  return t("trajectoryKindSystem", "System");
}

export function TrajectoryInspector({ row, language, t, onClose }: Props) {
  const started = clock(row.startedAt ?? row.timestamp, language);
  const duration = formatTrajectoryDuration(row.durationMs);
  const tokens = formatTrajectoryTokens(row.usage?.total);
  const cost = formatTrajectoryCost(row.usage?.cost);
  const showToolSections = row.kind === "tool" || Boolean(row.toolInput) || Boolean(row.toolOutput);
  const bodyText =
    row.detailText && row.detailText !== row.toolInput && row.detailText !== row.toolOutput ? row.detailText : "";

  return (
    <aside className="trajectory-inspector" aria-label={t("trajectoryDetails", "Event details")}>
      <header className="trajectory-inspector-header">
        <div className="trajectory-inspector-heading">
          <div className="trajectory-inspector-title">
            <span className="trajectory-kind-tag" data-kind={row.kind}>
              {kindLabel(row, t)}
            </span>
            <span>{titleFor(row, t)}</span>
          </div>
          <div className="trajectory-inspector-subtitle">
            {row.turn > 0
              ? t("trajectoryTurn", "Turn {turn}").replace("{turn}", String(row.turn))
              : t("trajectoryBetweenTurns", "Between turns")}
            {started ? ` · ${started}` : ""}
          </div>
        </div>
        <button
          type="button"
          className="trajectory-inspector-close"
          onClick={onClose}
          title={t("trajectoryCloseDetails", "Close details")}
          aria-label={t("trajectoryCloseDetails", "Close details")}
        >
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <div className="trajectory-inspector-body">
        <dl className="trajectory-inspector-meta">
          <dt>{t("trajectoryStatus", "Status")}</dt>
          <dd className={row.status === "failed" ? "trajectory-inspector-warning" : undefined}>
            {statusLabel(row.status, t)}
          </dd>
          {started && (
            <>
              <dt>{t("trajectoryStartedAt", "Started")}</dt>
              <dd>{started}</dd>
            </>
          )}
          {duration && (
            <>
              <dt>{t("trajectoryDuration", "Duration")}</dt>
              <dd>{duration}</dd>
            </>
          )}
          {row.model && (
            <>
              <dt>{t("trajectoryModel", "Model")}</dt>
              <dd>{row.model}</dd>
            </>
          )}
          {row.previousModel && (
            <>
              <dt>{t("trajectoryPreviousModel", "Previous model")}</dt>
              <dd>{row.previousModel}</dd>
            </>
          )}
          {tokens && (
            <>
              <dt>{t("trajectoryTokens", "Tokens")}</dt>
              <dd>{tokens}</dd>
            </>
          )}
          {cost && (
            <>
              <dt>{t("trajectoryCost", "Cost")}</dt>
              <dd>{cost}</dd>
            </>
          )}
          {row.compactedTokens !== undefined && (
            <>
              <dt>{t("trajectoryCompactedTokens", "Tokens before")}</dt>
              <dd>{row.compactedTokens.toLocaleString(language)}</dd>
            </>
          )}
          {row.toolCallId && (
            <>
              <dt>{t("trajectoryToolCall", "Tool call")}</dt>
              <dd style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{row.toolCallId}</dd>
            </>
          )}
          {!!row.images && (
            <>
              <dt>{t("trajectoryImages", "Images")}</dt>
              <dd>{row.images}</dd>
            </>
          )}
          {!!row.files && (
            <>
              <dt>{t("trajectoryFiles", "Files")}</dt>
              <dd>{row.files}</dd>
            </>
          )}
        </dl>

        {row.errorMessage && (
          <section className="trajectory-inspector-section">
            <h4>{t("trajectoryError", "Error")}</h4>
            <pre className="trajectory-inspector-warning">{row.errorMessage}</pre>
          </section>
        )}

        {row.thinking && (
          <section className="trajectory-inspector-section">
            <h4>{t("trajectoryThinking", "Thinking")}</h4>
            <pre>{row.thinking}</pre>
          </section>
        )}

        {row.notice === "model" ? (
          <section className="trajectory-inspector-section">
            <h4>{t("trajectoryModel", "Model")}</h4>
            <pre>{[row.previousModel, row.model].filter(Boolean).join(" → ")}</pre>
          </section>
        ) : showToolSections ? (
          <>
            <section className="trajectory-inspector-section">
              <h4>{t("trajectoryToolInput", "Arguments")}</h4>
              <pre>{row.toolInput || t("trajectoryNoContent", "No content")}</pre>
            </section>
            <section className="trajectory-inspector-section">
              <h4>{t("trajectoryToolResult", "Result")}</h4>
              <pre className={row.isError ? "trajectory-inspector-warning" : undefined}>
                {row.toolOutput || t("trajectoryNoOutput", "No output")}
              </pre>
            </section>
          </>
        ) : (
          <section className="trajectory-inspector-section">
            <h4>{row.kind === "assistant" ? t("trajectoryOutput", "Output") : t("trajectoryContent", "Content")}</h4>
            <pre>{bodyText || row.text || t("trajectoryNoContent", "No content")}</pre>
          </section>
        )}

        <p className="trajectory-inspector-note">
          {t("trajectoryRecordedTiming", "Timing follows recorded session timestamps.")}
        </p>
      </div>
    </aside>
  );
}
