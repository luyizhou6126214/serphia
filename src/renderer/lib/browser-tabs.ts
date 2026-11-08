/** Pure browser-tab bookkeeping shared by the Browser panel and the panel strip. */

import type { BrowserEvent, BrowserRendererState, BrowserTabInfo } from "@contract/browser";

/**
 * Apply one Main-published browser event to the renderer's snapshot.
 * @param state - the last known browser state.
 * @param event - the event stream item.
 * @returns the next state; unrelated events leave it unchanged.
 */
export function applyBrowserEvent(state: BrowserRendererState, event: BrowserEvent): BrowserRendererState {
  if (event.type === "tab-created") return { ...state, tabs: [...state.tabs, event.tab] };
  if (event.type === "tab-updated")
    return { ...state, tabs: state.tabs.map((tab) => (tab.id === event.tab.id ? event.tab : tab)) };
  if (event.type === "tab-closed")
    return {
      ...state,
      tabs: state.tabs.filter((tab) => tab.id !== event.tabId),
      activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
    };
  if (event.type === "active-tab-changed") return { ...state, activeTabId: event.tabId };
  if (event.type === "permission-request")
    return {
      ...state,
      permissionRequests: [
        ...state.permissionRequests.filter((request) => request.id !== event.request.id),
        event.request,
      ],
    };
  if (event.type === "permission-resolved")
    return {
      ...state,
      permissionRequests: state.permissionRequests.filter((request) => request.id !== event.requestId),
    };
  if (event.type === "download")
    return {
      ...state,
      downloads: [...state.downloads.filter((download) => download.id !== event.download.id), event.download].slice(
        -100,
      ),
    };
  if (event.type === "policy-changed")
    return {
      ...state,
      capabilities: event.snapshot,
      settings: { ...state.settings, runtime: { ...state.settings.runtime, policyRevision: event.revision } },
    };
  return state;
}

/**
 * The browser tabs one Session may show: its own tabs plus session-neutral ones.
 * Without a Session, only the neutral tabs belong to the new-session draft.
 * @param tabs - every open browser tab.
 * @param sessionId - the Session on screen.
 * @returns the tabs belonging to that Session.
 */
export function browserTabsForSession(tabs: readonly BrowserTabInfo[], sessionId: string | null): BrowserTabInfo[] {
  if (sessionId === null) return tabs.filter((tab) => tab.ownerSessionId === null);
  return tabs.filter((tab) => tab.ownerSessionId === null || tab.ownerSessionId === sessionId);
}

/**
 * A tab's chip label: its document title, else its address.
 * @param tab - one browser tab.
 * @returns the title shown in the strip.
 */
export function browserTabLabel(tab: BrowserTabInfo): string {
  const title = tab.title.trim();
  if (title !== "") return title;
  try {
    const parsed = new URL(tab.url);
    return parsed.host === "" ? tab.url : parsed.host;
  } catch {
    return tab.url;
  }
}
