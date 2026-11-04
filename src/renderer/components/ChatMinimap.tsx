import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
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
  ratio: number;
  offset: number;
  message: ChatMinimapMessage;
}

/** A quiet document outline: select a turn, or drag the viewport to scrub. */
export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs, historyTruncated }: Props) {
  const { t } = useI18n();
  const [layout, setLayout] = useState({ nodes: [] as TimelineNode[], top: 0, height: 1, visible: false });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offset: number } | null>(null);
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
        const element = messageRefs.current[index];
        if (!element || !message.hasText) return;
        const offset = element.getBoundingClientRect().top - rect.top + scrollEl.scrollTop;
        nodes.push({ index, offset, ratio: offset / Math.max(total, 1), message });
      });
      setLayout({
        nodes,
        top: scrollEl.scrollTop / Math.max(total, 1),
        height: scrollEl.clientHeight / Math.max(total, 1),
        visible: total > scrollEl.clientHeight + 20,
      });
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
  }, [scrollContainer, messageRefs, allMessages.length]);

  const scrub = useCallback(
    (clientY: number, offset: number) => {
      const scrollEl = scrollContainer.current;
      const track = trackRef.current;
      if (!scrollEl || !track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (clientY - rect.top) / rect.height - offset;
      scrollEl.scrollTop = Math.max(
        0,
        Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, ratio * scrollEl.scrollHeight),
      );
    },
    [scrollContainer],
  );

  const preview = layout.nodes.find((node) => node.index === previewIndex);

  return (
    <nav
      className="chat-timeline"
      style={{ visibility: layout.visible ? "visible" : "hidden" }}
      aria-label={t("conversationTimeline", "Conversation timeline")}
    >
      <div
        ref={trackRef}
        className="chat-timeline-track"
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          const offset =
            ratio >= layout.top && ratio <= layout.top + layout.height ? ratio - layout.top : layout.height / 2;
          dragRef.current = { pointerId: event.pointerId, offset };
          event.currentTarget.setPointerCapture(event.pointerId);
          scrub(event.clientY, offset);
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) scrub(event.clientY, dragRef.current.offset);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {historyTruncated && (
          <span
            className="chat-timeline-truncated"
            title={t("timelineLoadedHistory", "Timeline shows loaded history")}
          />
        )}
        <div
          className="chat-timeline-viewport"
          style={{ top: `${layout.top * 100}%`, height: `${layout.height * 100}%` }}
        />
        {layout.nodes.map((node) => (
          <button
            key={node.index}
            type="button"
            className="chat-timeline-node"
            data-role={node.message.role}
            data-visible={node.ratio >= layout.top && node.ratio < layout.top + layout.height}
            style={{ top: `${node.ratio * 100}%` }}
            aria-label={`${node.message.role === "user" ? t("you", "You") : "Serphia"}: ${node.message.preview}`}
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
        {preview && (
          <div
            className="chat-timeline-preview"
            role="tooltip"
            style={{ top: `clamp(0px, ${preview.ratio * 100}%, calc(100% - 72px))` }}
          >
            <span>{preview.message.role === "user" ? t("you", "You") : "Serphia"}</span>
            <p>{preview.message.preview}</p>
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
