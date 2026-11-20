import { useCallback, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from "react";
import { useComposerFocusMotion } from "@/hooks/useComposerFocusMotion";

/**
 * The composer's frame. It owns focus for the whole surface — input, attachments
 * and toolbar — and paints the focus layers: two light ripples that scatter
 * outward on focus, a breathing aurora behind the card around the card.
 *
 * Focus stays engaged across the textarea, toolbar, and menus hosted in the
 * toolbar's shadow roots.
 */
export function ComposerFocusSurface({
  cardRef,
  streaming,
  liftOnFocus,
  children,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  streaming: boolean;
  liftOnFocus?: boolean;
  children: ReactNode;
}) {
  const auraRef = useRef<HTMLDivElement>(null);
  const rippleARef = useRef<HTMLDivElement>(null);
  const rippleBRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  useComposerFocusMotion(cardRef, auraRef, rippleARef, rippleBRef, focused, liftOnFocus);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    let next = event.relatedTarget as Node | null;
    while (next) {
      if (event.currentTarget.contains(next)) return;
      const root = next.getRootNode();
      next = root instanceof ShadowRoot ? root.host : null;
    }
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
        {children}
      </div>
    </div>
  );
}
