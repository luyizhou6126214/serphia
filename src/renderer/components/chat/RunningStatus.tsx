/**
 * Running Turn clock, isolated from the transcript's render cycle. Follows DeepSeek
 * Harness's RunningStatus: a hairline divider, the swimming mark, and one
 * shimmering label carrying the localized elapsed time.
 */
import { memo, useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { formatTurnDuration } from "@/lib/turn-duration";
import { TextShimmer } from "./TextShimmer";
import { RunningTail } from "./RunningTail";

/** Refresh interval for the whole-second live clock. */
const LIVE_RUN_CLOCK_INTERVAL_MS = 1000;

export interface RunningStatusProps {
  /** Start of the currently running Turn, when known. */
  startTime: number | undefined;
}

/**
 * Show live elapsed time after the current Turn's content without announcing
 * ticks. Mount only while the session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime }: RunningStatusProps) {
  const { language, t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startTime === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, LIVE_RUN_CLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [startTime]);
  const idle = t("runningDeepDiving", "Deep diving");
  const duration = startTime === undefined ? null : formatTurnDuration(Math.max(1000, now - startTime), language);
  const label =
    duration === null
      ? idle
      : t("runningDeepDivingFor", "Deep diving for {duration} ···").replace("{duration}", duration);
  return (
    <div className="dsh-running" data-chat-running="">
      <span className="dsh-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {idle}
      </span>
      <span className="dsh-running-divider" aria-hidden="true" />
      <span className="dsh-running-content">
        <RunningTail />
        <TextShimmer active className="dsh-running-text">
          {label}
        </TextShimmer>
      </span>
    </div>
  );
});
