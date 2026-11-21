import { useEffect, useState } from "react";
import { GitFork } from "lucide-react";
import { useI18n } from "@/i18n";
import type { SubagentActivityItem } from "@/lib/types";
import { formatNumber } from "@/lib/locale-format";
import { formatTurnDuration } from "@/lib/turn-duration";
import { SubagentStatus, SubagentStep } from "./SubagentStep";

export function SubagentActivityPanel({ subagents }: { subagents: SubagentActivityItem[] }) {
  const { language, t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const settled = subagents.filter(({ status }) => status !== "queued" && status !== "running").length;
  const running = subagents.some(({ status }) => status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const title = t("subagentActivityTitle", "Subagents");
  const summary = t("subagentActivitySummary", "{settled}/{total} finished")
    .replace("{settled}", formatNumber(settled, language))
    .replace("{total}", formatNumber(subagents.length, language));

  return (
    <SubagentStep state={running ? "running" : undefined}>
      <section aria-label={title}>
        <div className="dsh-subagent-heading">
          <GitFork className="dsh-subagent-icon" size={15} aria-hidden="true" />
          <span className="dsh-subagent-title">{title}</span>
          <span role="status" className="dsh-subagent-meta">
            {summary}
          </span>
        </div>
        <ul className="dsh-subagent-roster">
          {subagents.map((agent) => {
            const duration = formatTurnDuration(
              agent.status === "running" && agent.startedAt !== undefined
                ? Math.max(0, now - agent.startedAt)
                : agent.durationMs,
              language,
            );
            return (
              <li key={agent.id} className="dsh-subagent-worker" data-state={agent.status}>
                <span className="dsh-subagent-dot" aria-hidden="true" />
                <div className="dsh-subagent-worker-copy">
                  <div className="dsh-subagent-title" title={agent.description}>
                    {agent.description || title}
                  </div>
                  {agent.update && (
                    <div className="dsh-subagent-update" title={agent.update}>
                      {agent.update}
                    </div>
                  )}
                </div>
                {duration && <span className="dsh-subagent-meta dsh-subagent-duration">{duration}</span>}
                <SubagentStatus status={agent.status} />
              </li>
            );
          })}
        </ul>
      </section>
    </SubagentStep>
  );
}
