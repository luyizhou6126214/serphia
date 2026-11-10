import { ArrowRight, ArrowUp, Clock3, FileText, X } from "lucide-react";
import { useI18n } from "@/i18n";
import type { PendingComposerMessage, usePendingComposerMessages } from "@/hooks/usePendingComposerMessages";
import { ReferenceText } from "./ReferenceText";

export function PendingMessages({
  pending,
  sending,
  isStreaming,
  canSteer,
  canFollowUp,
  onSubmit,
}: {
  pending: ReturnType<typeof usePendingComposerMessages>;
  sending: string | null;
  isStreaming: boolean;
  canSteer: boolean;
  canFollowUp: boolean;
  onSubmit: (message: PendingComposerMessage, mode: "steer" | "followup" | "send") => Promise<void>;
}) {
  const { t } = useI18n();
  if (!pending.messages.length) return null;
  const busy = !!sending?.startsWith(`${pending.owner}:`);
  return (
    <div className="composer-pending-list" aria-label={t("pendingMessages", "Waiting for your choice")}>
      {pending.messages.map((message) => (
        <div className="composer-pending-row" key={message.id}>
          <div className="composer-pending-content">
            <span className="composer-pending-text">
              <ReferenceText text={message.text} />
            </span>
            {message.files.map((file) => (
              <span className="composer-pending-file" title={file.path} key={file.path}>
                <FileText size={13} aria-hidden="true" />
                {file.name}
              </span>
            ))}
          </div>
          <div className="composer-pending-actions">
            {isStreaming ? (
              <>
                {canSteer && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onSubmit(message, "steer")}
                    title={t("steerDescription", "Interrupt the current run and inject this message now")}
                  >
                    <ArrowRight size={14} aria-hidden="true" />
                    {t("steer", "Steer")}
                  </button>
                )}
                {canFollowUp && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onSubmit(message, "followup")}
                    title={t("followUpDescription", "Queue this message after the agent finishes")}
                  >
                    <Clock3 size={14} aria-hidden="true" />
                    {t("followUp", "Follow-up")}
                  </button>
                )}
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => void onSubmit(message, "send")}>
                <ArrowUp size={14} aria-hidden="true" />
                {t("send", "Send")}
              </button>
            )}
            <button
              type="button"
              className="composer-pending-remove"
              disabled={busy}
              aria-label={t("removePendingMessage", "Remove pending message")}
              title={t("removePendingMessage", "Remove pending message")}
              onClick={() => pending.update(pending.owner, (items) => items.filter((item) => item.id !== message.id))}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
