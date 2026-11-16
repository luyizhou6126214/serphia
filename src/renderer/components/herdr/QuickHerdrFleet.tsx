import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Folder, PanelsTopLeft, RefreshCw, Terminal, UsersRound, X } from "lucide-react";
import { call } from "@/lib/api-client";
import { useHerdrFleet } from "@/hooks/useHerdrFleet";
import { useHerdrRuntime } from "@/hooks/useHerdrRuntime";
import { useI18n } from "@/i18n";
import {
  getQuickChannelBindingPopoverLayout,
  type QuickChannelBindingPopoverLayout,
} from "@/lib/quick-channel-binding-layout";
import type { HerdrAgentState } from "@contract/herdr";
import { countHerdrAgents, herdrPaneMatchesFilter } from "./fleet-selectors";
import { getFleetPresentation, getFleetTriggerSpacing } from "./fleet-presentation";
import { herdrErrorLabel, herdrRuntimeStatusLabel, publicHerdrErrorLabel } from "./herdr-ui-copy";
import "./QuickHerdrFleet.css";

const FILTER_STATES: Array<HerdrAgentState | "all"> = ["all", "working", "blocked", "idle", "done", "unknown"];

export function QuickHerdrFleet({
  isMobile,
  alignRight = false,
  rightInset = 0,
  chatAgentPaneIds,
}: {
  isMobile: boolean;
  alignRight?: boolean;
  rightInset?: number;
  chatAgentPaneIds?: readonly string[];
}) {
  const { t } = useI18n();
  const { runtime, loading: runtimeLoading, error: runtimeError, refresh: refreshRuntime } = useHerdrRuntime();
  const ready = runtime?.status === "ready";
  const { fleet, loading, error, refresh } = useHerdrFleet(ready);
  const { hasFleet, interactive, showEmpty } = getFleetPresentation(ready, fleet);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<HerdrAgentState | "all">("all");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [popoverLayout, setPopoverLayout] = useState<QuickChannelBindingPopoverLayout | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const available = runtimeLoading || (runtime ? runtime.status !== "disabled" : Boolean(runtimeError));
  const showPopover = available && open && popoverLayout !== null;

  const stateLabel = useCallback(
    (state: HerdrAgentState | "all") => {
      if (state === "all") return t("allStates", "All states");
      if (state === "working") return t("herdrStateWorking", "Working");
      if (state === "blocked") return t("herdrStateBlocked", "Blocked");
      if (state === "idle") return t("herdrStateIdle", "Idle");
      if (state === "done") return t("herdrStateDone", "Done");
      return t("herdrStateUnknown", "Unknown");
    },
    [t],
  );

  const counts = useMemo(() => {
    return countHerdrAgents(fleet?.panes ?? []);
  }, [fleet?.panes]);
  const agentCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const chatPaneIds = useMemo(() => new Set(chatAgentPaneIds), [chatAgentPaneIds]);

  const visiblePanes = useMemo(
    () =>
      new Map(
        (fleet?.panes ?? []).filter((pane) => herdrPaneMatchesFilter(pane, filter)).map((pane) => [pane.id, pane]),
      ),
    [filter, fleet?.panes],
  );

  const closePopover = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const updatePopoverLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const next = getQuickChannelBindingPopoverLayout({
      trigger: trigger.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      isMobile,
    });
    setPopoverLayout((previous) =>
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.maxHeight === next.maxHeight &&
      previous.placement === next.placement
        ? previous
        : next,
    );
  }, [isMobile]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || dialogRef.current?.contains(target)) return;
      closePopover();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !dialogRef.current?.querySelector(".quick-herdr-fleet-filter:is(:open)")) {
        closePopover(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePopover, open]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverLayout();
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePopoverLayout);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (rootRef.current?.parentElement) observer?.observe(rootRef.current.parentElement);
    window.addEventListener("resize", updatePopoverLayout);
    window.addEventListener("scroll", updatePopoverLayout, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updatePopoverLayout);
      window.removeEventListener("scroll", updatePopoverLayout, true);
    };
  }, [open, updatePopoverLayout]);

  if (!available) return null;

  const showBlocked = runtime?.status === "error" || (interactive && counts.blocked > 0);
  const showWorking = interactive && counts.working > 0;
  const title = t("agentFleet", "Agent Collaboration");
  const countLabel = (
    agentCount === 1 ? t("herdrAgentCountOne", "{count} Agent") : t("herdrAgentCountOther", "{count} Agents")
  ).replace("{count}", String(agentCount));
  const runtimeDetailBase = runtimeLoading
    ? t("loadingHerdr", "Loading Herdr…")
    : ready
      ? (runtime?.sessionName ?? "default")
      : herdrRuntimeStatusLabel(runtime?.status, t);
  const runtimeDetail = fleet?.stale
    ? `${runtimeDetailBase} · ${t("herdrSnapshotStale", "Snapshot stale")}`
    : runtimeDetailBase;
  const panelDetail = fleet ? `${countLabel} · ${runtimeDetail}` : runtimeDetail;
  const visibleError = runtime?.error
    ? publicHerdrErrorLabel(runtime.error, t)
    : (actionError ??
      retryError ??
      (error ? herdrErrorLabel(error, t) : runtimeError ? herdrErrorLabel(runtimeError, t) : null));
  const runAction = async (action: () => Promise<unknown>, restoreFocus = false) => {
    if (!interactive || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await action();
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          if (document.activeElement === document.body) dialogRef.current?.focus();
        });
      }
    } catch (cause) {
      setActionError(herdrErrorLabel(cause, t));
    } finally {
      setActionPending(false);
    }
  };

  const closeTab = (tabId: string, name: string) => {
    if (!interactive || actionPending) return;
    const message = t(
      "herdrCloseTabConfirm",
      "Close “{name}”? All panes in this tab and their running tasks will stop.",
    ).replace("{name}", () => name);
    if (window.confirm(message)) void runAction(() => call("herdr.tab.close", { tabId }), true);
  };

  const closePane = (paneId: string, name: string) => {
    if (!interactive || actionPending) return;
    const message = t("herdrClosePaneConfirm", "Close “{name}”? Tasks running in this pane will stop.").replace(
      "{name}",
      () => name,
    );
    if (window.confirm(message)) void runAction(() => call("herdr.pane.close", { paneId }), true);
  };

  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await call("herdr.runtime.connect");
    } catch (nextError) {
      setRetryError(herdrErrorLabel(nextError, t));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <div ref={rootRef} className="quick-herdr-fleet-trigger" style={getFleetTriggerSpacing(alignRight, rightInset)}>
        <button
          ref={triggerRef}
          type="button"
          data-testid="herdr-fleet-indicator"
          data-fleet-state={showBlocked ? "blocked" : showWorking ? "working" : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={title}
          title={`${title} · ${panelDetail}`}
          onClick={() => {
            setActionError(null);
            setOpen((value) => !value);
          }}
          className="app-topbar-button quick-herdr-fleet-button"
        >
          <UsersRound size={17} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      {showPopover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-testid="herdr-fleet-popover"
            data-placement={popoverLayout.placement}
            className="quick-herdr-fleet-popover"
            style={{
              top: popoverLayout.top,
              left: popoverLayout.left,
              width: popoverLayout.width,
              maxHeight: popoverLayout.maxHeight,
            }}
          >
            <header className="quick-herdr-fleet-header">
              <div className="quick-herdr-fleet-copy">
                <h2 id={titleId}>{title}</h2>
                <p id={descriptionId} title={panelDetail}>
                  {panelDetail}
                </p>
              </div>
              <div className="quick-herdr-fleet-header-actions">
                <button
                  type="button"
                  className="quick-herdr-fleet-icon-button"
                  disabled={loading || runtimeLoading}
                  aria-label={t("refresh", "Refresh")}
                  title={t("refresh", "Refresh")}
                  onClick={() => void (ready ? refresh() : refreshRuntime())}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="quick-herdr-fleet-icon-button"
                  aria-label={t("close", "Close")}
                  title={t("close", "Close")}
                  onClick={() => closePopover(true)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>
            {hasFleet && (
              <div className="quick-herdr-fleet-list-header">
                <span>{t("workspaces", "Workspaces")}</span>
                {(agentCount > 0 || filter !== "all") && (
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}
                    aria-label={t("filterAgentState", "Filter agent state")}
                    className="quick-herdr-fleet-filter"
                  >
                    {FILTER_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state === "all" ? stateLabel(state) : `${stateLabel(state)} (${counts[state]})`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="quick-herdr-fleet-content" aria-busy={actionPending || undefined}>
              {visibleError && (
                <div role="alert" className="quick-herdr-fleet-alert">
                  {visibleError}
                </div>
              )}
              {!runtimeLoading && runtime && runtime.status !== "disabled" && !ready && (
                <div className="quick-herdr-fleet-empty">
                  <div>
                    {runtime?.mode === "managed"
                      ? t(
                          "herdrManagedConnectHint",
                          "serphia starts this Session automatically. Check the runtime status or repair Herdr in Developer Tools.",
                        )
                      : t("herdrConnectHint", "Start the selected Herdr Session, then connect again.")}
                  </div>
                  <button
                    type="button"
                    disabled={retrying}
                    className="quick-herdr-fleet-retry"
                    onClick={() => void retryConnection()}
                  >
                    {retrying ? t("connecting", "Connecting…") : t("retryConnection", "Retry connection")}
                  </button>
                </div>
              )}
              {showEmpty && (
                <div className="quick-herdr-fleet-empty">
                  {t("noHerdrPanes", "This Herdr Session has no panes yet.")}
                </div>
              )}
              {hasFleet && filter !== "all" && visiblePanes.size === 0 && (
                <div className="quick-herdr-fleet-empty">
                  {t("noHerdrPanesForState", "No panes match this agent state.")}
                </div>
              )}
              {hasFleet &&
                fleet?.workspaces.map((workspace) => {
                  const visibleTabs = workspace.tabs
                    .map((tab) => ({
                      tab,
                      panes: tab.paneIds.flatMap((paneId) => {
                        const pane = visiblePanes.get(paneId);
                        return pane ? [pane] : [];
                      }),
                    }))
                    .filter(({ panes }) => filter === "all" || panes.length > 0);
                  if (visibleTabs.length === 0) return null;
                  return (
                    <section key={workspace.id} className="quick-herdr-fleet-workspace" data-stale={fleet.stale}>
                      <h3>
                        <Folder size={14} aria-hidden="true" />
                        <span title={workspace.name || workspace.id}>{workspace.name || workspace.id}</span>
                      </h3>
                      {visibleTabs.map(({ tab, panes }) => {
                        const tabName = tab.name || tab.id;
                        const tabLabel = /^\d+$/.test(tabName)
                          ? t("herdrTabName", "Tab {name}").replace("{name}", () => tabName)
                          : tabName;
                        const focusTabLabel = t("herdrFocusTab", "Focus tab “{name}”").replace(
                          "{name}",
                          () => tabLabel,
                        );
                        const closeTabLabel = t("herdrCloseTab", "Close tab “{name}”").replace(
                          "{name}",
                          () => tabLabel,
                        );
                        const paneCount = (
                          tab.paneIds.length === 1
                            ? t("herdrPaneCountOne", "{count} pane")
                            : t("herdrPaneCountOther", "{count} panes")
                        ).replace("{count}", String(tab.paneIds.length));
                        return (
                          <div key={tab.id} className="quick-herdr-fleet-tab" data-herdr-tab={tab.id}>
                            <div className="quick-herdr-fleet-tab-header" data-focused={tab.focused}>
                              <button
                                type="button"
                                className="quick-herdr-fleet-row-button"
                                disabled={!interactive}
                                aria-disabled={actionPending || undefined}
                                aria-current={tab.focused || undefined}
                                aria-label={focusTabLabel}
                                title={focusTabLabel}
                                onClick={() => void runAction(() => call("herdr.tab.focus", { tabId: tab.id }))}
                              >
                                <PanelsTopLeft size={14} aria-hidden="true" />
                                <span className="quick-herdr-fleet-tab-name">{tabLabel}</span>
                                <span className="quick-herdr-fleet-pane-count">{paneCount}</span>
                              </button>
                              <button
                                type="button"
                                className="quick-herdr-fleet-icon-button quick-herdr-fleet-close"
                                disabled={!interactive}
                                aria-disabled={actionPending || undefined}
                                aria-label={closeTabLabel}
                                title={closeTabLabel}
                                onClick={() => closeTab(tab.id, tabLabel)}
                              >
                                <X size={14} aria-hidden="true" />
                              </button>
                            </div>
                            {panes.map((pane) => {
                              const state = pane.agent?.state ?? "unknown";
                              const invokedByChat = Boolean(pane.agent && chatPaneIds.has(pane.id));
                              const PaneIcon = pane.agent ? Bot : Terminal;
                              const shell = t("shellPane", "Shell pane");
                              const detail = pane.agent?.kind ?? shell;
                              const name = pane.agent?.name || pane.title || detail;
                              const target = pane.agent?.name || pane.title ? name : `${name} · ${pane.id}`;
                              const focusLabel = t("herdrFocusPane", "Focus pane “{name}”").replace(
                                "{name}",
                                () => target,
                              );
                              const closeLabel = t("herdrClosePane", "Close pane “{name}”").replace(
                                "{name}",
                                () => target,
                              );
                              return (
                                <div
                                  key={pane.id}
                                  className="quick-herdr-fleet-pane"
                                  data-herdr-pane={pane.id}
                                  data-fleet-state={state}
                                  data-focused={pane.focused}
                                  data-invoked-by-chat={invokedByChat || undefined}
                                >
                                  <button
                                    type="button"
                                    className="quick-herdr-fleet-row-button"
                                    disabled={!interactive || !pane.alive}
                                    aria-disabled={actionPending || undefined}
                                    aria-current={pane.focused || undefined}
                                    aria-label={pane.agent ? `${focusLabel} · ${stateLabel(state)}` : focusLabel}
                                    title={focusLabel}
                                    onClick={() => void runAction(() => call("herdr.pane.focus", { paneId: pane.id }))}
                                  >
                                    <span className="quick-herdr-fleet-pane-icon" aria-hidden="true">
                                      <PaneIcon size={15} />
                                    </span>
                                    <span className="quick-herdr-fleet-copy">
                                      <span className="quick-herdr-fleet-pane-name">{name}</span>
                                      <span className="quick-herdr-fleet-pane-meta">
                                        <span className="quick-herdr-fleet-pane-kind">
                                          {detail === name ? pane.id : detail}
                                        </span>
                                        {invokedByChat && (
                                          <span className="quick-herdr-fleet-chat-badge">
                                            {t("herdrInvokedByChat", "Called by this chat")}
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                    {pane.agent && <span className="quick-herdr-fleet-state">{stateLabel(state)}</span>}
                                  </button>
                                  <button
                                    type="button"
                                    className="quick-herdr-fleet-icon-button quick-herdr-fleet-close"
                                    disabled={!interactive || !pane.alive}
                                    aria-disabled={actionPending || undefined}
                                    aria-label={closeLabel}
                                    title={closeLabel}
                                    onClick={() => closePane(pane.id, target)}
                                  >
                                    <X size={14} aria-hidden="true" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
