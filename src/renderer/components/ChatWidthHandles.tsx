import { useI18n } from "@/i18n";
import { useChatWidth } from "@/hooks/useChatWidth";
import { CHAT_WIDTH_HANDLE_GAP } from "@/lib/chat-width";
import type { MouseEvent, PointerEvent, RefObject, WheelEvent } from "react";
import "./ChatWidthHandles.css";

interface Props {
  rootRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  top: number;
}

/** Invisible drag strips at both edges of the centered chat content column. */
export function ChatWidthHandles({ rootRef, visible, top }: Props) {
  const { t } = useI18n();
  const {
    geometry,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    reset,
  } = useChatWidth(rootRef, visible);
  if (!visible || !geometry) return null;
  const label = t("chatWidthHandle", "Drag to resize the conversation and composer. Double-click to reset.");
  const updatePointerY = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--chat-width-handle-y", `${event.clientY - rect.top}px`);
  };
  const handleProps = (side: "left" | "right") => ({
    className: "chat-width-handle",
    "data-side": side,
    "data-dragging": dragging === side ? "true" : undefined,
    role: "separator",
    "aria-orientation": "vertical" as const,
    "aria-label": label,
    title: label,
    style: {
      top,
      left:
        side === "left"
          ? Math.max(0, geometry.left - CHAT_WIDTH_HANDLE_GAP - 10)
          : Math.min(Math.max(0, geometry.rootWidth - 10), geometry.right + CHAT_WIDTH_HANDLE_GAP),
    },
    onPointerEnter: updatePointerY,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      updatePointerY(event);
      onPointerDown(side, event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      updatePointerY(event);
      onPointerMove(event);
    },
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onDoubleClick: (event: MouseEvent) => {
      event.preventDefault();
      reset();
    },
    onWheel: (event: WheelEvent<HTMLDivElement>) => {
      if (event.ctrlKey) return;
      rootRef.current?.querySelector<HTMLElement>(".chat-message-scroll")?.scrollBy({ top: event.deltaY });
    },
  });
  return (
    <>
      <div {...handleProps("left")} />
      <div {...handleProps("right")} />
    </>
  );
}
