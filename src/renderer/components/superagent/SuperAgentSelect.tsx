// Lucian UX/UI Prompt #031 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#031
import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./SuperAgentSelect.css";

export type SuperAgentOption = { value: string; label: string; icon?: ReactNode; detail?: string };

type Props = {
  label: string;
  value: string;
  options: readonly SuperAgentOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  menuMinWidth?: number;
};

export function SuperAgentSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  compact,
  menuMinWidth,
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const search = useRef({ value: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  const item = options[selected];
  const expanded = open && !disabled && options.length > 0;
  const activeIndex = Math.min(active, options.length - 1);

  useLayoutEffect(() => {
    const button = trigger.current;
    const popup = menu.current;
    if (!expanded || !button || !popup) return;

    const position = () => {
      const bounds = button.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, menuMinWidth ?? (compact ? 220 : 180)), window.innerWidth - 24);
      const below = window.innerHeight - bounds.bottom - 20;
      const above = bounds.top - 20;
      const lift = below < Math.min(popup.scrollHeight + 12, 260) && above > below;
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
      popup.style.maxHeight = `${Math.min(320, Math.max(50, lift ? above : below))}px`;
      popup.style.top = lift ? "auto" : `${bounds.bottom + 7}px`;
      popup.style.bottom = lift ? `${window.innerHeight - bounds.top + 7}px` : "auto";
      popup.dataset.placement = lift ? "top" : "bottom";
    };

    position();
    popup.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(button);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [compact, expanded, menuMinWidth, options.length]);

  useEffect(() => {
    if (!expanded) return;
    const onOutside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const list = menu.current;
    const option = list?.children[activeIndex + 1];
    if (!list || !option) return;
    const popupBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < popupBounds.top) list.scrollTop -= popupBounds.top - optionBounds.top + 5;
    else if (optionBounds.bottom > popupBounds.bottom) list.scrollTop += optionBounds.bottom - popupBounds.bottom + 5;
  }, [activeIndex, expanded]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function show(index: number) {
    setActive(index);
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const down = event.key === "ArrowDown";
        if (!expanded) show(selected < 0 ? (down ? 0 : last) : selected);
        else setActive((index) => Math.max(0, Math.min(last, index + (down ? 1 : -1))));
        return;
      }
      case "Home":
      case "End":
        event.preventDefault();
        show(event.key === "Home" ? 0 : last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (expanded) choose(activeIndex);
        else show(Math.max(0, selected));
        return;
      case "Escape":
        if (expanded) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing)
          return;
        const character = event.key.toLocaleLowerCase();
        const now = Date.now();
        const previous = now - search.current.at < 550 ? search.current.value : "";
        const query = previous === character ? character : previous + character;
        search.current = { value: query, at: now };
        const start = expanded ? activeIndex : selected;
        for (let offset = 1; offset <= options.length; offset++) {
          const index = (start + offset) % options.length;
          if (options[index].label.toLocaleLowerCase().startsWith(query)) {
            event.preventDefault();
            show(index);
            return;
          }
        }
    }
  }

  return (
    <div className={compact ? "ux u031 is-compact" : "ux u031"} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="u031-btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded ? `${id}-${activeIndex}` : undefined}
        data-placeholder={!item || undefined}
        disabled={disabled || !options.length}
        onKeyDown={onKeyDown}
        onClick={() => (expanded ? setOpen(false) : show(Math.max(0, selected)))}
      >
        {item?.icon}
        <span className="u031-v">{item?.label ?? placeholder ?? label}</span>
        <ChevronDown className="u031-car" size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {expanded && (
        <ul
          ref={menu}
          id={id}
          role="listbox"
          aria-label={label}
          popover="manual"
          className="u031-list"
          style={{ "--i": activeIndex } as CSSProperties}
        >
          <li className="u031-hl" role="presentation" aria-hidden="true" />
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={selected === index}
              className="u031-o"
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") setActive(index);
              }}
              onClick={() => choose(index)}
            >
              {option.icon}
              <span className="u031-option-text">
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
              </span>
              <Check className="u031-ck" size={16} strokeWidth={1.5} aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
