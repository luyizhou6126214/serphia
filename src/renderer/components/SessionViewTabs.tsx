import { useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Layers3, MessageSquare, Route, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import "./SessionViewTabs.css";

gsap.registerPlugin(useGSAP);

export type SessionView = "chat" | "trajectory" | "context";

interface Props {
  value: SessionView;
  onChange: (view: SessionView) => void;
}

const TABS: ReadonlyArray<{ id: SessionView; Icon: LucideIcon }> = [
  { id: "chat", Icon: MessageSquare },
  { id: "trajectory", Icon: Route },
  { id: "context", Icon: Layers3 },
];

// Red bends the backdrop horizontally and green bends it vertically. The flat
// center stays clear while the curved edge samples pixels closer to the center.
const REFRACTION_MAP = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="x">
        <stop stop-color="#ef0000"/>
        <stop offset=".28" stop-color="#800000"/>
        <stop offset=".72" stop-color="#800000"/>
        <stop offset="1" stop-color="#110000"/>
      </linearGradient>
      <linearGradient id="y" x2="0" y2="1">
        <stop stop-color="#00ef00"/>
        <stop offset=".28" stop-color="#008000"/>
        <stop offset=".72" stop-color="#008000"/>
        <stop offset="1" stop-color="#001100"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#x)"/>
    <rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>
  </svg>
`)}`;

export function SessionViewTabs({ value, onChange }: Props) {
  const { t } = useI18n();
  const refractionId = useId();
  const labels = {
    chat: t("sessionViewChat", "Chat"),
    trajectory: t("sessionViewTrajectory", "Trajectory"),
    context: t("sessionViewContext", "Context"),
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const motionRef = useRef<gsap.core.Timeline | null>(null);
  const lensRef = useRef({ top: 0, bottom: 0, taper: 0 });
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = TABS.findIndex(({ id }) => id === value);
  const previousIndexRef = useRef(selectedIndex);

  useGSAP(
    () => {
      const indicator = indicatorRef.current;
      const activeButton = buttonRefs.current[selectedIndex];
      if (!indicator || !activeButton?.offsetHeight) return;

      const target = activeButton.offsetTop - indicator.offsetTop;
      const size = activeButton.offsetHeight;
      const lens = lensRef.current;
      const changed = selectedIndex !== previousIndexRef.current;
      previousIndexRef.current = selectedIndex;

      const paintLens = () => {
        const center = (lens.top + lens.bottom) / 2;
        const stretch = Math.max(0, Math.min((lens.bottom - lens.top) / size, 0.94));
        indicator.style.transform = `translate3d(0, ${center}px, 0) scale(${1 - stretch * 0.19}, ${1 + stretch})`;
        indicator.style.setProperty("--session-lens-curve", `${6 * stretch}px`);
        indicator.style.setProperty("--session-lens-taper", `${8 * stretch * lens.taper}px`);
      };

      // Keep the current pose when another tab is selected mid-flight.
      motionRef.current?.kill();
      const instant = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)").matches;
      if (!changed || instant) {
        lens.top = target;
        lens.bottom = target;
        lens.taper = 0;
        paintLens();
        return;
      }

      const delta = target - (lens.top + lens.bottom) / 2;
      const direction = delta >= 0 ? 1 : -1;
      const leading = direction > 0 ? "bottom" : "top";
      const trailing = direction > 0 ? "top" : "bottom";
      const duration = 0.33 + Math.min(Math.abs(delta), 78) * 0.0008;

      motionRef.current = gsap
        .timeline({ onUpdate: paintLens })
        .to(lens, { [leading]: target, duration, ease: "power2.inOut" }, 0)
        .to(lens, { [trailing]: target, duration: duration + 0.055, ease: "power2.inOut" }, 0.055)
        .to(lens, { taper: direction, duration: 0.13, ease: "sine.inOut" }, 0);
    },
    { scope: rootRef, dependencies: [selectedIndex] },
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        target = (index + 1) % TABS.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        target = (index - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttonRefs.current[target]?.focus();
    onChange(TABS[target].id);
  };

  return (
    <div
      ref={rootRef}
      className="session-view-tabs"
      role="tablist"
      aria-label={t("sessionViews", "Session views")}
      aria-orientation="vertical"
    >
      <svg className="absolute" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={refractionId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={REFRACTION_MAP} preserveAspectRatio="none" result="surface" />
          <feDisplacementMap in="SourceGraphic" in2="surface" scale={11} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <span
        ref={indicatorRef}
        className="session-view-tabs-indicator"
        style={{ "--session-lens-filter": `url("#${refractionId}")` } as CSSProperties}
        aria-hidden="true"
      />
      {TABS.map(({ id, Icon }, index) => {
        const selected = id === value;
        const label = labels[id];
        return (
          <button
            key={id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`session-view-tab-${id}`}
            aria-label={label}
            aria-selected={selected}
            aria-controls={`session-view-${id}`}
            tabIndex={selected ? 0 : -1}
            className="session-view-tab"
            data-tooltip={label}
            onClick={() => onChange(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
