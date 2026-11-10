import { useSidebarWorkspace } from "@/hooks/useSidebarWorkspace";
import { Moon, PanelLeft, PanelRight, Sun } from "lucide-react";
import { ArrowLeftOutlined, ArrowRightOutlined, HomeFilled, SettingOutlined } from "@ant-design/icons/es";
import {
  initialRightPanelPreferredWidth,
  persistRightPanelPreferredWidth,
  loadBrowserPanelPreferredWidth,
} from "@/lib/panel-preferences";
import { useSessionList } from "@/hooks/useSessionList";
import { recordNavigation } from "@/lib/navigation-history";
import { call, subscribe } from "@/lib/api-client";
import {
  useState,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { SessionInfoPanel } from "./SessionInfoPanel";
import { SessionPresentationStore } from "@/lib/session-presentation-store";
import { FileViewer } from "./FileViewer";
import type { SettingsTab } from "./SettingsConfig";
import { preloadSettingsConfig, scheduleSettingsConfigPreload, SettingsConfig, TerminalPanel } from "./DeferredPanels";
import { useMcpSettingsRequests } from "../hooks/useMcpSettingsRequests";
import { QuickChannelBinding } from "./channels/QuickChannelBinding";
import { OpenInAppButton } from "./OpenInAppButton";
import { BrowserDock } from "./browser/BrowserDock";
import { BrowserAuthorizationDialog } from "./browser/BrowserAuthorizationDialog";
import { ProcessPanel } from "./ProcessPanel";
import { SessionBackgroundTasks } from "./SessionBackgroundTasks";
import { RightPanelStrip } from "./right-panel/RightPanelStrip";
import { RightPanelGuide, type RightPanelGuideEntry } from "./right-panel/RightPanelGuide";
import { FilesPanelBody } from "./right-panel/FilesPanelBody";
import {
  GuideArtworkBrowser,
  GuideArtworkFiles,
  GuideArtworkTerminal,
  GuideArtworkTools,
} from "./right-panel/PanelArtwork";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { getFileName } from "@/lib/file-paths";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { formatNumber } from "@/lib/locale-format";
import { beginSessionLoadTrace } from "@/lib/session-performance";
import {
  FILES_TAB_ID,
  PROCESSES_TAB_ID,
  activeRightPanelTab,
  browserTabId as panelBrowserTabId,
  createRightPanelState,
  fileTabId,
  reduceRightPanelState,
  rightPanelWidthKind,
  terminalTabId,
  type RightPanelTab,
} from "@/lib/right-panel-tabs";
import { readSessionIdFromSearch, routerCompat } from "@/lib/router-compat";
import { SessionProfiler } from "./SessionProfiler";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { ThinkingExpansionRegistry } from "@/lib/thinking-expansion-store";
import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
  getKeyboardAdjustedRightPanelWidth,
  getRightPanelWidthBounds,
  shouldCollapseSidebarForRightPanel,
  type RightPanelResizeKey,
} from "@/lib/layout-preferences";
import type { SessionInfo } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { ChatAppearancePreferences } from "@shared/chat-appearance";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { BrowserAgentAuthorizationRequest, BrowserAgentAuthorizationDecision } from "../../contract/browser";
import { browserTabLabel } from "@/lib/browser-tabs";
import { isManagedProcessActiveState } from "@contract/processes";
import { QuickHerdrFleet } from "./herdr/QuickHerdrFleet";
import { useBrowserPanelTabs } from "@/hooks/useBrowserPanelTabs";
import { readTerminalShellChoice, selectTerminalShell, writeTerminalShellChoice } from "@/lib/terminal-shells";
import type { TerminalShellInfo } from "@contract/terminal";

const TERMINAL_PANEL_RATIO = 0.55;
type NavigationView = { session: SessionInfo | null; draftCwd: string | null; settings: boolean };
const sameNavigationView = (a: NavigationView, b: NavigationView) =>
  a.settings === b.settings && a.session?.id === b.session?.id && a.draftCwd === b.draftCwd;

const EMPTY_CHANNELS: ChannelsSnapshot = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };

