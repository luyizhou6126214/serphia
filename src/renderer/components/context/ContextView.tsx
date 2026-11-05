import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { buildContextBreakdown, type ContextUsageSnapshot } from "@/lib/context-breakdown";
import { formatTrajectoryCost, formatTrajectoryTokens } from "@/lib/trajectory";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AgentMessage } from "@/lib/types";
import "./ContextView.css";

interface Props {
  messages: readonly AgentMessage[];
  contextUsage?: ContextUsageSnapshot | null;
  sessionStats?: SessionStatsInfo | null;
  systemPrompt?: string | null;
  toolNames?: readonly string[];
  model?: { provider?: string; modelId?: string } | null;
  modelNames?: Record<string, string>;
}

function tokenText(value: number | undefined): string {
  return formatTrajectoryTokens(value) ?? "0";
}

function modelLabel(
  model: { provider?: string; modelId?: string } | null | undefined,
  modelNames: Record<string, string> | undefined,
): string | null {
  if (!model?.modelId) return null;
  const key = `${model.provider ?? ""}:${model.modelId}`;
  return modelNames?.[key] ?? modelNames?.[model.modelId] ?? model.modelId;
}

function Ring({ percent }: { percent: number | null }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <div className="context-ring" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle className="context-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="context-ring-fill"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="context-ring-value">{percent === null ? "—" : `${Math.round(percent)}%`}</span>
    </div>
  );
}

