import { Database, Gauge } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ContextUsage, SessionStatsInfo } from "@shared/pi-types";
import { useI18n } from "@/i18n";
import { formatStatCacheHit, formatStatTokens, formatStatTokensPerSecond } from "./composer-stats-format";
import { formatNumber } from "@/lib/locale-format";
import { formatTurnDuration } from "@/lib/turn-duration";

/**
 * Composer statistics dock, modelled on DeepSeek Harness's composer dock:
 * one tertiary reading for activity, one for whole-session token usage, and
 * the context-occupancy ring last. Every reading opens its own small,
 * trigger-anchored dialog instead of reusing the top session panel.
 */

/** Ring geometry: 14px viewBox, 2px stroke, matching the DSH context meter. */
const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Viewport margin and trigger gap for the anchored stat dialogues. */
const DIALOG_MARGIN = 12;
const DIALOG_GAP = 8;

function joinReadings(first: ReactNode, second: ReactNode | null): ReactNode {
  if (second === null) return first;
  return (
    <>
      {first}
      <span className="composer-stat-sep" aria-hidden="true">
        ·
      </span>
      {second}
    </>
  );
}

function ContextRing({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle className="composer-context-track" cx="7" cy="7" r={RING_RADIUS} />
      <circle
        className="composer-context-fill"
        cx="7"
        cy="7"
        r={RING_RADIUS}
        strokeDasharray={`${(RING_CIRCUMFERENCE * clamped) / 100} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

function DialogRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/**
 * One anchored stats dialogue. The portal measures itself hidden, then clamps
 * above or below the trigger inside the visual viewport; outside pointerdown
 * and Escape dismiss it.
 */
function StatDialog({
  anchorRef,
  onClose,
  title,
  icon,
  titleValue,
  children,
}: {
  anchorRef: RefObject<HTMLSpanElement | null>;
  onClose: () => void;
  title: string;
  icon: ReactNode;
  titleValue: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const update = (): void => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const width = panelRect.width;
      const left = Math.min(
        Math.max(DIALOG_MARGIN, rect.left + rect.width / 2 - width / 2),
        viewportWidth - width - DIALOG_MARGIN,
      );
      const above = rect.top - DIALOG_GAP - panelRect.height >= DIALOG_MARGIN;
      const top = above
        ? rect.top - DIALOG_GAP - panelRect.height
        : Math.min(rect.bottom + DIALOG_GAP, viewportHeight - panelRect.height - DIALOG_MARGIN);
      setPosition((previous) =>
        previous !== null && previous.left === left && previous.top === top ? previous : { left, top },
      );
    };
    update();
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (panel !== null) observer?.observe(panel);
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [anchorRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return;
      onClose();
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return;
      onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchorRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchorRef, onClose]);

  const style: CSSProperties = position ?? { visibility: "hidden", left: 0, top: 0 };
  const panel = (
    <div ref={panelRef} className="composer-menu composer-stat-dialog" role="dialog" aria-label={title} style={style}>
      <div className="composer-stat-dialog-title">
        <span className="composer-stat-dialog-title-label">
          {icon}
          {title}
        </span>
        <span className="composer-stat-dialog-title-value">{titleValue}</span>
      </div>
      <div className="composer-stat-dialog-rule" aria-hidden="true" />
      <dl className="composer-stat-dialog-details">{children}</dl>
    </div>
  );
  return typeof document === "undefined" ? panel : createPortal(panel, document.body);
}

function StatReading({
  icon,
  label,
  title,
  dialogTitle,
  dialogTitleValue,
  dialogIcon,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  title: string;
  dialogTitle: string;
  dialogTitleValue: string;
  dialogIcon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <span ref={anchorRef} className="composer-stat-anchor">
      <button
        type="button"
        className="composer-stat"
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span className="composer-stat-label">{label}</span>
      </button>
      {open && (
        <StatDialog
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          title={dialogTitle}
          icon={dialogIcon}
          titleValue={dialogTitleValue}
        >
          {children}
        </StatDialog>
      )}
    </span>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage & { percent: number } }) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const percent = Math.min(100, Math.max(0, usage.percent));
  const reading = `${Math.round(percent)}%`;
  const title = [
    t("composerContextUsed", "Context used {percent}%").replace("{percent}", String(Math.round(percent))),
    usage.tokens !== null && usage.contextWindow > 0
      ? `~${formatStatTokens(usage.tokens)} / ${formatStatTokens(usage.contextWindow)} ${t("tokens", "tokens")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const usedText =
    usage.tokens === null
      ? "—"
      : `~${formatStatTokens(usage.tokens)} / ${formatStatTokens(usage.contextWindow)} ${t("tokens", "tokens")}`;
  return (
    <span ref={anchorRef} className="composer-stat-anchor">
      <button
        type="button"
        className="composer-context"
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ContextRing percent={percent} />
        <span>{reading}</span>
      </button>
      {open && (
        <StatDialog
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          title={t("composerContextUsage", "Context usage")}
          icon={<ContextRing percent={percent} />}
          titleValue={reading}
        >
          <DialogRow label={t("composerTokensUsed", "Used")} value={usedText} />
          <DialogRow label={t("composerTokensRemaining", "Remaining")} value={`${Math.round(100 - percent)}%`} />
        </StatDialog>
      )}
    </span>
  );
}

export interface ComposerStatsProps {
  sessionStats:
    | Partial<
        Pick<
          SessionStatsInfo,
          | "tokens"
          | "userMessages"
          | "assistantMessages"
          | "tokensPerSecond"
          | "llmDurationMs"
          | "toolDurationMs"
          | "contextUsage"
        >
      >
    | null
    | undefined;
  contextUsage: ContextUsage | null | undefined;
  activityLabel?: string;
  cacheUsageKnown?: boolean;
  showContextCapacity?: boolean;
}

export function ComposerStats({
  sessionStats,
  contextUsage,
  activityLabel: activityOverride,
  cacheUsageKnown = true,
  showContextCapacity,
}: ComposerStatsProps) {
  const { t, language } = useI18n();
  const tokens = sessionStats?.tokens;
  const turns = sessionStats?.userMessages ?? 0;
  const steps = sessionStats?.assistantMessages ?? 0;
  const speed = sessionStats?.tokensPerSecond;
  const total = tokens?.total ?? 0;
  const promptTokens = tokens === undefined ? 0 : tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const cacheHit = tokens === undefined || !cacheUsageKnown ? null : formatStatCacheHit(tokens.cacheRead, promptTokens);

  const activityLabel =
    activityOverride ??
    (turns > 0
      ? t("composerTurnsSteps", "{turns} turns {steps} steps")
          .replace("{turns}", String(turns))
          .replace("{steps}", String(steps))
      : null);
  const speedLabel =
    speed !== undefined
      ? t("composerTokensPerSecond", "{tps} tok/s").replace("{tps}", formatStatTokensPerSecond(speed))
      : null;
  const activity = activityLabel === null ? speedLabel : joinReadings(activityLabel, speedLabel);

  const totalLabel =
    total > 0 ? t("composerTokens", "{tokens} tok").replace("{tokens}", formatStatTokens(total)) : null;
  const cacheLabel =
    cacheHit === null ? null : t("composerCacheHit", "Cache hit {percent}%").replace("{percent}", cacheHit);
  const usage = totalLabel === null ? null : joinReadings(totalLabel, cacheLabel);

  const usageReading = contextUsage ?? sessionStats?.contextUsage ?? null;
  const contextWindow = usageReading?.contextWindow ?? 0;
  const rawPercent =
    usageReading?.percent ??
    (usageReading?.tokens != null && contextWindow > 0 ? (usageReading.tokens / contextWindow) * 100 : null);
  const context =
    rawPercent === null ? null : ({ ...usageReading, percent: rawPercent } as ContextUsage & { percent: number });
  const capacity =
    showContextCapacity && context === null && contextWindow > 0 ? formatStatTokens(contextWindow) : null;

  if (activity === null && usage === null && context === null && capacity === null) return null;

  const exact = (value: number): string => formatNumber(value, language);
  const llmTime = formatTurnDuration(sessionStats?.llmDurationMs, language);
  const toolTime = formatTurnDuration(sessionStats?.toolDurationMs, language);
  const speedText = speed === undefined ? null : `${formatStatTokensPerSecond(speed)} tok/s`;

  return (
    <div className="composer-stats" data-composer-stats>
      {activity !== null && (
        <StatReading
          icon={<Gauge size={14} strokeWidth={1.6} aria-hidden="true" />}
          label={activity}
          title={[activityLabel, speedLabel].filter(Boolean).join(" · ")}
          dialogTitle={t("composerSessionStats", "Session stats")}
          dialogTitleValue={activityLabel ?? speedLabel ?? ""}
          dialogIcon={<Gauge size={14} strokeWidth={1.6} aria-hidden="true" />}
        >
          {llmTime !== null && <DialogRow label={t("composerModelTime", "Model time")} value={llmTime} />}
          {toolTime !== null && <DialogRow label={t("composerToolTime", "Tool time")} value={toolTime} />}
          {speedText !== null && <DialogRow label={t("composerOutputSpeed", "Output speed")} value={speedText} />}
        </StatReading>
      )}
      {usage !== null && tokens !== undefined && (
        <StatReading
          icon={<Database size={14} strokeWidth={1.6} aria-hidden="true" />}
          label={usage}
          title={[
            t("composerTokens", "{tokens} tok").replace("{tokens}", formatStatTokens(total)),
            cacheHit === null ? null : t("composerCacheHit", "Cache hit {percent}%").replace("{percent}", cacheHit),
            `${t("usageInput", "Input")}: ${formatStatTokens(tokens.input)} · ${t("usageOutput", "Output")}: ${formatStatTokens(tokens.output)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          dialogTitle={t("composerTokenUsage", "Token usage")}
          dialogTitleValue={exact(total)}
          dialogIcon={<Database size={14} strokeWidth={1.6} aria-hidden="true" />}
        >
          {cacheHit !== null && <DialogRow label={t("composerCacheHitLabel", "Cache hit")} value={`${cacheHit}%`} />}
          <DialogRow label={t("usageInput", "Input")} value={exact(tokens.input)} />
          {tokens.cacheRead > 0 && <DialogRow label={t("cacheRead", "Cache read")} value={exact(tokens.cacheRead)} />}
          {tokens.cacheWrite > 0 && (
            <DialogRow label={t("cacheWrite", "Cache write")} value={exact(tokens.cacheWrite)} />
          )}
          <DialogRow label={t("usageOutput", "Output")} value={exact(tokens.output)} />
        </StatReading>
      )}
      {context !== null && <ContextMeter usage={context} />}
      {capacity !== null && (
        <span className="composer-context" title={t("contextWindow", "Context window")}>
          <ContextRing percent={0} />
          <span>
            {t("contextWindow", "Context window")} {capacity}
          </span>
        </span>
      )}
    </div>
  );
}
