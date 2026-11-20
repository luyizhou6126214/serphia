import { useEffect, useId, useState } from "react";
import { Activity, ChevronDown, CircleAlert, CircleCheck, CircleMinus, Clock3, LoaderCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import type { SubagentActivityItem, SubagentActivityStatus } from "@/lib/types";
import { formatNumber } from "@/lib/locale-format";
import { formatTurnDuration } from "@/lib/turn-duration";

const statusIcons = {
  queued: Clock3,
  running: LoaderCircle,
  completed: CircleCheck,
  aborted: CircleMinus,
  stopped: CircleMinus,
  error: CircleAlert,
};

const statusTone = {
  queued: "var(--text-muted)",
  running: "var(--accent)",
  completed: "var(--success)",
  aborted: "var(--text-muted)",
  stopped: "var(--text-muted)",
  error: "var(--danger)",
};

export function SubagentActivityPanel({ subagents }: { subagents: SubagentActivityItem[] }) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(Date.now);
  const listId = useId();
  const settled = subagents.filter(({ status }) => status !== "queued" && status !== "running").length;
  const ticking = expanded && subagents.some(({ status }) => status === "running");
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const labels: Record<SubagentActivityStatus, string> = {
    queued: t("subagentActivityQueued", "Queued"),
    running: t("subagentActivityRunning", "Running"),
    completed: t("subagentActivityCompleted", "Completed"),
    stopped: t("subagentActivityStopped", "Stopped"),
    aborted: t("subagentActivityAborted", "Aborted"),
    error: t("subagentActivityFailed", "Failed"),
  };
  const title = t("subagentActivityTitle", "Subagents");
  const summary = t("subagentActivitySummary", "{settled}/{total} finished")
    .replace("{settled}", formatNumber(settled, language))
    .replace("{total}", formatNumber(subagents.length, language));

  return (
    <section
      aria-label={title}
      className="pointer-events-auto w-[21rem] max-w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] shadow-[0_8px_28px_rgba(0,0,0,0.10)]"
    >
      <button
        type="button"
        aria-controls={listId}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--bg-subtle)] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
        onClick={() => setExpanded((value) => !value)}
      >
        <Activity size={15} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
        <span className="flex-1 text-xs font-semibold">{title}</span>
        <span role="status" className="text-[11px] text-[var(--text-muted)] tabular-nums">
          {summary}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={expanded ? "rotate-180 text-[var(--text-muted)]" : "text-[var(--text-muted)]"}
        />
      </button>
      <ul
        id={listId}
        hidden={!expanded}
        className="m-0 max-h-[min(38dvh,22rem)] list-none divide-y divide-[var(--border)] overflow-y-auto overscroll-contain border-t border-[var(--border)] px-3"
      >
        {subagents.map((agent) => {
          const Icon = statusIcons[agent.status];
          const duration = formatTurnDuration(
            agent.status === "running" && agent.startedAt !== undefined
              ? Math.max(0, now - agent.startedAt)
              : agent.durationMs,
            language,
          );
          return (
            <li key={agent.id} className="flex items-start gap-2 py-2">
              <Icon
                size={14}
                aria-hidden="true"
                style={{ color: statusTone[agent.status] }}
                className={agent.status === "running" ? "mt-0.5 shrink-0 motion-safe:animate-spin" : "mt-0.5 shrink-0"}
              />
              <div className="min-w-0 flex-1">
                <p className="m-0 break-words text-xs leading-4">{agent.description || title}</p>
                {agent.update && (
                  <p
                    title={agent.update}
                    className="m-0 mt-0.5 line-clamp-2 break-words text-[11px] leading-4 text-[var(--text-muted)]"
                  >
                    {agent.update}
                  </p>
                )}
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-[var(--text-muted)] tabular-nums">
                {labels[agent.status]}
                {duration ? ` · ${duration}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
