import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n";
import { computeScrollbarThumb, scrollTopFromThumb, thumbTopFromPointer } from "@/lib/chat-scrollbar";

interface Props {
  /** The conversation column the bar is painted over. */
  rootRef: RefObject<HTMLDivElement | null>;
  scrollContainer: RefObject<HTMLDivElement | null>;
  /** The composer dock; the bar runs down to its bottom edge. */
  composerRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
}

interface Geometry {
  top: number;
  height: number;
  thumbHeight: number;
  thumbTop: number;
  maxScroll: number;
}

/**
 * The conversation's thin scrollbar. It sits at the column's far right and runs
 * from the transcript's top to the composer's bottom edge, mirroring and
 * dragging the transcript's own scroll offset.
 */
export function ChatScrollbar({ rootRef, scrollContainer, composerRef, visible }: Props) {
  const { t } = useI18n();
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startThumbTop: number } | null>(null);

  useEffect(() => {
    if (!visible) {
      setGeometry(null);
      return;
    }
    const root = rootRef.current;
    const scroller = scrollContainer.current;
    if (!root || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      const composerRect = composerRef.current?.getBoundingClientRect();
      const top = scrollRect.top - rootRect.top;
      const bottom = composerRect !== undefined ? composerRect.bottom - rootRect.top : rootRect.height;
      const height = Math.max(0, Math.round(bottom - top));
      const thumb = computeScrollbarThumb({
        trackHeight: height,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      });
      if (thumb === null) {
        setGeometry(null);
        return;
      }
      setGeometry((current) => {
        const next: Geometry = { top, height, ...thumb };
        return current !== null &&
          current.top === next.top &&
          current.height === next.height &&
          Math.abs(current.thumbTop - next.thumbTop) < 0.5 &&
          Math.abs(current.thumbHeight - next.thumbHeight) < 0.5
          ? current
          : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    if (composerRef.current) observer.observe(composerRef.current);
    scroller.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
  }, [visible, rootRef, scrollContainer, composerRef]);

  const applyThumbTop = useCallback(
    (thumbTop: number) => {
      const scroller = scrollContainer.current;
      if (!scroller || geometry === null) return;
      scroller.scrollTop = scrollTopFromThumb({
        thumbTop,
        thumbHeight: geometry.thumbHeight,
        trackHeight: geometry.height,
        maxScroll: geometry.maxScroll,
      });
    },
    [scrollContainer, geometry],
  );

  if (!visible || geometry === null) return null;

  return (
    <div
      className="chat-scrollbar"
      role="scrollbar"
      aria-orientation="vertical"
      aria-label={t("conversationScrollbar", "Scroll conversation")}
      aria-valuemin={0}
      aria-valuemax={Math.round(geometry.maxScroll)}
      aria-valuenow={Math.round(
        scrollTopFromThumb({
          thumbTop: geometry.thumbTop,
          thumbHeight: geometry.thumbHeight,
          trackHeight: geometry.height,
          maxScroll: geometry.maxScroll,
        }),
      )}
      style={{ top: geometry.top, height: geometry.height }}
      data-dragging={dragging || undefined}
      onWheel={(event) => {
        scrollContainer.current?.scrollBy({ top: event.deltaY });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const pointerY = event.clientY - event.currentTarget.getBoundingClientRect().top;
        // Grabbing the thumb keeps its offset; grabbing the track centers it.
        const onThumb = pointerY >= geometry.thumbTop - 2 && pointerY <= geometry.thumbTop + geometry.thumbHeight + 2;
        const startThumbTop = onThumb
          ? geometry.thumbTop
          : thumbTopFromPointer({ pointerY, thumbHeight: geometry.thumbHeight, trackHeight: geometry.height });
        applyThumbTop(startThumbTop);
        dragRef.current = { startY: event.clientY, startThumbTop };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        applyThumbTop(drag.startThumbTop + (event.clientY - drag.startY));
      }}
      onPointerUp={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
    >
      <div className="chat-scrollbar-thumb" style={{ height: geometry.thumbHeight, top: geometry.thumbTop }} />
    </div>
  );
}
