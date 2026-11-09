import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useI18n } from "@/i18n";
import "./SessionViewTabs.css";

gsap.registerPlugin(useGSAP);

export type SessionView = "chat" | "trajectory" | "context";

interface Props {
  value: SessionView;
  onChange: (view: SessionView) => void;
}

interface TabRect {
  x: number;
  width: number;
}

const TABS: ReadonlyArray<{ id: SessionView; labelKey: string; fallback: string; panelId: string }> = [
  { id: "chat", labelKey: "sessionViewChat", fallback: "Chat", panelId: "session-view-chat" },
  { id: "trajectory", labelKey: "sessionViewTrajectory", fallback: "Trajectory", panelId: "session-view-trajectory" },
  { id: "context", labelKey: "sessionViewContext", fallback: "Context", panelId: "session-view-context" },
];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Text tabs under the session title: one continuous surface, no divider above
 * the row, and a single accent line that glides between labels. GSAP owns the
 * motion; the stylesheet owns the ink, the hairline and the accent gradient.
 */
export function SessionViewTabs({ value, onChange }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const haloRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const rectRef = useRef<TabRect | null>(null);
  const entranceDoneRef = useRef(false);
  const firstSelectionRef = useRef(true);

  const measure = useCallback((view: SessionView): TabRect | null => {
    const index = TABS.findIndex((entry) => entry.id === view);
    const button = index >= 0 ? buttonRefs.current[index] : null;
    const label = index >= 0 ? labelRefs.current[index] : null;
    // The button is the label's positioned offset parent, so this measures the
    // text itself rather than the click target.
    return button && label ? { x: button.offsetLeft + label.offsetLeft, width: label.offsetWidth } : null;
  }, []);

  // The entrance owns the first placement so the selection effect never
  // animates on mount; its cleanup restores that state for StrictMode.
  useGSAP(
    () => {
      const root = rootRef.current;
      const indicator = indicatorRef.current;
      const halo = haloRef.current;
      const initial = measure(valueRef.current);
      if (!root || !indicator || !halo || !initial) return;
      entranceDoneRef.current = true;
      rectRef.current = initial;
      gsap.set(indicator, { ...initial, autoAlpha: 1, scaleX: 1, scaleY: 1 });
      gsap.set(halo, { ...initial, autoAlpha: 0, scaleY: 1 });
      const cleanup = () => {
        entranceDoneRef.current = false;
        firstSelectionRef.current = true;
      };
      if (prefersReducedMotion()) {
        gsap.set(
          labelRefs.current.filter((label): label is HTMLSpanElement => label !== null),
          { autoAlpha: 1, y: 0 },
        );
        return cleanup;
      }
      const labels = labelRefs.current.filter((label): label is HTMLSpanElement => label !== null);
      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .fromTo(
          indicator,
          { scaleX: 0.35, autoAlpha: 0 },
          { scaleX: 1, autoAlpha: 1, duration: 0.5, ease: "expo.out" },
          0,
        )
        .fromTo(labels, { autoAlpha: 0, y: 4 }, { autoAlpha: 1, y: 0, duration: 0.38, stagger: 0.045 }, 0.04);
      return cleanup;
    },
    { scope: rootRef },
  );

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const halo = haloRef.current;
    const position = measure(value);
    if (!indicator || !position) return;
    if (!entranceDoneRef.current) return;
    if (firstSelectionRef.current) {
      firstSelectionRef.current = false;
      rectRef.current = position;
      gsap.set(indicator, { ...position, autoAlpha: 1 });
      gsap.set(halo, { ...position, autoAlpha: 0 });
      return;
    }
    const previous = rectRef.current ?? position;
    rectRef.current = position;
    if (prefersReducedMotion()) {
      gsap.set(indicator, position);
      gsap.set(halo, { ...position, autoAlpha: 0 });
      return;
    }
    const activeIndex = TABS.findIndex((entry) => entry.id === value);
    const activeLabel = labelRefs.current[activeIndex];
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline.to(indicator, { ...position, duration: 0.46, ease: "expo.out", overwrite: "auto" }, 0);
    timeline.fromTo(
      indicator,
      { scaleY: 1.55 },
      { scaleY: 1, duration: 0.55, ease: "elastic.out(1, 0.55)", overwrite: "auto" },
      0,
    );
    if (halo) {
      timeline.fromTo(
        halo,
        { ...previous, autoAlpha: 0.34, scaleY: 1.7 },
        { ...position, autoAlpha: 0, scaleY: 1, duration: 0.5, ease: "power2.out", overwrite: "auto" },
        0,
      );
    }
    if (activeLabel) {
      timeline.fromTo(activeLabel, { y: 1.5 }, { y: 0, duration: 0.4, ease: "power2.out", overwrite: "auto" }, 0);
    }
  }, [measure, value]);

  // Localization, fonts and window width can all change label metrics after the
  // line has settled; snap it rather than animating from a stale width.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const snap = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const position = measure(valueRef.current);
        if (!position) return;
        rectRef.current = position;
        gsap.set(indicatorRef.current, position);
        gsap.set(haloRef.current, { ...position, autoAlpha: 0 });
      });
    };
    const observer = new ResizeObserver(snap);
    observer.observe(root);
    for (let index = 0; index < TABS.length; index += 1) {
      const button = buttonRefs.current[index];
      const label = labelRefs.current[index];
      if (button) observer.observe(button);
      if (label) observer.observe(label);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure]);

  const select = (next: SessionView) => {
    if (next === value) return;
    onChange(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | null = null;
    if (event.key === "ArrowRight") target = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = TABS.length - 1;
    if (target === null) return;
    event.preventDefault();
    buttonRefs.current[target]?.focus();
    select(TABS[target].id);
  };

  return (
    <div ref={rootRef} className="session-view-tabs" role="tablist" aria-label={t("sessionViews", "Session views")}>
      <span ref={haloRef} className="session-view-tabs-halo" aria-hidden="true" />
      <span ref={indicatorRef} className="session-view-tabs-indicator" aria-hidden="true" />
      {TABS.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`session-view-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={selected ? 0 : -1}
            className="session-view-tab"
            onClick={() => select(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span
              ref={(node) => {
                labelRefs.current[index] = node;
              }}
              className="session-view-tab-label"
            >
              {t(tab.labelKey, tab.fallback)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
