import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { ReferenceText } from "./ReferenceText";
import { HerdrComposerSurface } from "./HerdrComposerSurface";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  canSend: boolean;
  canInterrupt: boolean;
  working: boolean;
  agent: string;
  state: string;
  hint?: string;
}

export function HerdrChatInput({
  value,
  onChange,
  onSend,
  onInterrupt,
  canSend,
  canInterrupt,
  working,
  agent,
  state,
  hint,
}: Props) {
  const { t } = useI18n();
  const card = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastCompositionEnd = useRef(-Infinity);
  const placeholder = t("hdReply", "Reply to this agent");
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    const height = element.scrollHeight;
    element.style.height = `${Math.min(height, 200)}px`;
    element.style.overflowY = height > 200 ? "auto" : "hidden";
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    const justComposed = performance.now() - lastCompositionEnd.current < 100;
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!justComposed && !event.repeat && canSend && value.trim()) onSend();
  }
  const stop = working && !value.trim();
  return (
    <form
      className="hd-compose"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend && value.trim()) onSend();
      }}
    >
      <HerdrComposerSurface cardRef={card} streaming={working}>
        <div className="chat-composer-shell">
          <div className="chat-composer-editor" style={{ fontSize: scaledChatFont(14) }}>
            <div ref={mirror} className="chat-composer-reference-mirror" aria-hidden="true">
              <ReferenceText text={value} requireTerminator />
              {"\n"}
            </div>
            <textarea
              ref={textarea}
              rows={1}
              spellCheck={false}
              value={value}
              placeholder={placeholder}
              aria-label={placeholder}
              style={{ color: value ? "transparent" : "var(--text)", caretColor: "var(--text)" }}
              onChange={(e) => onChange(e.currentTarget.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                lastCompositionEnd.current = performance.now();
              }}
              onScroll={(e) => {
                if (mirror.current) {
                  mirror.current.scrollTop = e.currentTarget.scrollTop;
                  mirror.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className="hd-compose-foot">
          <span>
            <i className="hd-dot" data-state={state} />
            {agent}
          </span>
          {hint && <small role="status">{hint}</small>}
          {stop ? (
            <button
              type="button"
              className="hd-send"
              disabled={!canInterrupt}
              aria-label={t("hdInterrupt", "Interrupt agent")}
              title={t("hdInterrupt", "Interrupt agent")}
              onClick={onInterrupt}
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              type="submit"
              className="hd-send"
              disabled={!value.trim() || !canSend}
              aria-label={t("hdSend", "Send reply")}
              title={hint || t("hdSend", "Send reply")}
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </HerdrComposerSurface>
    </form>
  );
}
