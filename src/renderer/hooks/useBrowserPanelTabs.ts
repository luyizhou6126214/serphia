import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { subscribe } from "@/lib/api-client";
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

/** Reveal agent tabs and newly announced dev-server previews for the chat on screen. */
export function useAutomaticBrowserPreview(sessionId: string | null, onReveal: (tab: BrowserTabInfo) => void): void {
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;
  const reveal = useEffectEvent((tab: BrowserTabInfo) => {
    if (tab.ownerSessionId && tab.ownerSessionId === currentSession.current) onReveal(tab);
  });

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const offBrowser = window.piBridge.onBrowserEvent((event) => {
      if (event.type !== "tab-created" || event.tab.processPreview || !event.tab.ownerSessionId) return;
      if (event.tab.ownerSessionId !== currentSession.current) return;
      void window.piBridge
        .browserGetSettings()
        .then((settings) => {
          if (!disposed && settings.settings.panel.openOnAgentUse) reveal(event.tab);
        })
        .catch(() => undefined);
    });

    void subscribe("processes.changed", "*", (event) => {
      const preview = event.preview;
      if (disposed || !preview || preview.ownerSessionId !== currentSession.current) return;
      void window.piBridge
        .browserOpenProcessPreview({
          processId: event.processId,
          runId: event.runId,
          endpointId: preview.endpointId,
          automatic: true,
        })
        .then((tab) => {
          if (!disposed && tab) reveal(tab);
        })
        .catch(() => undefined);
    })
      .then((value) => {
        if (disposed) value();
        else unsubscribe = value;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      offBrowser();
      unsubscribe?.();
    };
  }, []);
}
