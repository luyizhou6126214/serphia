/**
 * The right panel's tab model: one guide tab that cannot close, plus every
 * files, file, terminal, browser, and managed-process panel the user opened.
 * The reducer keeps at least the guide tab and always leaves an active tab, so
 * the strip never renders empty and the panel body always has an owner.
 */

export type RightPanelTabKind = "guide" | "files" | "file" | "terminal" | "browser" | "processes";

export interface RightPanelTab {
  id: string;
  kind: RightPanelTabKind;
  /** Captured chip title; page kinds without a resource derive theirs from copy. */
  title: string;
  /** File tabs: absolute path the viewer reads. */
  filePath?: string;
  sourceSessionId?: string | null;
  reviewLocation?: { cwd: string; line: number | null };
  /** Terminal tabs: the Host pty session this screen draws. */
  terminalId?: string;
  /** Browser tabs: Main-owned browser tab shown by the bound dock. */
  browserTabId?: string;
}

export interface RightPanelState {
  tabs: RightPanelTab[];
  activeTabId: string;
}

export type RightPanelAction =
  | { type: "open"; tab: RightPanelTab }
  | { type: "select"; tabId: string }
  | { type: "close"; tabId: string }
  | { type: "title"; tabId: string; title: string }
  | { type: "reset" };

/** The guide is the panel's home tab: always present, never closable. */
export const GUIDE_TAB_ID = "panel:guide";
export const FILES_TAB_ID = "panel:files";
export const PROCESSES_TAB_ID = "panel:processes";

/** Chip title for the panel's fixed pages; resource tabs carry their own. */
export type RightPanelTranslator = (key: string, fallback: string) => string;

/**
 * Build the guide tab.
 * @returns the tab the panel opens on and returns to when nothing else is open.
 */
export function guideTab(): RightPanelTab {
  return { id: GUIDE_TAB_ID, kind: "guide", title: "" };
}

/**
 * Build a panel's initial state.
 * @returns the guide tab alone, active.
 */
export function createRightPanelState(): RightPanelState {
  return { tabs: [guideTab()], activeTabId: GUIDE_TAB_ID };
}

/** File tab id for one path, so reopening a file focuses its existing tab. */
export function fileTabId(filePath: string): string {
  return `file:${filePath}`;
}

/** Terminal tab id for one Host pty session. */
export function terminalTabId(sessionId: string): string {
  return `terminal:${sessionId}`;
}

/** Browser tab id for one Main-owned browser tab. */
export function browserTabId(tabId: string): string {
  return `browser:${tabId}`;
}

/**
 * The active tab; the guide stands in for a state that somehow lost its id.
 * @param state - the panel state.
 * @returns the active tab, never undefined.
 */
export function activeRightPanelTab(state: RightPanelState): RightPanelTab {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? guideTab();
}

/**
 * The width preference a tab's body wants, matching the panel's saved widths.
 * @param tab - the active tab.
 * @returns the width kind; file previews read at the files width.
 */
export function rightPanelWidthKind(tab: RightPanelTab): "files" | "browser" | "processes" | "terminal" {
  switch (tab.kind) {
    case "browser":
      return "browser";
    case "terminal":
      return "terminal";
    case "processes":
      return "processes";
    default:
      return "files";
  }
}

/**
 * Chip label for a tab.
 * @param tab - the tab to label.
 * @param t - active dictionary lookup.
 * @returns the localized page label, or the captured resource title.
 */
export function rightPanelTabTitle(tab: RightPanelTab, t: RightPanelTranslator): string {
  switch (tab.kind) {
    case "guide":
      return t("rightPanelStart", "Start");
    case "files":
      return t("rightPanelFiles", "Files");
    case "processes":
      return t("rightPanelProcesses", "Managed processes");
    default:
      return tab.title;
  }
}

/** Whether a tab shows a close control; the guide never does. */
export function isClosableRightPanelTab(tab: RightPanelTab): boolean {
  return tab.kind !== "guide";
}

/** Activate a tab id, if it exists. */
function select(state: RightPanelState, tabId: string): RightPanelState {
  return state.tabs.some((tab) => tab.id === tabId) && state.activeTabId !== tabId
    ? { ...state, activeTabId: tabId }
    : state;
}

/**
 * Reduce one panel action.
 * @param state - current tabs and selection.
 * @param action - the intent.
 * @returns the next state; unchanged when the action would change nothing.
 */
export function reduceRightPanelState(state: RightPanelState, action: RightPanelAction): RightPanelState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.find((tab) => tab.id === action.tab.id);
      if (existing === undefined) {
        return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.id };
      }
      const tabs = state.tabs.map((tab) => (tab.id === action.tab.id ? { ...tab, ...action.tab } : tab));
      return { tabs, activeTabId: action.tab.id };
    }
    case "select":
      return select(state, action.tabId);
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      const tab = state.tabs[index];
      if (tab === undefined || !isClosableRightPanelTab(tab)) return state;
      const tabs = state.tabs.filter((candidate) => candidate.id !== action.tabId);
      if (state.activeTabId !== action.tabId) return { ...state, tabs };
      const neighbour = tabs[Math.max(0, index - 1)] ?? tabs[0];
      return { tabs, activeTabId: neighbour?.id ?? GUIDE_TAB_ID };
    }
    case "title": {
      const tab = state.tabs.find((candidate) => candidate.id === action.tabId);
      if (tab === undefined || tab.title === action.title) return state;
      return {
        ...state,
        tabs: state.tabs.map((candidate) =>
          candidate.id === action.tabId ? { ...candidate, title: action.title } : candidate,
        ),
      };
    }
    case "reset":
      return createRightPanelState();
    default:
      return state;
  }
}
