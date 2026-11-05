import { useEffect, useRef, useState, useMemo, type RefObject } from "react";
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
  offset: number;
  user: string;
  answer: string;
}

/** A compact, centered outline for navigating the conversation. */
export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs, historyTruncated }: Props) {
  const { t } = useI18n();
  const [layout, setLayout] = useState({ nodes: [] as TimelineNode[], activeIndex: -1, visible: false });
  const [previewState, setPreviewState] = useState<{ index: number; top: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
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
          nodes.push({ index, offset, user: message.preview, answer: "" });
        } else if (message.hasText && nodes.length > 0) {
          nodes[nodes.length - 1].answer = message.preview;
        }
      });
      const currentOffset = scrollEl.scrollTop + Math.min(scrollEl.clientHeight * 0.25, 160);
      const activeIndex = nodes.findLastIndex((node) => node.offset <= currentOffset);
      setLayout({
        nodes,
        activeIndex: Math.max(0, activeIndex),
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
  }, [scrollContainer, messageRefs, allMessages]);

  const preview = layout.nodes.find((node) => node.index === previewState?.index);
  const showPreview = (index: number, element: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;
    const rect = element.getBoundingClientRect();
    setPreviewState({ index, top: rect.top + rect.height / 2 - nav.getBoundingClientRect().top });
  };

  return (
    <nav
      ref={navRef}
      className="chat-timeline"
      style={{ visibility: layout.visible ? "visible" : "hidden" }}
      aria-label={t("conversationTimeline", "Conversation timeline")}
    >
      <div className="chat-timeline-track" onScroll={() => setPreviewState(null)}>
        {historyTruncated && (
          <span
            className="chat-timeline-truncated"
            title={t("timelineLoadedHistory", "Timeline shows loaded history")}
          />
        )}
        {layout.nodes.map((node, nodeIndex) => (
          <button
            key={node.index}
            type="button"
            className="chat-timeline-node"
            data-visible={nodeIndex === layout.activeIndex}
            aria-label={`${t("you", "You")}: ${node.user}${node.answer ? `. Serphia: ${node.answer}` : ""}`}
            onClick={() => {
              const scrollEl = scrollContainer.current;
              if (scrollEl)
                scrollEl.scrollTo({
                  top: Math.max(0, node.offset - 24),
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                });
            }}
            onMouseEnter={(event) => showPreview(node.index, event.currentTarget)}
            onMouseLeave={() => setPreviewState(null)}
            onFocus={(event) => showPreview(node.index, event.currentTarget)}
            onBlur={() => setPreviewState(null)}
          >
            <span />
          </button>
        ))}
      </div>
      {preview && previewState && (
        <div
          className="chat-timeline-preview"
          role="tooltip"
          style={{ top: `clamp(12px, ${previewState.top}px, calc(100% - 12px))` }}
        >
          <span>{preview.user || t("you", "You")}</span>
          {preview.answer && <p>{preview.answer}</p>}
        </div>
      )}
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
