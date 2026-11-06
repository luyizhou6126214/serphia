/**
 * Settled Turn header above its process rows, following DeepSeek Harness's
 * TurnProcessNodeView: one 33px line with a bottom hairline, a tertiary label
 * naming the outcome and elapsed time, and a chevron that folds the rows below.
 */
import { memo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n";
import { formatTurnDuration } from "@/lib/turn-duration";

export type TurnProcessStatus = "running" | "completed" | "failed" | "aborted";

/** Split a duration label so its numeric runs can use the code font. */
function durationParts(text: string): ReactNode[] {
  return text.split(/(\d+)/).map((part, index) =>
    /^\d+$/.test(part) ? (
      <span key={index} className="dsh-turn-duration-number">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export interface TurnProcessHeaderProps {
  status: TurnProcessStatus;
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  /** Whether the header folds the process rows below it. */
  foldable: boolean;
  open: boolean;
  onToggle: () => void;
  /** Assistive-technology announcement for the settled outcome. */
  announcement: string;
}

/**
 * Render the settled Turn header. A Turn that is still running owns no header:
 * the live status row carries the elapsed clock instead.
 */
export const TurnProcessHeader = memo(function TurnProcessHeader({
  status,
  startedAt,
  endedAt,
  foldable,
  open,
  onToggle,
  announcement,
}: TurnProcessHeaderProps) {
  const { language, t } = useI18n();
  if (status === "running") return null;
  const elapsedMs = startedAt === undefined || endedAt === undefined ? undefined : Math.max(1000, endedAt - startedAt);
  const duration = elapsedMs === undefined ? null : formatTurnDuration(elapsedMs, language);
  const label =
    status === "aborted"
      ? t("turnHeaderStopped", "Stopped")
      : status === "failed"
        ? t("turnHeaderFailed", "Failed")
        : duration === null
          ? t("turnHeaderWorked", "Completed")
          : `${t("turnHeaderTook", "Completed in ")}${duration}`;

  return (
    <>
      <span className="dsh-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <button
        type="button"
        className="dsh-turn-process"
        data-open={open || undefined}
        data-turn-status={status}
        disabled={!foldable}
        aria-expanded={foldable ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus();
          onToggle();
        }}
      >
        <span className="dsh-turn-process-label">
          {status === "aborted" || status === "failed" || duration === null ? label : durationParts(label)}
        </span>
        {foldable && (
          <ChevronDown className="dsh-turn-process-chevron" size={14} strokeWidth={1.6} aria-hidden="true" />
        )}
      </button>
    </>
  );
});
