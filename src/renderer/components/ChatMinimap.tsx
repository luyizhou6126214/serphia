import { useCallback, useEffect, useRef, useState, useMemo, type RefObject } from "react";
import { useI18n } from "@/i18n";

export interface ChatMinimapMessage {
  role: "user" | "assistant";
  preview: string;
  hasText: boolean;
}

interface Props {
  messages: ChatMinimapMessage[];
  streamingMessage: ChatMinimapMessage | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  historyTruncated?: boolean;
}

interface TimelineNode {
  index: number;
  /** Offset of the turn's first message inside the transcript. */
  offset: number;
  /** The turn's prompt preview. */
  prompt: string;
  /** The turn's latest answer preview. */
  response: string;
}

/** Vertical pitch between two turn marks, matching DeepSeek Harness's rail. */
const TURN_SPACING_PX = 10;
/** Space above the first mark and below the last one. */
const RAIL_INSET_PX = 6;
/** Edge band the fade masks reserve on a scrollable rail. */
const FADE_PX = 16;
/** The ladder stays centered and compact, like DeepSeek Harness. */
const MAX_RAIL_HEIGHT_PX = 420;
/** Band clearance reserved above and below the centered ladder. */
const RAIL_BAND_CLEARANCE_PX = 96;

/**
 * The conversation's turn rail, following DeepSeek Harness: one mark per turn
 * (a prompt and its answer are one mark), a fixed 10px ladder centered in the
 * transcript band, a hover preview, and a click that jumps to the turn. A
 * ladder taller than the band scrolls inside the rail, and the active mark is
 * kept in view — including the last turn once the reader reaches the bottom.
 */
export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs, historyTruncated }: Props) {
  const { t } = useI18n();
  const [layout, setLayout] = useState({ nodes: [] as TimelineNode[], activeIndex: -1, visible: false });
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [railMaxHeight, setRailMaxHeight] = useState(MAX_RAIL_HEIGHT_PX);
  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages),
    [messages, streamingMessage],
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  useEffect(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const total = scrollEl.scrollHeight;
      const rect = scrollEl.getBoundingClientRect();
      const nodes: TimelineNode[] = [];
      allMessagesRef.current.forEach((message, index) => {
        if (message.role === "user") {
          const element = messageRefs.current[index];
          if (!element) return;
          const offset = element.getBoundingClientRect().top - rect.top + scrollEl.scrollTop;
          nodes.push({ index, offset, prompt: message.preview, response: "" });
        } else if (message.hasText && nodes.length > 0) {
          nodes[nodes.length - 1].response = message.preview;
        }
      });
      // A turn is active once the reader reaches its opening within the top
      // quarter of the viewport; at the very bottom the newest turn wins, so
      // the last mark lights up even when its prompt sits above that line.
      const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= total - 8;
      const currentOffset = scrollEl.scrollTop + Math.min(scrollEl.clientHeight * 0.25, 160);
      const activeIndex =
        nodes.length === 0
          ? -1
          : atBottom
            ? nodes.length - 1
            : Math.max(
                0,
                nodes.findLastIndex((node) => node.offset <= currentOffset),
              );
      setLayout({ nodes, activeIndex, visible: total > scrollEl.clientHeight + 20 });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scrollEl);
    if (scrollEl.firstElementChild) observer.observe(scrollEl.firstElementChild);
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollEl.removeEventListener("scroll", schedule);
    };
  }, [scrollContainer, messageRefs, allMessages]);

  // The ladder is capped by the transcript band it centers in.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const fit = () => {
      setRailMaxHeight(Math.min(MAX_RAIL_HEIGHT_PX, Math.max(0, nav.clientHeight - RAIL_BAND_CLEARANCE_PX)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(nav);
    fit();
    return () => observer.disconnect();
  }, []);

  /** Keep the active mark inside the fade-free band of a scrolling rail. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || layout.activeIndex < 0) return;
    const top = RAIL_INSET_PX + layout.activeIndex * TURN_SPACING_PX;
    const viewTop = scroller.scrollTop;
    const viewHeight = scroller.clientHeight;
    if (viewHeight <= 0 || scroller.scrollHeight <= viewHeight + 1) return;
    const bandTop = viewTop + FADE_PX;
    const bandBottom = viewTop + viewHeight - FADE_PX;
    if (top < bandTop || top + TURN_SPACING_PX > bandBottom) {
      scroller.scrollTop = Math.max(0, top + TURN_SPACING_PX / 2 - viewHeight / 2);
    }
  }, [layout.activeIndex, layout.nodes.length]);

  const updateEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop > 2;
    const bottom = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2;
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  }, []);
  useEffect(updateEdges, [updateEdges, layout.nodes.length]);

  const markTop = (index: number): number => RAIL_INSET_PX + index * TURN_SPACING_PX;
  const marksHeight = RAIL_INSET_PX * 2 + layout.nodes.length * TURN_SPACING_PX;
  const preview = layout.nodes.find((node) => node.index === previewIndex);
  const previewMark = previewIndex === null ? -1 : layout.nodes.findIndex((node) => node.index === previewIndex);
  const previewTop = previewMark < 0 ? 0 : markTop(previewMark) - (scrollerRef.current?.scrollTop ?? 0);

  const classes = ["chat-timeline-scroller"];
  if (edges.top) classes.push("is-faded-top");
  if (edges.bottom) classes.push("is-faded-bottom");

  return (
    <nav
      ref={navRef}
      className="chat-timeline"
      style={{ visibility: layout.visible ? "visible" : "hidden" }}
      aria-label={t("conversationTimeline", "Conversation timeline")}
    >
      <div className="chat-timeline-frame" style={{ maxHeight: railMaxHeight }}>
        <div
          ref={scrollerRef}
          className={classes.join(" ")}
          style={{ maxHeight: railMaxHeight }}
          onScroll={updateEdges}
        >
          {historyTruncated && (
            <span
              className="chat-timeline-truncated"
              title={t("timelineLoadedHistory", "Timeline shows loaded history")}
            />
          )}
          <div className="chat-timeline-marks" style={{ height: marksHeight }}>
            {layout.nodes.map((node, nodeIndex) => (
              <button
                key={node.index}
                type="button"
                className="chat-timeline-node"
                data-active={nodeIndex === layout.activeIndex}
                style={{ top: markTop(nodeIndex) }}
                aria-label={`${t("you", "You")}: ${node.prompt}${node.response ? `. Serphia: ${node.response}` : ""}`}
                aria-current={nodeIndex === layout.activeIndex ? "true" : undefined}
                onClick={() => {
                  const scrollEl = scrollContainer.current;
                  if (scrollEl)
                    scrollEl.scrollTo({
                      top: Math.max(0, node.offset - 24),
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                    });
                }}
                onMouseEnter={() => setPreviewIndex(node.index)}
                onMouseLeave={() => setPreviewIndex(null)}
                onFocus={() => setPreviewIndex(node.index)}
                onBlur={() => setPreviewIndex(null)}
              >
                <span />
              </button>
            ))}
          </div>
        </div>
        {preview && (
          <div
            className="chat-timeline-preview"
            role="tooltip"
            style={{ top: `clamp(0px, calc(${previewTop}px - 36px), calc(100% - 72px))` }}
          >
            <span>{preview.prompt || t("you", "You")}</span>
            {preview.response && <p>{preview.response}</p>}
          </div>
        )}
      </div>
    </nav>
  );
}

export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count)
    .fill(null)
    .map((_, i) => refs.current[i] ?? null);
  return refs;
}
