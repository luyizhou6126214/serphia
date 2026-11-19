import { getAssistantFailureDetail, isAssistantAborted, isAssistantFailure } from "@/lib/message-display";
import type { AssistantMessage } from "@/lib/types";
import { useI18n } from "@/i18n";

/**
 * Terminal Turn outcome, following DeepSeek Harness: a quiet inline "stopped"
 * tag for an interruption, and a dot-led failure row for a provider error.
 */
export function AssistantOutcome({ message, isStreaming }: { message: AssistantMessage; isStreaming?: boolean }) {
  const { t } = useI18n();
  const aborted = isAssistantAborted(message);
  if (isStreaming || (!aborted && !isAssistantFailure(message))) return null;

  if (aborted) {
    return (
      <span role="status" data-testid="assistant-stopped-message" className="ppt-dsh-stopped-marker">
        {t("agentResponseStopped", "Response stopped")}
      </span>
    );
  }

  const detail =
    getAssistantFailureDetail(message) ??
    t(
      "modelRequestFailedFallback",
      "The model service did not return error details. Check the API key, service URL, and model configuration.",
    );
  return (
    <div role="alert" data-testid="assistant-error-message" className="ppt-dsh-turn-error">
      <span className="ppt-dsh-turn-error-dot" aria-hidden="true" />
      <div className="ppt-dsh-turn-error-copy">
        <span className="ppt-dsh-turn-error-title">{t("modelRequestFailed", "Model request failed")}</span>
        <span className="ppt-dsh-turn-error-message">{detail}</span>
      </div>
    </div>
  );
}
