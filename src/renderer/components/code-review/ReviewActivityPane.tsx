import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, CircleAlert, Cpu, Terminal } from "lucide-react";
import type { ReviewActivityEntry, ReviewHistoryRef, ReviewRun } from "@contract/code-review";
import { useI18n } from "@/i18n";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { AssistantMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "../MessageView";
import { reviewIssueText } from "./copy";
import { useReviewActivity } from "./useReviewActivity";
import "./ReviewActivityPane.css";

type ToolEntry = Extract<ReviewActivityEntry, { kind: "tool" }>;
type ModelEntry = Extract<ReviewActivityEntry, { kind: "model" }>;

type EventPresentation = {
  active: boolean;
  cwd: string;
  expansion: ThinkingExpansionStore;
  workStepDisplay?: WorkStepDisplay;
};

const ToolEntryView = memo(function ToolEntryView({
  entry,
  active,
  cwd,
  model,
  expansion,
  workStepDisplay,
}: EventPresentation & { entry: ToolEntry; model: string }) {
  const { t } = useI18n();
  const id = String(entry.id);
  const running = active && entry.status === "running";
  const { message, results } = useMemo(() => {
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(entry.input);
      input =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { arguments: entry.input };
    } catch {
      input = { arguments: entry.input };
    }
    const message: AssistantMessage = {
      role: "assistant",
      model,
      provider: "",
      timestamp: entry.at,
      content: [{ type: "toolCall", toolCallId: id, toolName: entry.name, input }],
    };
    const results = new Map<string, ToolResultMessage>();
    if (entry.output !== undefined) {
      results.set(id, {
        role: "toolResult",
        toolCallId: id,
        toolName: entry.name,
        content: [{ type: "text", text: entry.output }],
        isError: entry.status === "error",
        durationMs: entry.durationMs,
      });
    }
    return { message, results };
  }, [entry, id, model]);
  const runningToolCallIds = useMemo(() => new Set(running ? [id] : []), [id, running]);
  return (
    <article className="cr-activity-tool" title={entry.name}>
      <MessageView
        message={message}
        entryId={id}
        cwd={cwd}
        toolResults={results}
        runningToolCallIds={runningToolCallIds}
        thinkingExpansionStore={expansion}
        workStepDisplay={workStepDisplay}
        hideCopy
        rawToolPresentation={{
          missingResultLabel: t("reviewActivityNoToolResult", "OCR did not record an output for this call."),
        }}
        footer={
          <div className="cr-activity-details">
            {entry.path && <span>{entry.path}</span>}
            {entry.task && <span>{entry.task}</span>}
            <ActivityTime at={entry.at} durationMs={entry.durationMs} />
            {entry.truncated && <span>{t("reviewActivityLimited", "Some output was shortened for display.")}</span>}
          </div>
        }
      />
    </article>
  );
});

const ModelEntryView = memo(function ModelEntryView({
  entry,
  active,
  cwd,
  expansion,
  workStepDisplay,
}: EventPresentation & { entry: ModelEntry }) {
  const { t, language } = useI18n();
  const running = active && entry.status === "running";
  const message = useMemo<AssistantMessage>(() => {
    const content: AssistantMessage["content"] = [];
    if (entry.reasoning) content.push({ type: "thinking", thinking: entry.reasoning });
    if (entry.text) content.push({ type: "text", text: entry.text });
    return {
      role: "assistant",
      content,
      provider: entry.provider,
      model: entry.model,
      timestamp: entry.at,
      durationMs: entry.durationMs,
      stopReason: entry.status === "error" ? "error" : entry.status === "running" && !active ? "aborted" : undefined,
      errorMessage: entry.diagnostic || (entry.issue && reviewIssueText(entry.issue, t)),
    };
  }, [active, entry, t]);

  return (
    <article className="cr-activity-model">
      <div className="cr-activity-details cr-activity-model-meta">
        <Cpu size={13} aria-hidden="true" />
        <strong>{entry.model}</strong>
        {entry.provider && <span>{entry.provider}</span>}
        {running && <span>{t("reviewActivityReceiving", "Receiving output…")}</span>}
        {entry.inputTokens !== undefined && (
          <span>
            {t("reviewActivityInputTokens", "{count} input tokens").replace(
              "{count}",
              entry.inputTokens.toLocaleString(language),
            )}
          </span>
        )}
        {entry.outputTokens !== undefined && (
          <span>
            {t("reviewActivityOutputTokens", "{count} output tokens").replace(
              "{count}",
              entry.outputTokens.toLocaleString(language),
            )}
          </span>
        )}
        {entry.truncated && <span>{t("reviewActivityLimited", "Some output was shortened for display.")}</span>}
        <ActivityTime at={entry.at} durationMs={entry.durationMs} />
      </div>
      <MessageView
        message={message}
        entryId={String(entry.id)}
        cwd={cwd}
        isStreaming={running}
        thinkingExpansionStore={expansion}
        workStepDisplay={workStepDisplay}
      />
    </article>
  );
});

