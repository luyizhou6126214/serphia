import { useEffect, useRef, useState } from "react";
import { Check, Circle, Code2, Layers, Loader2, MessageSquare, Workflow } from "lucide-react";
import { useI18n } from "@/i18n";
import type { usePresentationAgent } from "./usePresentationAgent";

export function PresentationActivity({ agent }: { agent: ReturnType<typeof usePresentationAgent> }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const events = agent.events.filter((event) => filter === null || event.index === filter);
  useEffect(() => {
    if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [agent.events, filter]);
  const labels = {
    queued: t("pptQueued", "Queued"),
    running: t("pptWorking", "Working"),
    complete: t("pptDone", "Complete"),
    error: t("pptFailed", "Failed"),
  };
  return (
    <div className="ppt-activity">
      <div className="ppt-activity-intro">
        <Workflow size={19} />
        <div>
          <h2>{t("pptTeam", "Agent team")}</h2>
          <p>{t("pptTeamHint", "One planner. Up to three page designers working in parallel.")}</p>
        </div>
      </div>
      {agent.pageStates.length > 0 && (
        <div className="ppt-agent-roster">
          <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}>
            {t("pptAllActivity", "All activity")}
          </button>
          {agent.pageStates.map((state, index) => (
            <button
              key={index}
              type="button"
              data-state={state}
              aria-pressed={filter === index}
              onClick={() => setFilter(filter === index ? null : index)}
            >
              {state === "complete" ? (
                <Check size={13} />
              ) : state === "running" ? (
                <Loader2 size={13} />
              ) : (
                <Circle size={10} />
              )}
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span>{labels[state]}</span>
            </button>
          ))}
        </div>
      )}
      <p className="ppt-muted">
        {t("pptPublicSummary", "Live execution summaries and tool receipts. Select a page to filter.")}
      </p>
      <ol
        ref={list}
        className="ppt-event-list"
        aria-label={t("pptActivity", "Activity")}
        onScroll={(event) => {
          const node = event.currentTarget;
          following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}
      >
        {events.map((event, index) => (
          <li key={`${event.runId}-${event.type}-${event.at}-${index}`} className={`ppt-event is-${event.type}`}>
            <span className="ppt-event-icon">
              {event.type === "summary" ? (
                <MessageSquare />
              ) : event.type.startsWith("tool") ? (
                <Code2 />
              ) : event.type === "render" ? (
                <Layers />
              ) : event.type === "complete" ? (
                <Check />
              ) : (
                <Circle />
              )}
            </span>
            <div className="ppt-event-body">
              <div className="ppt-event-heading">
                <strong>
                  {event.index === null
                    ? t("pptPlanner", "Planner")
                    : `${t("pptDesigner", "Designer")} ${String(event.index + 1).padStart(2, "0")}`}
                </strong>
                <time>{new Date(event.at).toLocaleTimeString([], { hour12: false })}</time>
              </div>
              {event.type === "summary" || event.type === "error" ? (
                <p>{event.message}</p>
              ) : (
                <p>
                  {event.type === "started"
                    ? t("pptRunStarted", "Reading the brief and preparing the composition")
                    : event.type === "complete"
                      ? t("pptRunComplete", "Output validated")
                      : event.type === "render"
                        ? `${event.slide?.elements.length ?? 0} ${t("pptElementsReady", "native elements rendered")}`
                        : `${event.tool} · ${event.type === "tool_start" ? t("pptToolStarted", "Called") : t("pptToolFinished", "Returned")}`}
                </p>
              )}
              {event.detail && (
                <details>
                  <summary>{t("pptToolDetails", "Arguments / result")}</summary>
                  <pre>{event.detail}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      {events.length === 0 && (
        <div className="ppt-activity-empty">
          <Workflow size={28} />
          <p>{t("pptActivityEmpty", "Execution appears here when generation starts.")}</p>
        </div>
      )}
    </div>
  );
}