export function ContextView({
  messages,
  contextUsage,
  sessionStats,
  systemPrompt,
  toolNames,
  model,
  modelNames,
}: Props) {
  const { t, language } = useI18n();
  const usage = contextUsage ?? sessionStats?.contextUsage ?? null;
  const breakdown = useMemo(
    () =>
      buildContextBreakdown({
        messages,
        systemPrompt,
        toolNames,
        contextUsage: usage,
      }),
    [messages, systemPrompt, toolNames, usage],
  );
  const modelName = modelLabel(model, modelNames);
  const counts = breakdown.messageCounts;
  const loadedChatMessages = counts.user + counts.assistant + counts.toolResult;
  const totalMessages = Math.max(loadedChatMessages, sessionStats?.totalMessages ?? loadedChatMessages);
  const contextWindow = breakdown.contextWindow || usage?.contextWindow || 0;
  const partTotal = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
  const barPercent = breakdown.percent ?? (partTotal > 0 ? 100 : 0);
  const segmentPercent = (value: number) => (partTotal > 0 ? (barPercent * value) / partTotal : 0);
  const segments = [
    { key: "system", value: breakdown.systemTokens, percent: segmentPercent(breakdown.systemTokens) },
    { key: "tools", value: breakdown.toolsTokens, percent: segmentPercent(breakdown.toolsTokens) },
    { key: "messages", value: breakdown.messageTokens, percent: segmentPercent(breakdown.messageTokens) },
  ].filter((segment) => segment.value > 0);
  const usageRows: Array<[string, string]> = sessionStats
    ? [
        [t("usageInput", "Input"), tokenText(sessionStats.tokens.input)],
        [t("usageOutput", "Output"), tokenText(sessionStats.tokens.output)],
        [t("cacheRead", "Cache read"), tokenText(sessionStats.tokens.cacheRead)],
        [t("cacheWrite", "Cache write"), tokenText(sessionStats.tokens.cacheWrite)],
        [t("tokens", "tokens"), tokenText(sessionStats.tokens.total)],
        [t("usageCost", "Cost"), formatTrajectoryCost(sessionStats.cost) ?? "$0.0000"],
      ]
    : [];
  const showRuntime = breakdown.runtimeReported;

  return (
    <div className="context-view">
      <div className="context-scroll">
        <div className="context-content">
          <section className="context-summary" aria-label={t("contextUsed", "Context used")}>
            <Ring percent={breakdown.percent} />
            <div className="context-summary-main">
              <div className="context-summary-heading">
                <span className="context-summary-title">{t("contextUsed", "Context used")}</span>
                <span className="context-state" data-runtime={showRuntime || undefined}>
                  {showRuntime ? t("contextRuntime", "Runtime reported") : t("contextEstimated", "Estimated")}
                </span>
              </div>
              <div className="context-figures">
                <strong>{tokenText(breakdown.usedTokens)}</strong>
                <span>/</span>
                <span>{contextWindow > 0 ? tokenText(contextWindow) : "—"}</span>
                <span>{t("tokens", "tokens")}</span>
              </div>
              <div className="context-meta">
                {modelName && <span>{modelName}</span>}
                <span>
                  {t("contextLoaded", "Loaded messages")}: {loadedChatMessages}
                </span>
                <span>
                  {t("contextTotal", "Total session messages")}: {totalMessages.toLocaleString(language)}
                </span>
              </div>
            </div>
            <div className="context-summary-badges">
              {sessionStats && (
                <span>
                  {t("toolCalls", "Tool Calls")}: {sessionStats.toolCalls.toLocaleString(language)}
                </span>
              )}
              <span>{t("contextToolCount", "{count} tools").replace("{count}", String(toolNames?.length ?? 0))}</span>
            </div>
          </section>

          <section className="context-card" aria-label={t("contextComposition", "Context composition")}>
            <header className="context-card-header">
              <span>{t("contextComposition", "Context composition")}</span>
              <span className="context-badge">{t("contextEstimated", "Estimated")}</span>
            </header>
            <div className="context-composition-bar" aria-hidden="true">
              {segments.map((segment) => (
                <span
                  key={segment.key}
                  className="context-composition-segment"
                  data-kind={segment.key}
                  style={{ width: `${Math.max(0, segment.percent)}%` }}
                />
              ))}
            </div>
            <dl className="context-legend">
              <div className="context-legend-row">
                <dt>
                  <span className="context-swatch" data-kind="system" aria-hidden="true" />
                  {t("contextSystemPrompt", "System prompt")}
                </dt>
                <dd>~{tokenText(breakdown.systemTokens)}</dd>
              </div>
              <div className="context-legend-row">
                <dt>
                  <span className="context-swatch" data-kind="tools" aria-hidden="true" />
                  {t("contextToolDefinitions", "Tool definitions")}
                </dt>
                <dd>~{tokenText(breakdown.toolsTokens)}</dd>
              </div>
              <div className="context-legend-row">
                <dt>
                  <span className="context-swatch" data-kind="messages" aria-hidden="true" />
                  {t("contextConversation", "Conversation")}
                </dt>
                <dd>~{tokenText(breakdown.messageTokens)}</dd>
              </div>
            </dl>
          </section>

          <section className="context-card">
            <details className="context-details">
              <summary className="context-card-header">
                <span>{t("contextSystemPrompt", "System prompt")}</span>
                <span className="context-badge">
                  ~{tokenText(breakdown.systemTokens)} {t("tokens", "tokens")}
                </span>
              </summary>
              <div className="context-details-body">
                <p className="context-hint">
                  {t("contextSystemPromptHint", "System prompt used by the current request.")}
                </p>
                {systemPrompt ? (
                  <pre className="context-prompt">{systemPrompt}</pre>
                ) : (
                  <p className="context-empty">
                    {t("contextNoSystemPrompt", "No system prompt is available for this session.")}
                  </p>
                )}
              </div>
            </details>
          </section>

          <section className="context-card">
            <div className="context-card-header">
              <span>{t("contextToolDefinitions", "Tool definitions")}</span>
              <span className="context-badge">
                {t("contextToolCount", "{count} tools").replace("{count}", String(toolNames?.length ?? 0))}
              </span>
            </div>
            <div className="context-card-body">
              <p className="context-hint">{t("contextToolHint", "Tools available in this session.")}</p>
              {toolNames && toolNames.length > 0 ? (
                <div className="context-tools">
                  {toolNames.map((name) => (
                    <code key={name}>{name}</code>
                  ))}
                </div>
              ) : (
                <p className="context-empty">{t("contextNoTools", "No tool definitions are available.")}</p>
              )}
            </div>
          </section>

          <section className="context-card">
            <div className="context-card-header">
              <span>{t("contextConversation", "Conversation")}</span>
              <span className="context-badge">
                {loadedChatMessages.toLocaleString(language)} / {totalMessages.toLocaleString(language)}
              </span>
            </div>
            <div className="context-card-body">
              <dl className="context-stat-grid">
                <div>
                  <dt>{t("user", "User")}</dt>
                  <dd>{counts.user.toLocaleString(language)}</dd>
                </div>
                <div>
                  <dt>{t("assistant", "Assistant")}</dt>
                  <dd>{counts.assistant.toLocaleString(language)}</dd>
                </div>
                <div>
                  <dt>{t("toolResults", "Tool Results")}</dt>
                  <dd>{counts.toolResult.toLocaleString(language)}</dd>
                </div>
                <div>
                  <dt>{t("contextCustomMessages", "Context messages")}</dt>
                  <dd>{counts.custom.toLocaleString(language)}</dd>
                </div>
              </dl>
              <p className="context-hint">
                {t("contextConversationHint", "Loaded history contributes to the estimate.")}
              </p>
            </div>
          </section>

          {sessionStats && (
            <section className="context-card">
              <div className="context-card-header">
                <span>{t("contextSessionUsage", "Session usage")}</span>
                <span className="context-badge">
                  {t("contextWindow", "Context window")}: {contextWindow > 0 ? tokenText(contextWindow) : "—"}
                </span>
              </div>
              <div className="context-card-body">
                <dl className="context-usage-grid">
                  {usageRows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {sessionStats.modelUsage && sessionStats.modelUsage.length > 0 && (
                  <dl className="context-model-usage">
                    {sessionStats.modelUsage.map((row) => (
                      <div key={`${row.provider}:${row.model}`}>
                        <dt>
                          {row.model
                            ? `${row.provider}/${row.model}`
                            : t("modelUnattributedUsage", "Tools and summaries")}
                        </dt>
                        <dd>
                          {tokenText(row.tokens)} · {formatTrajectoryCost(row.cost) ?? "$0.0000"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </section>
          )}

          <p className="context-note">
            {showRuntime
              ? t(
                  "contextUsageNote",
                  "The percentage comes from runtime context usage; prompt, tool and message token splits are estimates.",
                )
              : t("contextEstimatedOnly", "Runtime context usage was not reported; the figures below are estimates.")}
          </p>
        </div>
      </div>
    </div>
  );
}
