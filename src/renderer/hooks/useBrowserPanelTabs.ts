import { useCallback, useEffect, useMemo, useState } from "react";
import { applyBrowserEvent, browserTabsForSession } from "@/lib/browser-tabs";
import type { BrowserRendererState, BrowserTabInfo } from "@contract/browser";

const NO_TABS: BrowserTabInfo[] = [];

/**
 * Subscribe to the Main-owned browser tabs for one Session, so the panel strip
 * can mirror them as tabs without mounting the Browser body.
 * @param sessionId - the Session on screen; without one there are no tabs.
 * @returns the Session's browser tabs, Main's active tab, and a manual refresh.
 */
export function useBrowserPanelTabs(sessionId: string | null): {
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<BrowserRendererState | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await window.piBridge.browserGetState());
    } catch {
      // A disabled or unavailable Browser service simply has no tabs.
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.piBridge.onBrowserEvent((event) => {
      setState((current) => (current === null ? current : applyBrowserEvent(current, event)));
    });
  }, [refresh]);

  // Stable identity, so a strip sync effect only runs when membership changes.
  const tabs = useMemo(
    () => (state === null ? NO_TABS : browserTabsForSession(state.tabs, sessionId)),
    [sessionId, state],
  );

  return { tabs, activeTabId: state?.activeTabId ?? null, refresh };
}
