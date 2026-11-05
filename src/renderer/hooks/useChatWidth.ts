import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clearChatWidthPreference,
  draggedChatWidth,
  readChatWidthPreference,
  writeChatWidthPreference,
} from "@/lib/chat-width";

export interface ChatWidthGeometry {
  left: number;
  right: number;
  width: number;
  rootWidth: number;
}

interface DragState {
  side: "left" | "right";
  origin: number;
  base: number;
  latest: number;
  moved: boolean;
  pointerId: number;
}

function findColumn(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".chat-message-scroll .chat-content-column") ??
    root.querySelector<HTMLElement>(".chat-welcome .chat-content-column") ??
    root.querySelector<HTMLElement>(".chat-input-transition-dock .chat-content-column") ??
    root.querySelector<HTMLElement>(".chat-content-column")
  );
}

/**
 * Persistent, pointer-driven width axis shared by the transcript and composer.
 * The width is written as `--chat-content-max-width` on the ChatWindow root so
 * both `.chat-content-column` instances follow one preference.
 */
export function useChatWidth(rootRef: RefObject<HTMLDivElement | null>, visible: boolean) {
  const [customWidth, setCustomWidth] = useState<number | null>(() => readChatWidthPreference());
  const [geometry, setGeometry] = useState<ChatWidthGeometry | null>(null);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const column = root ? findColumn(root) : null;
    if (!root || !column) return;
    const rootRect = root.getBoundingClientRect();
    const rect = column.getBoundingClientRect();
    setGeometry({
      left: rect.left - rootRect.left,
      right: rect.right - rootRect.left,
      width: rect.width,
      rootWidth: root.clientWidth,
    });
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (customWidth === null) root.style.removeProperty("--chat-content-max-width");
    else root.style.setProperty("--chat-content-max-width", `min(${customWidth}px, calc(100% - 32px))`);
    measure();
  }, [customWidth, measure, rootRef]);

  useEffect(() => {
    if (!visible) {
      setGeometry(null);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const column = findColumn(root);
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, [measure, rootRef, visible]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !geometry) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        side,
        origin: event.clientX,
        base: geometry.width,
        latest: event.clientX,
        moved: false,
        pointerId: event.pointerId,
      };
      setDragging(side);
    },
    [geometry],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      drag.latest = event.clientX;
      if (event.clientX !== drag.origin) drag.moved = true;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const current = dragRef.current;
        const root = rootRef.current;
        if (!current || !root) return;
        setCustomWidth(draggedChatWidth(current.base, current.latest - current.origin, current.side, root.clientWidth));
      });
    },
    [rootRef],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragging(null);
      cancelFrame();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const root = rootRef.current;
      if (cancelled || !drag.moved || !root) {
        setCustomWidth(readChatWidthPreference());
        return;
      }
      const width = draggedChatWidth(drag.base, event.clientX - drag.origin, drag.side, root.clientWidth);
      setCustomWidth(width);
      writeChatWidthPreference(width);
    },
    [cancelFrame, rootRef],
  );

  const reset = useCallback(() => {
    clearChatWidthPreference();
    setCustomWidth(null);
  }, []);

  return {
    customWidth,
    geometry,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finishDrag(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finishDrag(event, true),
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => finishDrag(event, true),
    reset,
  };
}
