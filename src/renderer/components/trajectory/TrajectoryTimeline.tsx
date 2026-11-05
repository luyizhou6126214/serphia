import { useMemo } from "react";
import {
  formatTrajectoryDuration,
  trajectoryTimeDomain,
  type TrajectorySnapshot,
  type TrajectorySpan,
} from "@/lib/trajectory";

type Translate = (key: string, fallback: string) => string;

interface Props {
  snapshot: TrajectorySnapshot;
  actualDuration: boolean;
  selectedRowId: string | null;
  searchMatchIds: ReadonlySet<string> | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  onSelectRow: (rowId: string) => void;
  language: string;
  t: Translate;
}

interface PositionedSpan {
  span: TrajectorySpan;
  left: number;
  width: number;
}

const LANE_TOP = [7, 21, 35];

function clock(timestamp: number, language: string): string {
  return new Date(timestamp).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function kindLabel(kind: TrajectorySpan["kind"], t: Translate): string {
  switch (kind) {
    case "user":
      return t("trajectoryKindUser", "User");
    case "assistant":
      return t("trajectoryKindAssistant", "Assistant");
    case "tool":
      return t("trajectoryKindTool", "Tool");
    case "context":
      return t("trajectoryKindContext", "Context");
    default:
      return t("trajectoryKindSystem", "System");
  }
}

function spanTitle(span: TrajectorySpan, language: string, t: Translate): string {
  const duration = formatTrajectoryDuration(span.durationMs);
  const time = clock(span.start, language);
  return [kindLabel(span.kind, t), time, duration].filter(Boolean).join(" · ");
}

export function TrajectoryTimeline({
  snapshot,
  actualDuration,
  selectedRowId,
  searchMatchIds,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSelectRow,
  language,
  t,
}: Props) {
  const domain = trajectoryTimeDomain(snapshot);
  const positioned = useMemo<PositionedSpan[]>(() => {
    const spans = snapshot.turns.flatMap((turn) => turn.spans);
    if (spans.length === 0) return [];
    if (actualDuration && domain) {
      return spans.map((span) => ({
        span,
        left: ((span.start - domain.start) / domain.duration) * 100,
        width: Math.max(0.3, (span.durationMs / domain.duration) * 100),
      }));
    }
    return spans.map((span, index) => ({
      span,
      left: (index / spans.length) * 100,
      width: 100 / spans.length,
    }));
  }, [actualDuration, domain, snapshot.turns]);

  const turnLines = useMemo(() => {
    if (positioned.length === 0) return [];
    if (actualDuration && domain) {
      return snapshot.turns.flatMap((turn) =>
        typeof turn.startedAt === "number"
          ? [{ index: turn.index, left: ((turn.startedAt - domain.start) / domain.duration) * 100 }]
          : [],
      );
    }
    const firstById = new Map<string, number>();
    positioned.forEach((item, index) => {
      if (!firstById.has(item.span.rowId)) firstById.set(item.span.rowId, index);
    });
    return snapshot.turns.flatMap((turn) => {
      const first = turn.rows.find((row) => firstById.has(row.id));
      const slot = first ? firstById.get(first.id) : undefined;
      return slot === undefined ? [] : [{ index: turn.index, left: (slot / positioned.length) * 100 }];
    });
  }, [actualDuration, domain, positioned, snapshot.turns]);

  return (
    <section
      className="trajectory-timeline"
      aria-label={t("trajectoryTimeline", "Trajectory timeline")}
      data-timeline-mode={actualDuration ? "duration" : "sequence"}
    >
      <div className="trajectory-timeline-plot">
        <div className="trajectory-timeline-labels" aria-hidden="true">
          <span>{t("trajectoryLaneInput", "Input")}</span>
          <span>{t("trajectoryLaneModel", "Model")}</span>
          <span>{t("trajectoryLaneTools", "Tools")}</span>
        </div>
        <div
          className="trajectory-timeline-track"
          role="group"
          tabIndex={0}
          aria-label={t("trajectoryTimelineHint", "Recorded start time and duration for each event")}
        >
          {positioned.length === 0 ? (
            <span className="trajectory-timeline-empty">{t("trajectoryNoTiming", "No timing data")}</span>
          ) : (
            positioned.map(({ span, left, width }) => (
              <button
                key={span.id}
                type="button"
                className="trajectory-timeline-span"
                data-kind={span.kind}
                data-status={span.status}
                data-selected={selectedRowId === span.rowId || undefined}
                data-dimmed={searchMatchIds !== null && !searchMatchIds.has(span.rowId) ? "true" : undefined}
                style={{
                  top: LANE_TOP[span.lane === "tool" ? 2 : span.lane === "model" ? 1 : 0],
                  left: `${left}%`,
                  width: `max(2px, calc(${width}% - 2px))`,
                }}
                title={spanTitle(span, language, t)}
                aria-label={spanTitle(span, language, t)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectRow(span.rowId);
                }}
              />
            ))
          )}
          {turnLines.map((line) => (
            <span key={line.index} className="trajectory-timeline-turn-line" style={{ left: `${line.left}%` }} />
          ))}
          {hasOlder && (
            <button
              type="button"
              className="trajectory-timeline-earlier"
              disabled={loadingOlder}
              title={
                loadingOlder
                  ? t("trajectoryLoadingEarlier", "Loading earlier history…")
                  : t("trajectoryLoadEarlier", "Load earlier trajectory")
              }
              aria-label={
                loadingOlder
                  ? t("trajectoryLoadingEarlier", "Loading earlier history…")
                  : t("trajectoryLoadEarlier", "Load earlier trajectory")
              }
              onClick={(event) => {
                event.stopPropagation();
                void onLoadOlder();
              }}
            >
              …
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