/** One error's message, for the guide's inline notices. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AppShell({
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
}: {
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
}) {
  const router = routerCompat;
  const { isDark, toggleTheme } = useTheme();
  const { language, t } = useI18n();
  const sessionList = useSessionList();
  const { sessions: workspaceSessions, projectInfoRevision } = useSyncExternalStore(
    sessionList.subscribe,
    sessionList.getSnapshot,
    sessionList.getSnapshot,
  );
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [presentationStore] = useState(() => new SessionPresentationStore());
  const presentation = useSyncExternalStore(
    presentationStore.subscribe,
    presentationStore.getSnapshot,
    presentationStore.getSnapshot,
  );
  const displayedSession =
    presentation?.sessionId === selectedSession?.id ? (presentation?.info ?? selectedSession) : selectedSession;

  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [worktreesRefreshKey, setWorktreesRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTransitionRef = useRef<((action: () => void) => void) | null>(null);
  const registerSettingsTransition = useCallback((handler: ((action: () => void) => void) | null) => {
    settingsTransitionRef.current = handler;
  }, []);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("general");
  const [settingsNavigationRequestId, setSettingsNavigationRequestId] = useState(0);
  const [authorizationSettingsSessionId, setAuthorizationSettingsSessionId] = useState<string | null>(null);
  useMcpSettingsRequests(
    setSettingsOpen,
    setSettingsInitialTab,
    setAuthorizationSettingsSessionId,
    setSettingsNavigationRequestId,
  );
  const [browserAuthorization, setBrowserAuthorization] = useState<BrowserAgentAuthorizationRequest | null>(null);
  const [channelSnapshot, setChannelSnapshot] = useState<ChannelsSnapshot>(EMPTY_CHANNELS);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);

  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  // Warm the deferred Settings chunk once the UI is idle so the first open does not wait on it.
  useEffect(() => scheduleSettingsConfigPreload(), []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const thinkingExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());
  const processDetailsExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());

  const refreshChannelSnapshot = useCallback(async () => {
    try {
      setChannelSnapshot(await call("channels.list"));
    } catch {
      // Channels are optional; the rest of the desktop remains usable if Host is still starting.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    void refreshChannelSnapshot();
    void Promise.all([
      subscribe("channels.binding", "*", () => void refreshChannelSnapshot()),
      subscribe("channels.status", "*", () => void refreshChannelSnapshot()),
    ])
      .then((items) => {
        if (disposed) items.forEach((unsubscribe) => unsubscribe());
        else unsubs.push(...items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [refreshChannelSnapshot]);

  const [activeTopPanel, setActiveTopPanel] = useState<"session" | null>(null);

  const toggleTopPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => (cur === "session" ? null : "session"));
  }, [isMobile]);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  // Right panel — one strip over every panel kind, with the guide as its home tab.
  const [rightPanel, dispatchRightPanel] = useReducer(reduceRightPanelState, undefined, createRightPanelState);
  const activePanelTab = activeRightPanelTab(rightPanel);
  const panelWidthKind = rightPanelWidthKind(activePanelTab);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelFullscreen, setRightPanelFullscreen] = useState(false);
  const [guideNotice, setGuideNotice] = useState<string | null>(null);
  const [rightPanelBounds, setRightPanelBounds] = useState(() =>
    getRightPanelWidthBounds(window.innerWidth, sidebarOpen),
  );
  const rightPanelPreferredWidthRef = useRef(RIGHT_PANEL_DEFAULT_WIDTH);
  const rightPanelKindRef = useRef<"files" | "browser" | "processes" | "terminal">("files");
  const [managedProcessCount, setManagedProcessCount] = useState(0);
  const [managedProcessAttention, setManagedProcessAttention] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const preferredWidth = initialRightPanelPreferredWidth();
    rightPanelPreferredWidthRef.current = preferredWidth;
    return clampRightPanelWidth(preferredWidth, window.innerWidth, sidebarOpen);
  });
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const rightPanelMaxRatio = panelWidthKind === "terminal" ? TERMINAL_PANEL_RATIO : undefined;
  const browserPanelTabs = useBrowserPanelTabs(selectedSession?.id ?? null);
  // Shells the Host discovered, plus the remembered choice a new terminal uses.
  const [terminalShells, setTerminalShells] = useState<readonly TerminalShellInfo[]>([]);
  const [terminalChoice, setTerminalChoice] = useState<string | null>(() => readTerminalShellChoice());
  const preferredShell = selectTerminalShell(terminalShells, terminalChoice);
  useEffect(() => {
    let cancelled = false;
    void window.piBridge
      .listTerminals()
      .then((snapshot) => {
        if (!cancelled) setTerminalShells(snapshot.shells);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const refreshCount = () => {
      void call("processes.list", { includeExited: true })
        .then((snapshot) => {
          if (!disposed) {
            setManagedProcessCount(
              snapshot.processes.filter((process) => isManagedProcessActiveState(process.state)).length,
            );
            setManagedProcessAttention(
              snapshot.processes.some(
                (process) => process.state === "failed" || process.state === "lost" || process.exit?.code,
              ),
            );
          }
        })
        .catch(() => undefined);
    };
    refreshCount();
    void subscribe("processes.changed", "*", (event) => {
      refreshCount();
      if (event.reason === "created" && event.activateUi) {
        if (isMobile) setSidebarOpen(false);
        dispatchRightPanel({ type: "open", tab: { id: PROCESSES_TAB_ID, kind: "processes", title: "" } });
        setRightPanelOpen(true);
      }
    }).then((value) => {
      if (disposed) value();
      else unsubscribe = value;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [isMobile]);

  const handleRightPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobile || event.button !== 0) return;
      event.preventDefault();
      rightPanelResizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = rightPanelWidth;
      let finalWidth = startWidth;
      let didResize = false;

      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.clientX !== startX) didResize = true;
        finalWidth = clampRightPanelWidth(
          startWidth + startX - moveEvent.clientX,
          window.innerWidth,
          sidebarOpen,
          rightPanelMaxRatio,
        );
        setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen, rightPanelMaxRatio));
        setRightPanelWidth(finalWidth);
      };
      const cleanup = (commit: boolean) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setRightPanelResizing(false);
        rightPanelResizeCleanupRef.current = null;
        if (commit && didResize && finalWidth >= RIGHT_PANEL_MIN_WIDTH) {
          rightPanelPreferredWidthRef.current = finalWidth;
          persistRightPanelPreferredWidth(finalWidth, panelWidthKind === "browser");
        }
      };
      const handlePointerUp = () => cleanup(true);
      const handlePointerCancel = () => cleanup(false);

      rightPanelResizeCleanupRef.current = () => cleanup(false);
      setRightPanelResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    },
    [isMobile, panelWidthKind, rightPanelMaxRatio, rightPanelWidth, sidebarOpen],
  );

  useEffect(() => () => rightPanelResizeCleanupRef.current?.(), []);

  useEffect(() => {
    if (isMobile) return;
    const nextKind = panelWidthKind;
    if (rightPanelKindRef.current === nextKind) return;
    persistRightPanelPreferredWidth(rightPanelPreferredWidthRef.current, rightPanelKindRef.current === "browser");
    rightPanelKindRef.current = nextKind;
    const preferred =
      nextKind === "browser"
        ? loadBrowserPanelPreferredWidth()
        : nextKind === "terminal"
          ? Math.max(520, initialRightPanelPreferredWidth())
          : initialRightPanelPreferredWidth();
    rightPanelPreferredWidthRef.current = preferred;
    const maxRatio = nextKind === "terminal" ? TERMINAL_PANEL_RATIO : undefined;
    setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen, maxRatio));
    setRightPanelWidth(clampRightPanelWidth(preferred, window.innerWidth, sidebarOpen, maxRatio));
  }, [isMobile, panelWidthKind, sidebarOpen]);

  useEffect(() => {
    if (isMobile) return;
    const fitToWindow = () => {
      const bounds = getRightPanelWidthBounds(window.innerWidth, sidebarOpen, rightPanelMaxRatio);
      setRightPanelBounds(bounds);
      setRightPanelWidth(
        clampRightPanelWidth(rightPanelPreferredWidthRef.current, window.innerWidth, sidebarOpen, rightPanelMaxRatio),
      );
    };
    fitToWindow();
    window.addEventListener("resize", fitToWindow);
    return () => window.removeEventListener("resize", fitToWindow);
  }, [isMobile, rightPanelMaxRatio, sidebarOpen]);

  const openRightPanel = useCallback(() => {
    const closeSidebar = isMobile || shouldCollapseSidebarForRightPanel(window.innerWidth);
    const nextSidebarOpen = closeSidebar ? false : sidebarOpen;
    if (closeSidebar) setSidebarOpen(false);
    if (!isMobile) {
      setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, nextSidebarOpen, rightPanelMaxRatio));
      setRightPanelWidth(
        clampRightPanelWidth(
          rightPanelPreferredWidthRef.current,
          window.innerWidth,
          nextSidebarOpen,
          rightPanelMaxRatio,
        ),
      );
    }
    setRightPanelOpen(true);
  }, [isMobile, rightPanelMaxRatio, sidebarOpen]);

  const handleRightPanelToggle = useCallback(() => {
    if (rightPanelOpen) setRightPanelOpen(false);
    else openRightPanel();
  }, [openRightPanel, rightPanelOpen]);

  const toggleRightPanelFullscreen = useCallback(() => {
    setRightPanelFullscreen((fullscreen) => !fullscreen);
  }, []);

  // A closed panel never keeps the fullscreen presentation for the next open.
  useEffect(() => {
    if (!rightPanelOpen) setRightPanelFullscreen(false);
  }, [rightPanelOpen]);

  // Mirror the Session's Main-owned browser tabs as panel tabs: one chip per
  // browser tab, and a chip disappears with the tab it binds.
  useEffect(() => {
    const known = new Set(rightPanel.tabs.flatMap((tab) => (tab.kind === "browser" ? [tab.browserTabId] : [])));
    for (const tab of browserPanelTabs.tabs) {
      const id = panelBrowserTabId(tab.id);
      const title = browserTabLabel(tab);
      if (!known.has(tab.id)) {
        dispatchRightPanel({
          type: "open",
          tab: { id, kind: "browser", title, browserTabId: tab.id },
        });
      } else {
        dispatchRightPanel({ type: "title", tabId: id, title });
      }
    }
    const open = new Set(browserPanelTabs.tabs.map((tab) => tab.id));
    for (const tab of rightPanel.tabs) {
      if (tab.kind === "browser" && tab.browserTabId !== undefined && !open.has(tab.browserTabId)) {
        dispatchRightPanel({ type: "close", tabId: tab.id });
      }
    }
  }, [browserPanelTabs.tabs, rightPanel.tabs]);

  useEffect(() => {
    const openBrowserTab = (event: Event) => {
      const tabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId;
      if (tabId) {
        dispatchRightPanel({
          type: "open",
          tab: { id: panelBrowserTabId(tabId), kind: "browser", title: t("browser", "Browser"), browserTabId: tabId },
        });
      }
      openRightPanel();
      if (tabId) void window.piBridge.browserActivateTab(tabId).catch(() => undefined);
    };
    window.addEventListener("pi-desktop:open-browser-tab", openBrowserTab);
    return () => window.removeEventListener("pi-desktop:open-browser-tab", openBrowserTab);
  }, [openRightPanel, t]);

  useEffect(
    () =>
      window.piBridge.onBrowserEvent((event) => {
        if (event.type !== "tab-created" || !event.tab.ownerSessionId) return;
        void window.piBridge.browserGetSettings().then((settings) => {
          if (!settings.settings.panel.openOnAgentUse) return;
          dispatchRightPanel({
            type: "open",
            tab: {
              id: panelBrowserTabId(event.tab.id),
              kind: "browser",
              title: browserTabLabel(event.tab),
              browserTabId: event.tab.id,
            },
          });
          openRightPanel();
        });
      }),
    [openRightPanel],
  );

  useEffect(
    () =>
      window.piBridge.onBrowserEvent((event) => {
        if (event.type === "agent-authorization-request") {
          setBrowserAuthorization(event.request);
          void window.piBridge.browserSetSurfaceVisible({ visible: false }).catch(() => undefined);
        } else if (event.type === "agent-authorization-resolved") {
          setBrowserAuthorization((current) => (current?.id === event.requestId ? null : current));
          setAuthorizationSettingsSessionId(null);
        }
      }),
    [],
  );

  const respondToBrowserAuthorization = useCallback(
    (decision: BrowserAgentAuthorizationDecision) => {
      const requestId = browserAuthorization?.id;
      if (!requestId) return;
      void window.piBridge
        .browserRespondAgentAuthorization(requestId, decision)
        .catch(() => undefined)
        .finally(() => setBrowserAuthorization((current) => (current?.id === requestId ? null : current)));
    },
    [browserAuthorization?.id],
  );

  const handleRightPanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        isMobile ||
        !(["ArrowLeft", "ArrowRight", "Home", "End"] as const).includes(event.key as RightPanelResizeKey)
      ) {
        return;
      }
      event.preventDefault();
      const nextWidth = getKeyboardAdjustedRightPanelWidth(
        rightPanelWidth,
        event.key as RightPanelResizeKey,
        window.innerWidth,
        sidebarOpen,
        event.shiftKey,
        rightPanelMaxRatio,
      );
      setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen, rightPanelMaxRatio));
      setRightPanelWidth(nextWidth);
      if (nextWidth >= RIGHT_PANEL_MIN_WIDTH) {
        rightPanelPreferredWidthRef.current = nextWidth;
        persistRightPanelPreferredWidth(nextWidth, panelWidthKind === "browser");
      }
    },
    [isMobile, panelWidthKind, rightPanelMaxRatio, rightPanelWidth, sidebarOpen],
  );

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const [initialSessionId] = useState<string | null>(() => readSessionIdFromSearch(window.location.search));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [defaultSessionError, setDefaultSessionError] = useState<string | null>(null);
  const [defaultSessionRetry, setDefaultSessionRetry] = useState(0);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  const [navigationHistory, setNavigationHistory] = useState(() => ({
    entries: [{ session: null, draftCwd: null, settings: false }] as NavigationView[],
    index: 0,
  }));
  const navigatingToRef = useRef<NavigationView | null>(null);
  const replaceHistoryEntryRef = useRef(Boolean(initialSessionId));
  const initializedDefaultSessionRef = useRef(false);
  useEffect(() => {
    if (!initialSessionRestored || selectedSession || newSessionCwd || initializedDefaultSessionRef.current) return;
    let cancelled = false;
    setDefaultSessionError(null);
    void call("system.home")
      .then(async ({ home }) => {
        if (!home) throw new Error("Home directory is unavailable");
        const result = await call("system.validateCwd", { path: home });
        if (!result.ok) throw new Error(result.error ?? "Home directory is unavailable");
        if (cancelled) return;
        initializedDefaultSessionRef.current = true;
        replaceHistoryEntryRef.current = true;
        setNewSessionCwd(result.path ?? home);
      })
      .catch(() => {
        if (!cancelled)
          setDefaultSessionError(
            t("defaultSessionDirectoryFailed", "Could not prepare the default session directory."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [initialSessionRestored, selectedSession, newSessionCwd, defaultSessionRetry, t]);

  useEffect(() => {
    const view: NavigationView = { session: selectedSession, draftCwd: newSessionCwd, settings: settingsOpen };
    if (navigatingToRef.current) {
      if (sameNavigationView(view, navigatingToRef.current)) navigatingToRef.current = null;
      return;
    }
    const replace = replaceHistoryEntryRef.current;
    replaceHistoryEntryRef.current = false;
    setNavigationHistory((history) => recordNavigation(history, view, sameNavigationView, replace));
  }, [selectedSession, newSessionCwd, settingsOpen]);

  const navigateHistory = useCallback(
    (direction: -1 | 1) => {
      const index = navigationHistory.index + direction;
      const target = navigationHistory.entries[index];
      if (!target) return;
      const apply = () => {
        navigatingToRef.current = target;
        setNavigationHistory((history) => ({ ...history, index }));
        const sessionChanged = selectedSession?.id !== target.session?.id || newSessionCwd !== target.draftCwd;
        if (sessionChanged) {
          if (target.session && target.session.cwd !== activeCwd) suppressCwdBumpRef.current = true;
          setSelectedSession(target.session);
          setNewSessionCwd(target.draftCwd);
          setActiveCwd(target.session?.cwd ?? target.draftCwd);
          setSessionKey((key) => key + 1);
          setActiveTopPanel(null);
          router.replace(target.session ? `?session=${encodeURIComponent(target.session.id)}` : "/", { scroll: false });
        }
        setSettingsOpen(target.settings);
      };
      if (settingsOpen && settingsTransitionRef.current) settingsTransitionRef.current(apply);
      else apply();
    },
    [navigationHistory, selectedSession, newSessionCwd, settingsOpen, activeCwd, router],
  );

  // Deep link + menu actions from Electron main
  useEffect(() => {
    const offDeep = window.piBridge?.onDeepLinkSession?.((sessionId) => {
      void (async () => {
        try {
          const sessions = await sessionList.refresh();
          const found = sessions.find((s) => s.id === sessionId);
          if (found) {
            setNewSessionCwd(null);
            setSelectedSession(found as SessionInfo);
            setSessionKey((k) => k + 1);
            router.replace(`?session=${encodeURIComponent(sessionId)}`);
          }
        } catch (error) {
          console.error("deep link open failed", error);
        }
      })();
    });
    const offNew = window.piBridge?.onMenu?.("new-session", () => {
      if (activeCwd) {
        setSelectedSession(null);
        setNewSessionCwd(activeCwd);
        setSessionKey((k) => k + 1);
      }
    });
    const offSettings = window.piBridge?.onMenu?.("settings", () => {
      setSettingsInitialTab("general");
      setSettingsNavigationRequestId((id) => id + 1);
      setSettingsOpen(true);
    });
    const offCheckForUpdates = window.piBridge?.onMenu?.("check-for-updates", () => {
      setSettingsInitialTab("about");
      setSettingsNavigationRequestId((id) => id + 1);
      setSettingsOpen(true);
      void window.piBridge.checkForUpdates().catch(() => undefined);
    });
    const offShowUpdate = window.piBridge?.onMenu?.("show-update", () => {
      setSettingsInitialTab("about");
      setSettingsNavigationRequestId((id) => id + 1);
      setSettingsOpen(true);
    });
    // ISSUE-016: Switch Session palette — focus sidebar / open project list
    const offSwitch = window.piBridge?.onMenu?.("switch-session", () => {
      setSidebarOpen(true);
      void sessionList.refresh().catch(() => {});
      setWorktreesRefreshKey((k) => k + 1);
    });
    return () => {
      offDeep?.();
      offNew?.();
      offSettings?.();
      offCheckForUpdates?.();
      offShowUpdate?.();
      offSwitch?.();
    };
  }, [activeCwd, router, sessionList]);

  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null) => {
      setActiveCwd(cwd);
      // Skip if cwd is null (initial mount) or during the initial URL restore.
      if (!cwd) return;
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }
      // Worktrees of one repo share a project root. Moving the effective cwd
      // within the same project (e.g. switching worktree, or clicking a session
      // that lives in another worktree) must not close the open session.
      // Path strings may differ in separators/casing depending on their source
      // (session file vs git output), so compare with worktreePathsEqual.
      if (newSessionCwd !== null && worktreePathsEqual(newSessionCwd, cwd)) return;
      const newProject = projectRoot ?? cwd;
      if (selectedSession && worktreePathsEqual(selectedSession.projectRoot ?? selectedSession.cwd, newProject)) {
        return;
      }
      // Close any session that belongs to a different project — it no longer
      // matches the selected project directory.
      setSelectedSession(null);
      setNewSessionCwd((prev) => {
        if (prev !== null && prev !== cwd) return null;
        return prev;
      });
      setSessionKey((k) => k + 1);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    },
    [router, selectedSession, newSessionCwd],
  );

  const workspace = useSidebarWorkspace({
    allSessions: workspaceSessions,
    selectedCwd: selectedSession?.cwd ?? newSessionCwd ?? null,
    onCwdChange: handleCwdChange,
    worktreesRefreshKey,
    projectInfoRevision,
  });

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false) => {
      beginSessionLoadTrace(session.id, isRestore ? "restore" : "selection");
      setActiveCwd(session.cwd);
      setNewSessionCwd(null);
      setSelectedSession(session);
      setSessionKey((k) => k + 1);
      setInitialSessionRestored(true);
      // On mobile, collapse the overlay drawer so the chat is revealed after pick.
      if (isMobile && !isRestore) setSidebarOpen(false);
      if (isRestore) {
        replaceHistoryEntryRef.current = true;
        // Suppress the redundant sessionKey bump that would come from the
        // onCwdChange effect firing after setSelectedCwd in the sidebar
        suppressCwdBumpRef.current = true;
      }
      // Skip router.replace when restoring from URL — the param is already correct
      // and replacing it during the initial desktop restore causes a remount loop
      if (!isRestore) {
        router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
      }
    },
    [router, isMobile],
  );

  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      setActiveCwd(cwd);
      setSelectedSession(null);
      setNewSessionCwd(cwd);
      setSessionKey((k) => k + 1);
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      router.replace("/", { scroll: false });
    },
    [router, isMobile],
  );

  const hydrateSelectedSession = useCallback(
    (sessionId: string) => {
      void sessionList
        .findSession(sessionId)
        .then((full) => {
          if (!full) return;
          setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
        })
        .catch(() => {});
    },
    [sessionList],
  );

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      replaceHistoryEntryRef.current = true;
      setNewSessionCwd(null);
      setSelectedSession(session);
      sessionList.ensureIndexed(session.id);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession, sessionList],
  );

  const handleAgentEnd = useCallback(() => {
    if (selectedSession?.id) sessionList.ensureIndexed(selectedSession.id);
    sessionList.refreshIfDisconnected();
    setWorktreesRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, [sessionList, selectedSession?.id]);

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      setSessionKey((k) => k + 1);
      setNewSessionCwd(null);
      setSelectedSession((prev) => ({
        ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
        id: newSessionId,
      }));
      hydrateSelectedSession(newSessionId);
      router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      thinkingExpansionRegistryRef.current.delete(sessionId);
      processDetailsExpansionRegistryRef.current.delete(sessionId);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        setSelectedSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        setActiveTopPanel(null);
        router.replace("/", { scroll: false });
      }
    },
    [selectedSession, router],
  );

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;

  const explorerCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
  const workspaceCwd = explorerCwd ?? null;

  const showRightPanelTab = useCallback(
    (tab: RightPanelTab) => {
      dispatchRightPanel({ type: "open", tab });
      setGuideNotice(null);
      openRightPanel();
    },
    [openRightPanel],
  );

  const closeRightPanelTab = useCallback(
    (tabId: string) => {
      const tab = rightPanel.tabs.find((candidate) => candidate.id === tabId);
      // Closing a browser chip closes the browser tab it stands for.
      if (tab?.kind === "browser" && tab.browserTabId !== undefined) {
        void window.piBridge.browserCloseTab(tab.browserTabId).catch(() => undefined);
      }
      // Closing a terminal chip ends the pty it draws.
      if (tab?.kind === "terminal" && tab.terminalId !== undefined) {
        void window.piBridge.closeTerminal(tab.terminalId).catch(() => undefined);
      }
      dispatchRightPanel({ type: "close", tabId });
    },
    [rightPanel.tabs],
  );

  const handleOpenFile = useCallback(
    (filePath: string, fileName: string, sourceSessionId?: string | null) => {
      showRightPanelTab({
        id: fileTabId(filePath),
        kind: "file",
        title: fileName,
        filePath,
        sourceSessionId,
      });
    },
    [showRightPanelTab],
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string) => {
      handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
    },
    [handleOpenFile, selectedSession?.id],
  );

  const openFilesTab = useCallback(() => {
    showRightPanelTab({ id: FILES_TAB_ID, kind: "files", title: "" });
  }, [showRightPanelTab]);

  const openProcessesTab = useCallback(() => {
    showRightPanelTab({ id: PROCESSES_TAB_ID, kind: "processes", title: "" });
  }, [showRightPanelTab]);

  const startTerminalTab = useCallback(
    async (shellId?: string) => {
      if (workspaceCwd === null) {
        setGuideNotice(t("rightPanelNoWorkspace", "Select a project or Session first."));
        return;
      }
      const shell = shellId ?? preferredShell?.id;
      try {
        const terminal = await window.piBridge.createTerminal({
          ...(shell === undefined ? {} : { shellId: shell }),
          cwd: workspaceCwd,
          cols: 80,
          rows: 24,
        });
        if (shell !== undefined && shell !== terminalChoice) {
          setTerminalChoice(shell);
          writeTerminalShellChoice(shell);
        }
        showRightPanelTab({
          id: terminalTabId(terminal.id),
          kind: "terminal",
          title: terminal.title || t("rightPanelNewTerminal", "New terminal"),
          terminalId: terminal.id,
        });
      } catch (error) {
        setGuideNotice(
          t("rightPanelTerminalFailed", "Could not start a terminal: {message}").replace("{message}", messageOf(error)),
        );
      }
    },
    [preferredShell?.id, showRightPanelTab, t, terminalChoice, workspaceCwd],
  );

  const startBrowserTab = useCallback(async () => {
    if (selectedSession === null && workspaceCwd === null) {
      setGuideNotice(t("rightPanelNoWorkspace", "Select a project or Session first."));
      return;
    }
    try {
      const state = await window.piBridge.browserGetState();
      if (!state.settings.settings.enabled) {
        setGuideNotice(t("browserDisabled", "Built-in Browser is disabled."));
        return;
      }
      const tab = await window.piBridge.browserCreateUserTab({
        profileId: state.settings.settings.panel.defaultProfileId,
        ownerSessionId: selectedSession?.id ?? null,
        activate: true,
      });
      showRightPanelTab({
        id: panelBrowserTabId(tab.id),
        kind: "browser",
        title: browserTabLabel(tab),
        browserTabId: tab.id,
      });
    } catch (error) {
      setGuideNotice(messageOf(error));
    }
  }, [selectedSession, showRightPanelTab, t, workspaceCwd]);

  // The guide's keycaps and the panel's global bindings share one modifier label.
  const modifierKey = window.piBridge?.platform === "darwin" ? "⌘" : "Ctrl";
  const guideEntries: RightPanelGuideEntry[] = [
    {
      id: "workspace-files",
      title: t("rightPanelWorkspaceFiles", "Workspace files"),
      description: t("rightPanelWorkspaceFilesHint", "Browse the Session workspace files"),
      artwork: <GuideArtworkFiles size={26} />,
      shortcut: [modifierKey, "P"],
      onPick: openFilesTab,
    },
    {
      id: "new-terminal",
      title: t("rightPanelNewTerminal", "New terminal"),
      description: t("rightPanelNewTerminalHint", "Run commands in the Session workspace"),
      artwork: <GuideArtworkTerminal size={26} />,
      shortcut: [modifierKey, "Shift", "T"],
      ...(terminalShells.length > 1
        ? {
            menu: {
              label: t("rightPanelTerminalShell", "Choose shell"),
              items: terminalShells.map((shell) => ({ id: shell.id, label: shell.label })),
              ...(preferredShell === undefined ? {} : { selectedId: preferredShell.id }),
              onSelect: (shellId: string) => {
                void startTerminalTab(shellId);
              },
            },
          }
        : {}),
      onPick: () => {
        void startTerminalTab();
      },
    },
    {
      id: "browser",
      title: t("browser", "Browser"),
      description: t("rightPanelBrowserHint", "Browse the web"),
      artwork: <GuideArtworkBrowser size={26} />,
      shortcut: [modifierKey, "T"],
      onPick: () => {
        void startBrowserTab();
      },
    },
    {
      id: "more-tools",
      title: t("rightPanelMoreTools", "More tools"),
      description: t("rightPanelMoreToolsHint", "Managed processes and background tasks"),
      artwork: <GuideArtworkTools size={26} />,
      onPick: openProcessesTab,
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (settingsOpen || browserAuthorization !== null) return;
      const key = event.key.toLowerCase();
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        openFilesTab();
      } else if (key === "t" && event.shiftKey) {
        event.preventDefault();
        void startTerminalTab();
      } else if (key === "t") {
        event.preventDefault();
        void startBrowserTab();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [browserAuthorization, openFilesTab, settingsOpen, startBrowserTab, startTerminalTab]);

  const openSidebarSettings = (tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setSettingsNavigationRequestId((id) => id + 1);
    setSettingsOpen(true);
  };
  const leaveSettingsFor = (action: () => void) => {
    const navigate = () => {
      setSettingsOpen(false);
      action();
    };
    if (settingsOpen && settingsTransitionRef.current) settingsTransitionRef.current(navigate);
    else navigate();
  };
  const sidebarRail = (
    <div className="sidebar-rail" aria-label={t("navigation", "Navigation")}>
      <div className="sidebar-rail-top">
        <button
          type="button"
          className={`sidebar-rail-button${!settingsOpen ? " is-active" : ""}`}
          title={t("sessions", "Sessions")}
          aria-label={t("sessions", "Sessions")}
          onClick={() =>
            leaveSettingsFor(() => {
              setRightPanelOpen(false);
              setActiveTopPanel(null);
            })
          }
        >
          <HomeFilled />
        </button>
      </div>
      <button
        type="button"
        className={`sidebar-rail-button${settingsOpen ? " is-active" : ""}`}
        onClick={() => openSidebarSettings("general")}
        onFocus={() => {
          void preloadSettingsConfig().catch(() => undefined);
        }}
        title={t("settings", "Settings")}
        aria-label={t("settings", "Settings")}
      >
        <SettingOutlined />
      </button>
    </div>
  );
  const sidebarContent = (
    <SessionSidebar
      selectedSessionId={selectedSession?.id ?? null}
      onSelectSession={handleSelectSession}
      onNewSession={handleNewSession}
      initialSessionId={initialSessionId}
      onInitialRestoreDone={handleInitialRestoreDone}
      sessionList={sessionList}
      onSessionDeleted={handleSessionDeleted}
      workspace={workspace}
    />
  );

  const isWindows = window.piBridge?.platform === "win32";
  const isMac = window.piBridge?.platform === "darwin";
  const sessionHeader = (
    <>
      <div
        className="app-topbar-title"
        role="heading"
        aria-level={1}
        title={
          settingsOpen
            ? t("settings", "Settings")
            : selectedSession
              ? getSessionDisplayTitle(displayedSession ?? selectedSession, 240)
              : ""
        }
      >
        {settingsOpen
          ? t("settings", "Settings")
          : selectedSession
            ? getSessionDisplayTitle(displayedSession ?? selectedSession)
            : ""}
      </div>
      {!settingsOpen && selectedSession && (
        <SessionBackgroundTasks key={selectedSession.id} sessionId={selectedSession.id} />
      )}
      {!settingsOpen && (
        <>
          {selectedSession && (
            <QuickChannelBinding
              sessionId={selectedSession.id}
              snapshot={channelSnapshot}
              isMobile={isMobile}
              onSnapshotChange={setChannelSnapshot}
            />
          )}
          {showChat && <QuickHerdrFleet isMobile={isMobile} alignRight={!selectedSession} />}
          <SessionInfoPanel
            store={presentationStore}
            showChat={showChat}
            activeTopPanel={activeTopPanel}
            toggleTopPanel={toggleTopPanel}
            isMobile={isMobile}
            panelContainerRef={chatContentRef}
          />
          <OpenInAppButton directory={selectedSession?.cwd ?? effectiveNewSessionCwd ?? null} />
          <button
            type="button"
            className="app-topbar-button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            title={isDark ? t("switchToLight", "Switch to light mode") : t("switchToDark", "Switch to dark mode")}
            aria-label={isDark ? t("switchToLight", "Switch to light mode") : t("switchToDark", "Switch to dark mode")}
            aria-pressed={isDark}
          >
            {isDark ? (
              <Sun size={17} strokeWidth={1.7} aria-hidden="true" />
            ) : (
              <Moon size={17} strokeWidth={1.7} aria-hidden="true" />
            )}
          </button>
          <span className="app-topbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="app-topbar-button app-topbar-panel-toggle"
            onClick={handleRightPanelToggle}
            aria-pressed={rightPanelOpen}
            aria-expanded={rightPanelOpen}
            title={rightPanelOpen ? t("hideFilePanel", "Hide file panel") : t("showFilePanel", "Show file panel")}
            aria-label={rightPanelOpen ? t("hideFilePanel", "Hide file panel") : t("showFilePanel", "Show file panel")}
          >
            <PanelRight size={17} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </>
      )}
    </>
  );

  return (
    <>
      <style>{`
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
      <div className={`app-frame${isWindows ? " is-windows" : ""}${isMac ? " is-macos" : ""}`}>
        <header className="app-topbar">
          <div className={`app-topbar-navigation${sidebarOpen && !isMobile ? " with-sidebar" : ""}`}>
            <button
              type="button"
              className="app-topbar-button"
              onClick={() => navigateHistory(-1)}
              disabled={navigationHistory.index === 0}
              title={t("navigationBack", "Back")}
              aria-label={t("navigationBack", "Back")}
            >
              <ArrowLeftOutlined />
            </button>
            <button
              type="button"
              className="app-topbar-button"
              onClick={() => navigateHistory(1)}
              disabled={navigationHistory.index >= navigationHistory.entries.length - 1}
              title={t("navigationForward", "Forward")}
              aria-label={t("navigationForward", "Forward")}
            >
              <ArrowRightOutlined />
            </button>
            <button
              type="button"
              className="app-topbar-button"
              onClick={handleSidebarToggle}
              title={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
              aria-label={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
              aria-expanded={sidebarOpen}
            >
              <PanelLeft size={16} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
          {isWindows ? (
            <nav className="app-window-menu" aria-label={t("applicationMenu", "Application menu")}>
              {[
                t("menuFile", "File"),
                t("menuEdit", "Edit"),
                t("menuView", "View"),
                t("menuWindow", "Window"),
                t("menuHelp", "Help"),
              ].map((menu, index) => (
                <button
                  key={menu}
                  type="button"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    void window.piBridge.showApplicationMenu(index, Math.round(rect.left), Math.round(rect.bottom));
                  }}
                >
                  {menu}
                </button>
              ))}
            </nav>
          ) : (
            sessionHeader
          )}
        </header>
        <div className="app-workspace" aria-hidden={settingsOpen || undefined} inert={settingsOpen || undefined}>
          {/* Mobile overlay backdrop */}
          <div
            className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 199,
              background: "rgba(0,0,0,0.4)",
              opacity: sidebarOpen ? 1 : 0,
              pointerEvents: sidebarOpen ? "auto" : "none",
              transition: "opacity 0.25s ease",
            }}
          />

          {/* The icon rail stays visible when the project panel is collapsed. */}
          {sidebarRail}
          {/* Left sidebar */}
          <div
            className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
            aria-hidden={!sidebarOpen || undefined}
            inert={!sidebarOpen || undefined}
            style={{
              background: "transparent",
              display: "flex",
              flexDirection: "row",
              flexShrink: 0,
              zIndex: 200,
            }}
          >
            {sidebarContent}
          </div>

          {/* Center: chat */}
          <div
            className={`app-chat${sidebarOpen && !isMobile ? " with-sidebar" : ""}${rightPanelOpen ? " with-right-panel" : ""}`}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
              position: "relative",
            }}
          >
            {isWindows && <header className="app-session-header">{sessionHeader}</header>}
            {/* Chat content */}
            <div ref={chatContentRef} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {showChat ? (
                <SessionProfiler key={sessionKey} id="ChatWindow">
                  <ChatWindow
                    session={selectedSession}
                    newSessionCwd={effectiveNewSessionCwd}
                    workspace={workspace}
                    onAgentEnd={handleAgentEnd}
                    onSessionCreated={handleSessionCreated}
                    onSessionForked={handleSessionForked}
                    modelsRefreshKey={modelsRefreshKey}
                    chatInputRef={chatInputRef}
                    presentationStore={presentationStore}
                    onSessionStatsPanelOpen={openSessionStatsPanel}
                    onOpenFile={handleOpenLinkedFile}
                    thinkingExpansionStore={thinkingExpansionRegistryRef.current.get(
                      selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                    )}
                    processDetailsExpansionStore={processDetailsExpansionRegistryRef.current.get(
                      selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                    )}
                    workStepDisplay={chatAppearance.workStepDisplay}
                  />
                </SessionProfiler>
              ) : defaultSessionError ? (
                <div className="default-session-error" role="alert">
                  <span>{defaultSessionError}</span>
                  <button type="button" onClick={() => setDefaultSessionRetry((key) => key + 1)}>
                    {t("retryUpdate", "Retry")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right panel: the guide plus files, terminals, browser tabs, files, and managed processes */}
          <div
            className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizing ? " right-panel-resizing" : ""}${rightPanelFullscreen ? " right-panel-fullscreen" : ""}`}
            style={
              {
                display: "flex",
                flexDirection: "column",
                borderLeft: "1px solid var(--border)",
                background: "var(--bg)",
                "--right-panel-width": `${rightPanelWidth}px`,
                "--right-panel-min-width": `${rightPanelBounds.minWidth}px`,
              } as CSSProperties
            }
          >
            <div
              className="right-panel-resizer"
              role="separator"
              aria-label={t("resizeRightPanel", "Resize right panel")}
              aria-orientation="vertical"
              aria-valuemin={rightPanelBounds.minWidth}
              aria-valuemax={rightPanelBounds.maxWidth}
              aria-valuenow={Math.round(rightPanelWidth)}
              aria-valuetext={t("rightPanelWidthPixels", "{width} pixels").replace(
                "{width}",
                formatNumber(Math.round(rightPanelWidth), language),
              )}
              tabIndex={isMobile ? -1 : 0}
              onPointerDown={handleRightPanelResizeStart}
              onKeyDown={handleRightPanelResizeKeyDown}
            />
            <RightPanelStrip
              tabs={rightPanel.tabs}
              activeTabId={rightPanel.activeTabId}
              fullscreen={rightPanelFullscreen}
              onSelect={(tabId) => {
                dispatchRightPanel({ type: "select", tabId });
                setGuideNotice(null);
              }}
              onClose={closeRightPanelTab}
              onToggleFullscreen={toggleRightPanelFullscreen}
              onCollapse={() => {
                setRightPanelOpen(false);
              }}
              badgeFor={(tab) =>
                tab.kind === "processes"
                  ? managedProcessAttention
                    ? "!"
                    : managedProcessCount > 0
                      ? String(managedProcessCount)
                      : null
                  : null
              }
            />
            <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              {activePanelTab.kind === "guide" ? (
                <RightPanelGuide entries={guideEntries} notice={guideNotice} />
              ) : activePanelTab.kind === "files" ? (
                <FilesPanelBody
                  cwd={explorerCwd ?? null}
                  refreshKey={explorerRefreshKey}
                  onRefresh={() => setExplorerRefreshKey((key) => key + 1)}
                  onOpenFile={handleOpenFile}
                  onAtMention={handleAtMention}
                />
              ) : activePanelTab.kind === "terminal" && activePanelTab.terminalId !== undefined ? (
                <TerminalPanel
                  key={activePanelTab.terminalId}
                  terminalId={activePanelTab.terminalId}
                  visible={rightPanelOpen && !settingsOpen && !browserAuthorization}
                  onTitleChange={(title) => {
                    dispatchRightPanel({ type: "title", tabId: activePanelTab.id, title });
                  }}
                  onNewTerminal={() => {
                    closeRightPanelTab(activePanelTab.id);
                    void startTerminalTab();
                  }}
                  onClose={() => {
                    closeRightPanelTab(activePanelTab.id);
                  }}
                />
              ) : activePanelTab.kind === "browser" ? (
                <BrowserDock
                  visible={rightPanelOpen && !settingsOpen && !browserAuthorization}
                  ownerSessionId={selectedSession?.id ?? null}
                  tabId={activePanelTab.browserTabId ?? null}
                  onNewTab={() => {
                    void startBrowserTab();
                  }}
                />
              ) : activePanelTab.kind === "processes" ? (
                <ProcessPanel
                  onActiveCountChange={setManagedProcessCount}
                  onOpenBrowser={() => {
                    void startBrowserTab();
                  }}
                />
              ) : activePanelTab.filePath !== undefined ? (
                <FileViewer
                  key={activePanelTab.id}
                  filePath={activePanelTab.filePath}
                  cwd={activeCwd ?? undefined}
                  sourceSessionId={activePanelTab.sourceSessionId}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {settingsOpen && (
        <div className={`settings-page-shell${sidebarOpen ? "" : " nav-collapsed"}`}>
          {sidebarRail}
          <SettingsConfig
            registerTransition={registerSettingsTransition}
            navigationOpen={sidebarOpen}
            cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
            sessionId={authorizationSettingsSessionId ?? selectedSession?.id ?? null}
            initialTab={settingsInitialTab}
            navigationRequestId={settingsNavigationRequestId}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsInitialTab("general");
            }}
            onModelsChanged={() => setModelsRefreshKey((key) => key + 1)}
            onPluginsReloaded={() => setSessionKey((key) => key + 1)}
            onChannelsChanged={setChannelSnapshot}
            chatAppearance={chatAppearance}
            chatAppearanceSaving={chatAppearanceSaving}
            onChatAppearanceChange={onChatAppearanceChange}
          />
        </div>
      )}
      {browserAuthorization && !settingsOpen && (
        <BrowserAuthorizationDialog
          request={browserAuthorization}
          sessionTitle={
            selectedSession?.id === browserAuthorization.sessionId
              ? getSessionDisplayTitle(displayedSession ?? selectedSession, 240)
              : browserAuthorization.sessionId
          }
          onRespond={respondToBrowserAuthorization}
          onManage={() => {
            setAuthorizationSettingsSessionId(browserAuthorization.sessionId);
            setSettingsInitialTab("browser");
            setSettingsNavigationRequestId((value) => value + 1);
            setSettingsOpen(true);
          }}
        />
      )}
    </>
  );
}
