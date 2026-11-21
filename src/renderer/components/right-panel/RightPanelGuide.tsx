import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";
import { AnimatedDropdown } from "@/components/sidebar/WorkspaceDropdown";
import { GuideGlass } from "./GuideGlass";
import "./right-panel.css";
import "./right-panel-guide.css";

/** A secondary choice a capsule offers beside its main action (e.g. the shell list). */
export interface RightPanelGuideMenu {
  label: string;
  items: ReadonlyArray<{ id: string; label: string }>;
  selectedId?: string;
  onSelect: (id: string) => void;
}

/** One door out of the guide; picking it opens that panel tab in the guide's place. */
export interface RightPanelGuideEntry {
  id: string;
  title: string;
  description: string;
  artwork: ReactNode;
  menu?: RightPanelGuideMenu;
  disabled?: boolean;
  onPick: () => void;
}

export function RightPanelEntryContent({ entry, described }: { entry: RightPanelGuideEntry; described: boolean }) {
  return (
    <>
      <span className="rp-guide-entry-icon" aria-hidden="true">
        {entry.artwork}
      </span>
      <span className="rp-guide-entry-text">
        <span className="rp-guide-entry-title">{entry.title}</span>
        {described && <span className="rp-guide-entry-description">{entry.description}</span>}
      </span>
      {!entry.menu && <ArrowUpRight className="rp-guide-entry-arrow" size={15} aria-hidden="true" />}
    </>
  );
}

const MENU_WIDTH = 200;

/**
 * Workspace tools sharing one liquid-glass hover and focus surface.
 */
export function RightPanelGuide({
  entries,
  notice,
  visible = true,
}: {
  entries: RightPanelGuideEntry[];
  notice?: string | null;
  visible?: boolean;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const described = entries.length <= 4;
  const menuEntry = visible ? entries.find((entry) => entry.id === openMenu && entry.menu !== undefined) : undefined;

  useEffect(() => {
    if (!visible) setOpenMenu(null);
  }, [visible]);

  useLayoutEffect(() => {
    if (openMenu === null) {
      setPosition(null);
      return;
    }
    const update = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [openMenu]);

  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        triggerRef.current?.focus();
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  if (entries.length === 0) return null;

  return (
    <div className="rp-guide" data-right-panel-guide>
      <div className="rp-guide-content">
        {notice != null && notice !== "" && (
          <div className="rp-guide-notice" role="status">
            {notice}
          </div>
        )}
        <div className="rp-guide-actions">
          <GuideGlass visible={visible} />
          {entries.map((entry) => (
            <div key={entry.id} className="rp-guide-entry" data-right-panel-guide-entry={entry.id}>
              <button
                type="button"
                className="rp-guide-entry-main"
                onClick={entry.onPick}
                disabled={entry.disabled}
                title={entry.description}
              >
                <RightPanelEntryContent entry={entry} described={described} />
              </button>
              {entry.menu !== undefined && (
                <button
                  type="button"
                  ref={entry.id === openMenu ? triggerRef : undefined}
                  className="rp-guide-entry-menu"
                  disabled={entry.disabled}
                  aria-label={entry.menu.label}
                  title={entry.menu.label}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === entry.id}
                  onClick={() => {
                    setOpenMenu((current) => (current === entry.id ? null : entry.id));
                  }}
                >
                  <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {typeof document === "undefined"
        ? null
        : createPortal(
            <AnimatedDropdown
              open={menuEntry !== undefined}
              className="rp-guide-menu"
              transformOrigin="top right"
              style={{
                position: "fixed",
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                width: MENU_WIDTH,
                visibility: position ? "visible" : "hidden",
                zIndex: 1200,
              }}
            >
              <div ref={panelRef} className="rp-guide-menu-panel" role="menu" aria-label={menuEntry?.menu?.label}>
                {menuEntry?.menu?.items.map((item) => {
                  const selected = item.id === menuEntry.menu?.selectedId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`rp-guide-menu-item${selected ? " is-current" : ""}`}
                      onClick={() => {
                        setOpenMenu(null);
                        menuEntry.menu?.onSelect(item.id);
                      }}
                    >
                      <span className="rp-guide-menu-label">{item.label}</span>
                      {selected && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </AnimatedDropdown>,
            document.body,
          )}
    </div>
  );
}
