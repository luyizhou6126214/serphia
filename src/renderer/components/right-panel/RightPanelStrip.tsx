import { useEffect, useRef } from "react";
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

/**
 * The panel's whole top edge: the tab chips, then the two panel controls.
 * A lone guide chip is a quiet label; every other chip offers its close.
 */
export function RightPanelStrip({
  tabs,
  activeTabId,
  fullscreen,
  onSelect,
  onClose,
  onToggleFullscreen,
  onCollapse,
  badgeFor,
}: {
  tabs: RightPanelTab[];
  activeTabId: RightPanelState["activeTabId"];
  fullscreen: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onToggleFullscreen: () => void;
  onCollapse: () => void;
  /** Optional count or attention marker a tab shows after its title. */
  badgeFor?: (tab: RightPanelTab) => string | null;
}) {
  const { t } = useI18n();
  const activeChip = useRef<HTMLDivElement>(null);
  // Many chips scroll: the one in view follows the selection without moving the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const chip = activeChip.current;
    if (chip === null || typeof chip.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    chip.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeTabId]);
  const fullscreenLabel = fullscreen
    ? t("rightPanelExitFullscreen", "Exit fullscreen")
    : t("rightPanelFullscreen", "Fullscreen");
  return (
    <div className="rp-strip">
      <div className="rp-tabs" role="tablist" aria-label={t("rightPanelTabs", "Panel tabs")}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const title = rightPanelTabTitle(tab, t);
          const closable = isClosableRightPanelTab(tab);
          const quiet = tab.kind === "guide" && tabs.length === 1;
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
