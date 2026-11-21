import { useEffect, useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Maximize2, Minimize2, PanelRightClose, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { PanelTabGlyph } from "./PanelArtwork";
import {
  isClosableRightPanelTab,
  rightPanelTabTitle,
  type RightPanelState,
  type RightPanelTab,
} from "@/lib/right-panel-tabs";
import "./right-panel.css";

gsap.registerPlugin(useGSAP);

const REDUCED_TAB_MOTION = "(prefers-reduced-motion: reduce), (forced-colors: active)";

interface TabSelectionPose {
  center: number;
  width: number;
  scaleY: number;
  taper: number;
  opacity: number;
  halo: number;
}

function measureTab(chip: HTMLDivElement, quiet: boolean): TabSelectionPose {
  return {
    center: chip.offsetLeft + chip.offsetWidth / 2,
    width: quiet ? chip.offsetWidth * 0.5 : chip.offsetWidth,
    scaleY: quiet ? 0.8 : 1,
    taper: 0,
    opacity: quiet ? 0 : 1,
    halo: quiet ? 0 : 0.42,
  };
}

/**
 * The panel's whole top edge: the tab chips, then the two panel controls.
 * A lone guide chip is a quiet label; every other chip offers its close.
 */
export function RightPanelStrip({
  tabs,
  activeTabId,
  fullscreen,
  newTabAction,
  onSelect,
  onClose,
  onToggleFullscreen,
  onCollapse,
  badgeFor,
}: {
  tabs: RightPanelTab[];
  activeTabId: RightPanelState["activeTabId"];
  fullscreen: boolean;
  newTabAction?: ReactNode;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onToggleFullscreen: () => void;
  onCollapse: () => void;
  /** Optional count or attention marker a tab shows after its title. */
  badgeFor?: (tab: RightPanelTab) => string | null;
}) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLSpanElement>(null);
  const activeChip = useRef<HTMLDivElement>(null);
  const previousTab = useRef<{ chip: HTMLDivElement; pose: TabSelectionPose } | null>(null);
  const movingPose = useRef<TabSelectionPose | null>(null);
  const loneGuide = tabs.length === 1 && tabs[0]?.kind === "guide";

  useGSAP(
    () => {
      const chip = activeChip.current;
      const tabTrack = track.current;
      const indicator = selection.current;
      if (!chip || !tabTrack || !indicator || !chip.offsetWidth) return;

      const previous = previousTab.current;
      const target = measureTab(chip, loneGuide);
      const interrupted = movingPose.current;
      previousTab.current = { chip, pose: target };
      movingPose.current = null;
      if (!previous || previous.chip === chip || window.matchMedia(REDUCED_TAB_MOTION).matches) return;

      // Read the live position if the old tab still exists, or its last position after closing it.
      const source = previous.chip.isConnected ? measureTab(previous.chip, previous.pose.opacity === 0) : previous.pose;
      const pose = { ...(interrupted ?? source) };
      const distance = target.center - pose.center;
      const direction = Math.sign(distance);
      const stretch = Math.min(36, Math.abs(distance) * 0.24);
      const overshoot = direction * Math.min(4, Math.abs(distance) * 0.06);

      const paint = () => {
        movingPose.current = { ...pose };
        indicator.style.transform = `translate3d(${pose.center - pose.width / 2}px, 0, 0) scale(${pose.width / 100}, ${pose.scaleY})`;
        const leftRadius = 10 - pose.taper;
        const rightRadius = 10 + pose.taper;
        indicator.style.borderRadius = `${leftRadius}% ${rightRadius}% ${rightRadius}% ${leftRadius}% / 35%`;
        indicator.style.opacity = String(pose.opacity);
        indicator.style.setProperty("--rp-tab-selection-halo", String(pose.halo));
      };
      const clear = () => {
        delete tabTrack.dataset.selectionMoving;
        indicator.style.removeProperty("transform");
        indicator.style.removeProperty("border-radius");
        indicator.style.removeProperty("opacity");
        indicator.style.removeProperty("--rp-tab-selection-halo");
      };

      paint();
      tabTrack.dataset.selectionMoving = "";
      gsap
        .timeline({
          onUpdate: paint,
          onComplete: () => {
            movingPose.current = null;
            clear();
          },
        })
        .to(pose, { center: target.center + overshoot, duration: 0.28, ease: "power2.inOut" }, 0)
        .to(
          pose,
          {
            width: Math.max(pose.width, Math.max(source.width, target.width) + stretch),
            scaleY: 0.76,
            taper: direction * 5,
            opacity: 1,
            halo: 0.32,
            duration: 0.16,
            ease: "sine.out",
          },
          0,
        )
        .to(
          pose,
          {
            width: target.width * 0.93,
            scaleY: target.scaleY * 1.08,
            taper: direction * -2,
            opacity: target.opacity,
            halo: loneGuide ? 0 : 0.95,
            duration: 0.12,
            ease: "sine.inOut",
          },
          0.16,
        )
        .to(pose, { ...target, duration: 0.25, ease: "elastic.out(1, 0.64)" }, 0.28);

      return clear;
    },
    { scope: track, dependencies: [activeTabId, loneGuide], revertOnUpdate: true },
  );

  // Many chips scroll: the one in view follows the selection without moving the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const chip = activeChip.current;
    if (chip === null || typeof chip.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia(REDUCED_TAB_MOTION).matches;
    chip.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeTabId]);
  const fullscreenLabel = fullscreen
    ? t("rightPanelExitFullscreen", "Exit fullscreen")
    : t("rightPanelFullscreen", "Fullscreen");
  return (
    <div className="rp-strip">
      <div className="rp-tabs" role="tablist" aria-label={t("rightPanelTabs", "Panel tabs")}>
        <div ref={track} className="rp-tab-track">
          <span className="rp-tab-selection-layer" aria-hidden="true">
            <span ref={selection} className="rp-tab-selection" />
          </span>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const title = rightPanelTabTitle(tab, t);
            const closable = isClosableRightPanelTab(tab);
            const quiet = loneGuide;
            return (
              <div
                key={tab.id}
                ref={active ? activeChip : undefined}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                className={`rp-tab${active ? " is-active" : ""}${quiet ? " is-quiet" : ""}`}
                title={title}
                data-closable={closable || undefined}
                onClick={() => {
                  onSelect(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(tab.id);
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1 || !closable) return;
                  event.preventDefault();
                  onClose(tab.id);
                }}
              >
                <span className="rp-tab-glyph" aria-hidden="true">
                  <PanelTabGlyph tab={tab} />
                </span>
                <span className="rp-tab-title">{title}</span>
                {(() => {
                  const badge = badgeFor?.(tab) ?? null;
                  return badge === null ? null : (
                    <span className={`rp-tab-badge${badge === "!" ? " is-attention" : ""}`}>{badge}</span>
                  );
                })()}
                {closable && (
                  <button
                    type="button"
                    className="rp-tab-close"
                    aria-label={t("rightPanelCloseTab", "Close {title}").replace("{title}", title)}
                    title={t("rightPanelCloseTab", "Close {title}").replace("{title}", title)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                  >
                    <X size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {newTabAction}
      <div className="rp-strip-fill" />
      <div className="rp-strip-controls">
        <button
          type="button"
          className="rp-icon-button"
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <Minimize2 size={15} strokeWidth={1.7} aria-hidden="true" />
          ) : (
            <Maximize2 size={15} strokeWidth={1.7} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="rp-icon-button"
          aria-label={t("rightPanelCollapseAria", "Collapse right sidebar")}
          title={t("rightPanelCollapse", "Collapse sidebar")}
          onClick={onCollapse}
        >
          <PanelRightClose size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
