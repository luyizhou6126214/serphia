/**
 * A Turn's process rows behind one activity header, following DeepSeek
 * Harness's group seat: the leading glyph swaps to a chevron on hover or while
 * open, the title names the activity in flight while the Turn runs and the
 * settled work once it closes, and an opened group caps its own scroll with
 * fade edges.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type UIEvent } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Code2,
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Search,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";
import { useI18n } from "@/i18n";
import type { WorkStepDisplayPolicy } from "@shared/work-step-display";
import { TextShimmer } from "./TextShimmer";
import {
  liveProcessTitle,
  processTitle,
  processTitleWithDetail,
  type ProcessActivityKind,
  type ProcessActivitySummary,
} from "./process-activity";
import { cx } from "./cx";

const PROCESS_ICONS: Record<ProcessActivityKind, ReactNode> = {
  thinking: <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" />,
  read: <FileText size={14} strokeWidth={1.6} aria-hidden="true" />,
  readImage: <FileText size={14} strokeWidth={1.6} aria-hidden="true" />,
  write: <FilePen size={14} strokeWidth={1.6} aria-hidden="true" />,
  search: <Search size={14} strokeWidth={1.6} aria-hidden="true" />,
  edit: <FilePen size={14} strokeWidth={1.6} aria-hidden="true" />,
  commands: <Terminal size={14} strokeWidth={1.6} aria-hidden="true" />,
  code: <Code2 size={14} strokeWidth={1.6} aria-hidden="true" />,
  webSearch: <Globe size={14} strokeWidth={1.6} aria-hidden="true" />,
  webFetch: <Globe size={14} strokeWidth={1.6} aria-hidden="true" />,
  subagents: <Users size={14} strokeWidth={1.6} aria-hidden="true" />,
  plan: <ListChecks size={14} strokeWidth={1.6} aria-hidden="true" />,
  questions: <Activity size={14} strokeWidth={1.6} aria-hidden="true" />,
  tools: <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" />,
};

interface ScrollEdges {
  canScrollUp: boolean;
  canScrollDown: boolean;
}

/** Track whether the group body overflows either edge, so its fades stay honest. */
function useScrollEdges(active: boolean): {
  edges: ScrollEdges;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  measure: () => void;
  bodyRef: React.RefObject<HTMLDivElement | null>;
} {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ canScrollUp: false, canScrollDown: false });

  const measure = useCallback(() => {
    const node = bodyRef.current;
    if (node === null) {
      setEdges((current) =>
        current.canScrollUp || current.canScrollDown ? { canScrollUp: false, canScrollDown: false } : current,
      );
      return;
    }
    const canScrollUp = node.scrollTop > 1;
    const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setEdges((current) =>
      current.canScrollUp === canScrollUp && current.canScrollDown === canScrollDown
        ? current
        : { canScrollUp, canScrollDown },
    );
  }, []);

  useEffect(() => {
    if (!active) {
      setEdges((current) =>
        current.canScrollUp || current.canScrollDown ? { canScrollUp: false, canScrollDown: false } : current,
      );
      return;
    }
    measure();
    const node = bodyRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, measure]);

  return { edges, onScroll: measure, measure, bodyRef };
}

export interface ProcessGroupProps {
  /** Stable expansion key so a remount keeps the reader's choice. */
  stateKey: string;
  readStored: (stateKey: string) => boolean | undefined;
  writeStored: (stateKey: string, expanded: boolean) => void;
  policy: WorkStepDisplayPolicy;
  /** Whether this Turn exposes a collapsible group header at all. */
  grouped: boolean;
  /** Whether the owning Turn has settled. */
  settled: boolean;
  running: boolean;
  liveActivity: ProcessActivityKind;
  livePreparing: boolean;
  liveDetail: string;
  summary: ProcessActivitySummary;
  children: ReactNode;
}

/**
 * Render one Turn's process rows. Ungrouped Turns render the rows in flow;
 * grouped Turns fold them behind the activity header, closed by default.
 */
export function ProcessGroup({
  stateKey,
  readStored,
  writeStored,
  policy,
  grouped,
  settled,
  running,
  liveActivity,
  livePreparing,
  liveDetail,
  summary,
  children,
}: ProcessGroupProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => readStored(stateKey) ?? false);
  const bodyId = useId();
  const open = expanded;
  const bodyActive = grouped && open;
  const { edges, onScroll, measure, bodyRef } = useScrollEdges(bodyActive);

  useEffect(() => {
    measure();
  }, [open, measure]);

  const toggle = () => {
    const next = !open;
    setExpanded(next);
    writeStored(stateKey, next);
  };

  if (!grouped) {
    return (
      <div className="dsh-flow dsh-process-body" data-chat-flow="" data-step-process-body="">
        {children}
      </div>
    );
  }

  const settledTitle = processTitle(summary, t);
  const label = settled ? settledTitle : liveProcessTitle(liveActivity, livePreparing, t);
  const detail = policy.liveProcessDetail && !settled ? liveDetail : "";
  const title = processTitleWithDetail(label, detail, t);
  const activity = settled ? (summary.counts[0]?.kind ?? "thinking") : liveActivity;

  return (
    <div className="dsh-process-group" data-chat-group="" data-process-activity={activity}>
      <button
        type="button"
        className="dsh-process-title"
        aria-expanded={open}
        aria-controls={bodyId}
        data-process-activity={activity}
        title={
          open
            ? t("collapseProcessDetails", "Collapse process details")
            : t("expandProcessDetails", "Expand process details")
        }
        onClick={(event) => {
          event.currentTarget.focus();
          toggle();
        }}
      >
        <span className="dsh-process-leading" aria-hidden="true">
          <span className="dsh-process-activity-icon">{PROCESS_ICONS[activity]}</span>
          <span className="dsh-process-chevron">
            {open ? (
              <ChevronUp size={14} strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
            )}
          </span>
        </span>
        <TextShimmer active={running || !settled}>
          <TextShimmer className="dsh-process-label">{title}</TextShimmer>
        </TextShimmer>
      </button>
      <div
        ref={bodyRef}
        id={bodyId}
        className={cx(
          "dsh-process-group-body",
          edges.canScrollUp && "is-faded-top",
          edges.canScrollDown && "is-faded-bottom",
        )}
        hidden={!open}
        data-step-process-body=""
        data-scroll-up={edges.canScrollUp || undefined}
        data-scroll-down={edges.canScrollDown || undefined}
        onScroll={onScroll}
      >
        <div className="dsh-process-group-content" data-step-process-content="" data-chat-flow="">
          {children}
        </div>
      </div>
    </div>
  );
}
