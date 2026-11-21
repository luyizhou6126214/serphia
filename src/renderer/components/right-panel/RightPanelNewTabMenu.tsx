import { useCallback } from "react";
import { Menu } from "deep-agent-base-ui/menu";
import { Check, ChevronRight, Plus } from "lucide-react";
import { useI18n } from "@/i18n";
import { RightPanelEntryContent, type RightPanelGuideEntry, type RightPanelGuideMenu } from "./RightPanelGuide";

function ShellMenu({ menu, disabled }: { menu: RightPanelGuideMenu; disabled?: boolean }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className="rp-guide-entry-menu" aria-label={menu.label} disabled={disabled}>
        <ChevronRight size={13} aria-hidden="true" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="rp-new-tab-menu-positioner" sideOffset={6} collisionPadding={8}>
          <Menu.Popup className="rp-guide-actions rp-new-tab-popup rp-new-tab-shell-popup" aria-label={menu.label}>
            {menu.items.map((item) => (
              <Menu.Item
                key={item.id}
                className={`rp-guide-menu-item${item.id === menu.selectedId ? " is-current" : ""}`}
                aria-current={item.id === menu.selectedId || undefined}
                onClick={() => menu.onSelect(item.id)}
              >
                <span className="rp-guide-menu-label">{item.label}</span>
                {item.id === menu.selectedId && <Check size={14} aria-hidden="true" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

export function RightPanelNewTabMenu({
  entries,
  open,
  onOpenChange,
  onPresenceChange,
}: {
  entries: readonly RightPanelGuideEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPresenceChange: (present: boolean) => void;
}) {
  const { t } = useI18n();
  const label = t("rightPanelNewTab", "New panel tab");
  const reportPopup = useCallback(
    (element: HTMLDivElement | null) => onPresenceChange(element !== null),
    [onPresenceChange],
  );

  return (
    <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Menu.Trigger className="rp-icon-button rp-new-tab-button" aria-label={label} title={label}>
        <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="rp-new-tab-menu-positioner" align="start" sideOffset={6} collisionPadding={8}>
          <Menu.Popup ref={reportPopup} className="rp-guide-actions rp-new-tab-popup" aria-label={label}>
            {entries.map((entry) => (
              <div key={entry.id} className="rp-guide-entry" role="presentation">
                <Menu.Item
                  className="rp-guide-entry-main rp-new-tab-item"
                  disabled={entry.disabled}
                  label={entry.title}
                  aria-label={entry.title}
                  title={entry.description}
                  onClick={entry.onPick}
                >
                  <RightPanelEntryContent entry={entry} described={entries.length <= 4} />
                </Menu.Item>
                {entry.menu && <ShellMenu menu={entry.menu} disabled={entry.disabled} />}
              </div>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
