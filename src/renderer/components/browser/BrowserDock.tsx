import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { applyBrowserEvent } from "@/lib/browser-tabs";
import { browserErrorMessage as messageOf } from "./browser-error-message";
import { browserSurfaceBounds } from "./browser-surface-bounds";
import type {
  BrowserDownloadInfo,
  BrowserElementReference,
  BrowserPermissionRequest,
  BrowserRendererState,
} from "@contract/browser";

type ElementPick = { tabId: string; requestId: string };

/**
 * The Browser panel. Bound to one Main-owned browser tab (`tabId`), it draws
 * that tab's toolbar and native surface while the panel strip owns the tabs;
 * unbound, it keeps its own tab strip for callers that need one.
 */
export function BrowserDock({
  visible,
  suspendSurface = false,
  ownerSessionId,
  tabId = null,
  onNewTab,
  onReference,
}: {
  visible: boolean;
  suspendSurface?: boolean;
  ownerSessionId: string | null;
  tabId?: string | null;
  onNewTab?: () => void;
  onReference?: (element: BrowserElementReference) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<BrowserRendererState | null>(null);
  const [address, setAddress] = useState("");
  const [profileId, setProfileId] = useState("temporary");
  const [error, setError] = useState("");
  const [elementPick, setElementPick] = useState<ElementPick | null>(null);
  const pickRef = useRef<ElementPick | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const refresh = useCallback(async () => {
    try {
      const next = await window.piBridge.browserGetState();
      if (!stateRef.current) setProfileId(next.settings.settings.panel.defaultProfileId);
      setState(next);
      const active = next.tabs.find((tab) => tab.id === (tabId ?? next.activeTabId));
      if (active) setAddress(active.url);
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [tabId]);

  const handleTabSyncError = useCallback(
    (cause: unknown) => {
      const message = messageOf(cause);
      if (message.includes("TAB_NOT_FOUND")) {
        void refresh();
        return;
      }
      setError(message);
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    return window.piBridge.onBrowserEvent((event) => {
      setState((current) => (current ? applyBrowserEvent(current, event) : current));
      if (event.type === "active-tab-changed" && tabId === null) {
        const tab = stateRef.current?.tabs.find((candidate) => candidate.id === event.tabId);
        if (tab) setAddress(tab.url);
      } else if (event.type === "tab-updated" && event.tab.id === (tabId ?? stateRef.current?.activeTabId)) {
        const previous = stateRef.current?.tabs.find((tab) => tab.id === event.tab.id);
        if (previous?.url === event.tab.url) return;
        setAddress(event.tab.url);
      }
    });
  }, [refresh, tabId]);

  const boundTab = tabId === null ? null : (state?.tabs.find((tab) => tab.id === tabId) ?? null);
  const activeTab = tabId === null ? (state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null) : boundTab;
  const visibleTabs =
    state?.tabs.filter((tab) => tab.ownerSessionId === null || tab.ownerSessionId === ownerSessionId) ?? [];
  const picking = visible && Boolean(elementPick && elementPick.tabId === activeTab?.id);

  useEffect(
    () => () => {
      const pick = pickRef.current;
      if (!pick) return;
      pickRef.current = null;
      void window.piBridge.browserCancelElementPick(pick.tabId, pick.requestId).catch(() => undefined);
    },
    [activeTab?.id, ownerSessionId, visible],
  );

  const toggleElementPick = async () => {
    const pending = pickRef.current;
    if (pending) {
      pickRef.current = null;
      setElementPick(null);
      await window.piBridge.browserCancelElementPick(pending.tabId, pending.requestId).catch(handleTabSyncError);
      return;
    }
    if (!activeTab || !onReference) return;
    const pick = { tabId: activeTab.id, requestId: crypto.randomUUID() };
    pickRef.current = pick;
    setElementPick(pick);
    setError("");
    try {
      const element = await window.piBridge.browserPickElement(pick.tabId, pick.requestId);
      if (element && pickRef.current === pick) onReference(element);
    } catch (cause) {
      if (pickRef.current === pick) handleTabSyncError(cause);
    } finally {
      if (pickRef.current === pick) pickRef.current = null;
      setElementPick((current) => (current === pick ? null : current));
    }
  };

  // A bound dock shows its own tab: Main's active tab follows the panel tab.
  useEffect(() => {
    if (tabId === null || !state || !visible || boundTab === null || state.activeTabId === tabId) return;
    void window.piBridge.browserActivateTab(tabId).catch(handleTabSyncError);
  }, [boundTab, handleTabSyncError, state, tabId, visible]);

  useEffect(() => {
    if (tabId !== null) return;
    if (!state || !visible || !state.activeTabId) return;
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!active || active.ownerSessionId === null || active.ownerSessionId === ownerSessionId) return;
    const replacement = [...state.tabs]
      .filter((tab) => tab.ownerSessionId === null || tab.ownerSessionId === ownerSessionId)
      .sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
    if (replacement) void window.piBridge.browserActivateTab(replacement.id).catch(handleTabSyncError);
    else void window.piBridge.browserSetSurfaceVisible({ visible: false });
  }, [handleTabSyncError, ownerSessionId, state, tabId, visible]);

  // A native view can intercept mouse input before it reaches the separator's pointer capture.
  // Keep observing its bounds so it reappears at the resized position.
  const surfaceVisible = visible && !suspendSurface;
  useLayoutEffect(() => {
    const tabId = activeTab?.id;
    void window.piBridge
      .browserSetSurfaceVisible({ ...(tabId ? { tabId } : {}), visible: surfaceVisible && Boolean(tabId) })
      .catch(handleTabSyncError);
    return () => {
      void window.piBridge.browserSetSurfaceVisible({ visible: false }).catch(() => undefined);
    };
  }, [activeTab?.id, handleTabSyncError, surfaceVisible]);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    const tabId = activeTab?.id;
    if (!element || !tabId || !visible) return;
    let frame = 0;
    let lastBoundsKey = "";
    const panel = element.closest(".right-panel-container");
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const surfaceRect = element.getBoundingClientRect();
        const rect = browserSurfaceBounds(
          surfaceRect,
          panel?.getBoundingClientRect() ?? surfaceRect,
          panel ? getComputedStyle(panel) : undefined,
        );
        if (!rect) return;
        const scaleFactorVersion = Math.round(window.devicePixelRatio * 1000);
        const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}:${scaleFactorVersion}`;
        if (key === lastBoundsKey) return;
        lastBoundsKey = key;
        void window.piBridge
          .browserSetBounds({
            tabId,
            rect,
            scaleFactorVersion,
          })
          .catch((cause) => {
            if (lastBoundsKey === key) lastBoundsKey = "";
            handleTabSyncError(cause);
          });
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    if (panel) observer.observe(panel);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    // A flex layout can move the panel without resizing the surface. Native
    // WebContentsView bounds need that position change even after CSS settles.
    const positionCheck = window.setInterval(sync, 120);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(positionCheck);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [activeTab?.id, handleTabSyncError, visible]);

  const createTab = async () => {
    try {
      const tab = await window.piBridge.browserCreateUserTab({
        profileId,
        ownerSessionId,
        activate: true,
      });
      setAddress(tab.url);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const navigate = async () => {
    if (!activeTab) return;
    try {
      await window.piBridge.browserNavigateUser(activeTab.id, address);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const pickLabel = picking
    ? t("browserCancelElementPick", "Cancel element selection")
    : t("browserPickElement", "Select element for chat");

  if (!state) return <div style={emptyStyle}>{error || t("browserLoadingPanel", "Loading Browser…")}</div>;
  if (!state.settings.settings.enabled) {
    return (
      <div style={emptyStyle}>
        <div>{t("browserDisabled", "Built-in Browser is disabled.")}</div>
        <div style={{ marginTop: 7, color: "var(--text-dim)" }}>
          {t("browserEnableInSettings", "Enable it in Settings → Browser.")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {tabId === null && (
        <div
          data-browser-tab-strip
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minHeight: 34,
            padding: "3px 5px",
            borderBottom: "1px solid var(--border)",
            overflowX: "auto",
            background: "var(--bg-panel)",
          }}
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              title={tab.url}
              onClick={() =>
                void window.piBridge.browserActivateTab(tab.id).catch((cause) => setError(messageOf(cause)))
              }
              style={{
                maxWidth: 150,
                minWidth: 72,
                height: 27,
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "0 7px",
                background: tab.id === state.activeTabId ? "var(--bg)" : "transparent",
                color: tab.crashed ? "#d45" : "var(--text-muted)",
                border: `1px solid ${tab.id === state.activeTabId ? "var(--border)" : "transparent"}`,
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              {tab.loading ? (
                <span aria-label={t("browserLoading", "Loading")}>◌</span>
              ) : (
                <span aria-hidden="true">●</span>
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {tab.title || t("browserNewTab", "New tab")}
              </span>
              {tab.advanced || tab.advancedProfile ? (
                <Badge danger>{t("browserAdvancedModeBadge", "Advanced Browser Mode")}</Badge>
              ) : null}
              <span
                role="button"
                aria-label={t("browserCloseTab", "Close tab")}
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void window.piBridge.browserCloseTab(tab.id).catch((cause) => setError(messageOf(cause)));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    void window.piBridge.browserCloseTab(tab.id).catch((cause) => setError(messageOf(cause)));
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            style={iconButtonStyle}
            title={t("browserNewTab", "New tab")}
            onClick={() => void createTab()}
          >
            ＋
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 5,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        <button
          style={iconButtonStyle}
          disabled={!activeTab?.canGoBack}
          title={t("browserBack", "Back")}
          onClick={() => activeTab && void window.piBridge.browserGoBack(activeTab.id)}
        >
          ←
        </button>
        <button
          style={iconButtonStyle}
          disabled={!activeTab?.canGoForward}
          title={t("browserForward", "Forward")}
          onClick={() => activeTab && void window.piBridge.browserGoForward(activeTab.id)}
        >
          →
        </button>
        <button
          style={iconButtonStyle}
          disabled={!activeTab}
          title={activeTab?.loading ? t("browserStop", "Stop") : t("browserReload", "Reload")}
          onClick={() =>
            activeTab &&
            void (activeTab.loading
              ? window.piBridge.browserStop(activeTab.id)
              : window.piBridge.browserReload(activeTab.id))
          }
        >
          {activeTab?.loading ? "×" : "↻"}
        </button>
        <form
          style={{ flex: 1, minWidth: 0 }}
          onSubmit={(event) => {
            event.preventDefault();
            void navigate();
          }}
        >
          <input
            aria-label={t("browserAddress", "Browser address")}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://example.com"
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              padding: "0 9px",
              border: `1px solid ${activeTab?.url.startsWith("http:") ? "#d9872f" : "var(--border)"}`,
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 11,
              outline: "none",
            }}
          />
        </form>
        <button
          type="button"
          style={
            picking ? { ...iconButtonStyle, color: "var(--accent)", background: "var(--accent-soft)" } : iconButtonStyle
          }
          aria-label={pickLabel}
          aria-pressed={picking}
          title={pickLabel}
          disabled={
            !picking &&
            (!visible ||
              !onReference ||
              !activeTab ||
              activeTab.loading ||
              activeTab.crashed ||
              activeTab.control !== "user" ||
              !/^https?:/.test(activeTab.url))
          }
          onClick={() => void toggleElementPick()}
        >
          <MousePointer2 size={15} aria-hidden="true" />
        </button>
        <select
          aria-label={t("browserProfileForNewTabs", "Profile for new tabs")}
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          style={{ ...selectStyle, maxWidth: 90 }}
          hidden={tabId !== null}
        >
          {state.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        {tabId !== null && onNewTab !== undefined && (
          <button style={iconButtonStyle} title={t("browserNewTab", "New tab")} onClick={onNewTab}>
            ＋
          </button>
        )}
        <button
          style={iconButtonStyle}
          disabled={!activeTab}
          title={t("browserChooseUpload", "Choose files for focused upload input")}
          onClick={() =>
            activeTab &&
            void window.piBridge.browserChooseUploadFiles(activeTab.id).catch((cause) => setError(messageOf(cause)))
          }
        >
          ↑
        </button>
        <button
          style={iconButtonStyle}
          disabled={!activeTab || !/^https?:/.test(activeTab.url)}
          title={t("browserOpenSystem", "Open in system browser")}
          onClick={() => activeTab && void window.piBridge.openExternal(activeTab.url)}
        >
          ↗
        </button>
      </div>

      {(error || state.permissionRequests.length > 0 || activeDownload(state.downloads)) && (
        <div
          style={{
            display: "grid",
            gap: 4,
            padding: "5px 7px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontSize: 10,
          }}
        >
          {error && <div style={{ color: "#d45" }}>{error}</div>}
          {state.permissionRequests.map((request) => (
            <PermissionPrompt key={request.id} request={request} onRespond={refresh} />
          ))}
          {activeDownload(state.downloads) && <DownloadStatus download={activeDownload(state.downloads)!} />}
        </div>
      )}

      {!activeTab ? (
        <div style={emptyStyle}>
          <button style={primaryButtonStyle} onClick={onNewTab ?? (() => void createTab())}>
            {t("browserOpenNewTab", "Open a new tab")}
          </button>
          <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
            {t("browserRemotePageSecurity", "Remote pages receive no serphia preload or Node access.")}
          </div>
        </div>
      ) : activeTab.crashed ? (
        <div style={emptyStyle}>
          <div>{t("browserTabCrashed", "This tab’s renderer crashed.")}</div>
          <button
            style={{ ...primaryButtonStyle, marginTop: 9 }}
            onClick={() => void window.piBridge.browserReload(activeTab.id)}
          >
            {t("browserReload", "Reload")}
          </button>
        </div>
      ) : (
        <div
          ref={surfaceRef}
          data-browser-surface
          style={{ flex: 1, minHeight: 1, position: "relative", background: suspendSurface ? "var(--bg)" : "#fff" }}
        />
      )}

      {activeTab && (
        <div
          style={{
            minHeight: 22,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 7px",
            borderTop: "1px solid var(--border)",
            color: "var(--text-dim)",
            fontSize: 9,
            background: "var(--bg-panel)",
          }}
        >
          <span aria-live="polite">
            {picking
              ? t("browserElementPickHint", "Click an element to reference it · Esc to cancel")
              : activeTab.control === "agent"
                ? t("browserAgentControl", "Agent is controlling this tab — click or type to take over")
                : t("browserUserControl", "User control")}
          </span>
          <span>·</span>
          <span>
            {state.settings.settings.navigation.networkIsolation === "strict"
              ? t("browserStrictIsolation", "Strict isolation")
              : t("browserBestEffortIsolation", "Best-effort network isolation")}
          </span>
          {activeTab.advanced || activeTab.advancedProfile ? (
            <Badge danger>{t("browserAdvancedModeBadge", "Advanced Browser Mode")}</Badge>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PermissionPrompt({
  request,
  onRespond,
}: {
  request: BrowserPermissionRequest;
  onRespond: () => Promise<void>;
}) {
  const { t } = useI18n();
  const respond = (decision: "allow-once" | "allow-session" | "deny") =>
    void window.piBridge.browserRespondPermission(request.id, decision).then(onRespond);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
      <span style={{ flex: 1 }}>
        {formatMessage(t("browserPermissionRequest", "{origin} requests {permission}"), {
          origin: request.origin,
          permission: request.permission,
        })}
      </span>
      <button style={tinyButtonStyle} onClick={() => respond("deny")}>
        {t("browserDeny", "Deny")}
      </button>
      <button style={tinyButtonStyle} onClick={() => respond("allow-once")}>
        {t("browserAllowOnce", "Once")}
      </button>
      <button style={tinyButtonStyle} onClick={() => respond("allow-session")}>
        {t("browserAllowSession", "Session")}
      </button>
    </div>
  );
}

function DownloadStatus({ download }: { download: BrowserDownloadInfo }) {
  const { t } = useI18n();
  const percent = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : null;
  const stateLabel = downloadStateLabel(t, download.state);
  return (
    <div style={{ color: download.state === "interrupted" ? "#d45" : "var(--text-dim)" }}>
      {formatMessage(t("browserDownloadStatus", "Download {filename}: {state}{percent}"), {
        filename: download.filename,
        state: stateLabel,
        percent: percent === null ? "" : ` ${percent}%`,
      })}
    </div>
  );
}

function Badge({ children, danger }: { children: string; danger?: boolean }) {
  return (
    <span
      style={{
        padding: "1px 3px",
        borderRadius: 3,
        color: danger ? "#d45" : "#b87924",
        border: `1px solid ${danger ? "#d45" : "#b87924"}`,
        fontSize: 7,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function activeDownload(downloads: BrowserDownloadInfo[]): BrowserDownloadInfo | undefined {
  return [...downloads]
    .reverse()
    .find(
      (download) =>
        download.state === "pending" || download.state === "progressing" || download.state === "interrupted",
    );
}

type Translate = ReturnType<typeof useI18n>["t"];

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function downloadStateLabel(t: Translate, state: BrowserDownloadInfo["state"]): string {
  switch (state) {
    case "pending":
      return t("browserDownloadPending", "pending");
    case "progressing":
      return t("browserDownloadProgressing", "progressing");
    case "completed":
      return t("browserDownloadCompleted", "completed");
    case "cancelled":
      return t("browserDownloadCancelled", "cancelled");
    default:
      return t("browserDownloadInterrupted", "interrupted");
  }
}

const emptyStyle = {
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  textAlign: "center" as const,
  color: "var(--text-muted)",
  fontSize: 11,
};
const iconButtonStyle = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "1px solid transparent",
  borderRadius: 5,
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 14,
};
const selectStyle = {
  height: 29,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg)",
  color: "var(--text-muted)",
  fontSize: 10,
};
const primaryButtonStyle = {
  minHeight: 32,
  padding: "0 12px",
  border: "1px solid var(--accent)",
  borderRadius: 6,
  background: "var(--accent-soft)",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 11,
};
const tinyButtonStyle = {
  minHeight: 22,
  padding: "0 6px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 9,
};