function ActivityTime({ at, durationMs }: { at: number; durationMs?: number }) {
  const { language } = useI18n();
  const date = new Date(at);
  return (
    <>
      <time dateTime={date.toISOString()}>{date.toLocaleTimeString(language)}</time>
      {durationMs !== undefined && (
        <span>{(durationMs / 1000).toLocaleString(language, { maximumFractionDigits: 2 })} s</span>
      )}
    </>
  );
}

const EMPTY: ReviewActivityEntry[] = [];
const BATCH = 80;

export function ReviewActivityPane({
  run,
  visible,
  selected = true,
  workStepDisplay,
  historyRef,
}: {
  run: ReviewRun;
  visible: boolean;
  selected?: boolean;
  workStepDisplay?: WorkStepDisplay;
  historyRef?: ReviewHistoryRef;
}) {
  const { t } = useI18n();
  const scroll = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [limit, setLimit] = useState(BATCH);
  const [expansion] = useState(() => new ThinkingExpansionStore());
  const active = !historyRef && !run.finishedAt;
  const snapshot = useReviewActivity(run.id, !active, visible, historyRef, historyRef ? limit : undefined);
  const entries = snapshot?.entries ?? EMPTY;
  const counts = useMemo(() => {
    let model = 0,
      tool = 0;
    for (const entry of entries) {
      if (entry.kind === "model") model++;
      if (entry.kind === "tool") tool++;
    }
    return { model, tool };
  }, [entries]);

  useLayoutEffect(() => {
    if (!historyRef && visible && selected && following && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [historyRef, visible, selected, entries, following]);

  return (
    <section className="cr-activity chat-appearance-scope" aria-label={t("reviewActivity", "Review activity")}>
      <header className="cr-activity-header">
        {t("reviewActivityCounts", "{models} model calls · {tools} tool calls")
          .replace("{models}", String(counts.model))
          .replace("{tools}", String(counts.tool))}
      </header>
      <div
        className="cr-activity-feed"
        ref={scroll}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (historyRef || !selected) return;
          setFollowing(target.scrollHeight - target.scrollTop - target.clientHeight < 48);
        }}
      >
        <div className="chat-content-column dsh-flow">
          {!historyRef && entries.length > limit && (
            <button
              type="button"
              className="cr-control cr-activity-earlier"
              onClick={() => {
                setFollowing(false);
                setLimit((previous) => previous + BATCH);
              }}
            >
              {t("reviewActivityEarlier", "Show earlier activity")}
            </button>
          )}
          {snapshot?.truncated && (
            <p className="cr-activity-note">{t("reviewActivityLimited", "Some output was shortened for display.")}</p>
          )}
          {snapshot?.connectionError && (
            <p className="cr-activity-note">{t("reviewActivityUnavailable", "Could not load review activity.")}</p>
          )}
          {historyRef && !snapshot && (
            <p className="cr-activity-note">{t("reviewHistoryLoading", "Loading review history…")}</p>
          )}
          {!entries.length && !snapshot?.connectionError && (!historyRef || snapshot) && (
            <div className="cr-activity-empty">
              <span>
                <Activity size={19} />
              </span>
              <p>
                {active
                  ? t("reviewActivityWaiting", "Waiting for the first model or tool output…")
                  : t("reviewActivityEmpty", "There is no recorded activity for this run.")}
              </p>
            </div>
          )}
          {(historyRef ? entries.slice(0, limit) : entries.slice(-limit)).map((entry) =>
            entry.kind === "model" ? (
              <ModelEntryView
                key={entry.id}
                entry={entry}
                active={active}
                cwd={run.root}
                expansion={expansion}
                workStepDisplay={workStepDisplay}
              />
            ) : entry.kind === "tool" ? (
              <ToolEntryView
                model={run.model}
                key={entry.id}
                entry={entry}
                active={active}
                cwd={run.root}
                expansion={expansion}
                workStepDisplay={workStepDisplay}
              />
            ) : (
              <article className="cr-activity-message" data-level={entry.kind} key={entry.id}>
                {entry.kind === "warning" ? (
                  <CircleAlert size={14} aria-hidden="true" />
                ) : (
                  <Terminal size={14} aria-hidden="true" />
                )}
                <p>{entry.message}</p>
                <ActivityTime at={entry.at} />
              </article>
            ),
          )}
          {historyRef && (snapshot?.more || entries.length > limit) && (
            <button type="button" className="cr-control" onClick={() => setLimit((previous) => previous + BATCH)}>
              {t("reviewActivityLater", "Show more activity")}
            </button>
          )}
        </div>
      </div>
      {!historyRef && !following && (
        <div className="cr-activity-jump">
          <button type="button" className="cr-control" onClick={() => setFollowing(true)}>
            <ArrowDownToLine size={13} />
            {t("reviewActivityLatest", "Follow latest")}
          </button>
        </div>
      )}
    </section>
  );
}
