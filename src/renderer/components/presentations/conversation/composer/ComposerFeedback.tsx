import type { CompactResultInfo, QueuedMessages } from "@/hooks/useAgentSession";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { QueuedMessageRow } from "./QueuedMessageRow";

interface ComposerFeedbackProps {
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  compactResult?: CompactResultInfo | null;
  imageAttachNotice: string | null;
  submissionNotice: string | null;
  dismissImageNotice: () => void;
  dismissSubmissionNotice: () => void;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

export function ComposerFeedback({
  queuedMessages,
  onRecallQueue,
  retryInfo,
  compactResult,
  imageAttachNotice,
  submissionNotice,
  dismissImageNotice,
  dismissSubmissionNotice,
}: ComposerFeedbackProps) {
  const { t } = useI18n();
  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactVerb =
    compactResult?.reason && compactResult.reason !== "manual"
      ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} compacted`
      : "Compacted";
  const compactResultText = compactResult
    ? `${compactVerb} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${formatTokenCount(compactSavedTokens)} saved)`
    : null;
  return (
    <>
      {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
      {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) > 0 && (
        <div
          style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            padding: "5px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}
          >
            <span
              style={{
                fontSize: scaledChatFont(10),
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {t("queued", "Queued")} ·{" "}
              {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}
            </span>
            {onRecallQueue && (
              <button
                onClick={onRecallQueue}
                title={t(
                  "recallQueueDescription",
                  "Remove all queued messages and put them back into the input box for editing",
                )}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  fontSize: scaledChatFont(12),
                  color: "var(--text)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  cursor: "pointer",
                  transition: "background 0.12s, border-color 0.12s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 14 4 9 9 4" />
                  <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                </svg>
                {t("recallToInput", "Recall to input")}
              </button>
            )}
          </div>
          {queuedMessages?.steering.map((text, i) => (
            <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
          ))}
          {queuedMessages?.followUp.map((text, i) => (
            <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
          ))}
        </div>
      )}
      {/* Retry banner */}
      {retryInfo && (
        <div
          style={{
            marginBottom: 8,
            padding: "5px 10px",
            background: "rgba(234,179,8,0.08)",
            border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6,
            fontSize: scaledChatFont(12),
            color: "rgba(180,130,0,0.9)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {t("retrying", "Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…
          {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
        </div>
      )}
      {imageAttachNotice && (
        <div
          role="alert"
          style={{
            marginBottom: 8,
            padding: "5px 10px",
            background: "color-mix(in srgb, var(--danger) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
            borderRadius: 6,
            fontSize: scaledChatFont(12),
            color: "var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{imageAttachNotice}</span>
          <button
            type="button"
            onClick={dismissImageNotice}
            aria-label="Dismiss image attachment error"
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: 2,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      {submissionNotice && (
        <div
          role="alert"
          data-testid="composer-submission-error"
          style={{
            marginBottom: 8,
            padding: "5px 10px",
            background: "color-mix(in srgb, var(--danger) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
            borderRadius: 6,
            fontSize: scaledChatFont(12),
            color: "var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{submissionNotice}</span>
          <button
            type="button"
            onClick={dismissSubmissionNotice}
            aria-label={t("dismissSubmissionError", "Dismiss submission error")}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: 2,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      {compactResultText && (
        <div
          style={{
            marginBottom: 8,
            padding: "5px 10px",
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.24)",
            borderRadius: 6,
            fontSize: scaledChatFont(12),
            color: "rgba(5,150,105,0.95)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {compactResultText}
        </div>
      )}
    </>
  );
}
