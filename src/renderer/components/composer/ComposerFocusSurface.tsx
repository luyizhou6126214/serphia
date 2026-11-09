import { useCallback, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from "react";
import { useComposerFocusMotion } from "@/hooks/useComposerFocusMotion";

/**
 * The composer's frame. It owns focus for the whole surface — input, attachments
 * and toolbar — and paints the focus layers: two light ripples that scatter
 * outward on focus, a breathing aurora behind the card and a cool gradient
 * hairline.
 *
 * Focus is tracked here rather than in the input so moving between the textarea
 * and its controls never releases the lit state; only focus that leaves the card
 * (including a portaled menu taking it) does.
 */
export function ComposerFocusSurface({
  cardRef,
  streaming,
  children,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  streaming: boolean;
  children: ReactNode;
}) {
  const auraRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rippleARef = useRef<HTMLDivElement>(null);
  const rippleBRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  useComposerFocusMotion(cardRef, auraRef, ringRef, rippleARef, rippleBRef, focused);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setFocused(false);
  }, []);

  return (
    <div className="chat-composer-frame" data-focused={focused || undefined}>
      <div ref={auraRef} className="chat-composer-aura" aria-hidden="true" />
      <div ref={rippleARef} className="chat-composer-ripple" aria-hidden="true" />
      <div ref={rippleBRef} className="chat-composer-ripple chat-composer-ripple-b" aria-hidden="true" />
      <div
        ref={cardRef}
        className="chat-composer-card"
        data-streaming={streaming}
        data-focused={focused || undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <div ref={ringRef} className="chat-composer-ring" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
