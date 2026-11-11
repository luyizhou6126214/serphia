import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ChevronDown, Layers3, RefreshCw, Terminal, X } from "lucide-react";
import { call } from "@/lib/api-client";
import { useHerdrFleet } from "@/hooks/useHerdrFleet";
import { useHerdrRuntime } from "@/hooks/useHerdrRuntime";
import { useQuickToolbarPopoverMotion } from "@/hooks/useQuickToolbarPopoverMotion";
import { useI18n } from "@/i18n";
import {
  getQuickChannelBindingPopoverLayout,
  type QuickChannelBindingPopoverLayout,
} from "@/lib/quick-channel-binding-layout";
import type { HerdrAgentState } from "@contract/herdr";
import { countHerdrAgents, herdrPaneMatchesFilter } from "./fleet-selectors";
import { getFleetPresentation, getFleetTriggerSpacing } from "./fleet-presentation";
import { herdrErrorLabel, herdrRuntimeStatusLabel, publicHerdrErrorLabel } from "./herdr-ui-copy";
import "../QuickToolbar.css";
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
  const { hasFleet, showEmpty } = getFleetPresentation(ready, fleet);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<HerdrAgentState | "all">("all");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [popoverLayout, setPopoverLayout] = useState<QuickChannelBindingPopoverLayout | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const available = runtimeLoading || (runtime ? runtime.status !== "disabled" : Boolean(runtimeError));
  const showPopover = available && open && popoverLayout !== null;

  useQuickToolbarPopoverMotion(dialogRef, showPopover);

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

  const visiblePaneIds = useMemo(
    () => new Set((fleet?.panes ?? []).filter((pane) => herdrPaneMatchesFilter(pane, filter)).map((pane) => pane.id)),
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

  const triggerState: HerdrAgentState = fleet?.stale
    ? "unknown"
    : counts.blocked
      ? "blocked"
      : counts.working
        ? "working"
        : counts.idle
          ? "idle"
          : counts.done
            ? "done"
            : "unknown";
  const title = t("agentFleet", "Agent Collaboration");
  const countLabel = (
    agentCount === 1 ? t("herdrAgentCountOne", "{count} Agent") : t("herdrAgentCountOther", "{count} Agents")
  ).replace("{count}", String(agentCount));
  const fullTriggerLabel = fleet ? `${title} · ${countLabel}` : title;
  const triggerLabel = isMobile ? (fleet ? countLabel : t("agentFleetShort", "Agents")) : fullTriggerLabel;
  const runtimeDetailBase = runtimeLoading
    ? t("loadingHerdr", "Loading Herdr…")
    : ready
      ? `v${runtime?.version ?? "?"} · ${runtime?.sessionName ?? "default"}`
      : herdrRuntimeStatusLabel(runtime?.status, t);
  const runtimeDetail = fleet?.stale
    ? `${runtimeDetailBase} · ${t("herdrSnapshotStale", "Snapshot stale")}`
    : runtimeDetailBase;
  const panelDetail = fleet ? `${countLabel} · ${runtimeDetail}` : runtimeDetail;
  const visibleError = runtime?.error
    ? publicHerdrErrorLabel(runtime.error, t)
    : (retryError ?? (error ? herdrErrorLabel(error, t) : runtimeError ? herdrErrorLabel(runtimeError, t) : null));

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
          data-fleet-state={ready ? triggerState : runtime?.status === "error" ? "blocked" : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={isMobile ? fullTriggerLabel : undefined}
          title={`${title} · ${panelDetail}`}
          onClick={() => setOpen((value) => !value)}
          className="quick-toolbar-trigger"
          style={{ maxWidth: isMobile ? 144 : 240 }}
        >
          <span className="quick-toolbar-trigger-icon" aria-hidden="true">
            <Bot size={14} />
            {(ready || runtime?.status === "error") && <span className="quick-toolbar-trigger-status" />}
          </span>
          <span className="quick-toolbar-trigger-label">{triggerLabel}</span>
          <ChevronDown className="quick-toolbar-trigger-chevron" size={11} aria-hidden="true" />
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
            className="quick-toolbar-popover chat-appearance-scope"
            style={{
              top: popoverLayout.top,
              left: popoverLayout.left,
              width: popoverLayout.width,
              maxHeight: popoverLayout.maxHeight,
            }}
          >
            <span className="quick-toolbar-halo" aria-hidden="true" />
            <div className="quick-herdr-fleet-controls">
              <header className="quick-toolbar-header">
                <span className="quick-toolbar-mark" aria-hidden="true">
                  <Bot size={19} />
                </span>
                <div className="quick-herdr-fleet-copy">
                  <h2 id={titleId}>{title}</h2>
                  <p id={descriptionId} title={panelDetail}>
                    {panelDetail}
                  </p>
                </div>
                <div className="quick-herdr-fleet-header-actions">
                  <button
                    type="button"
                    className="quick-toolbar-icon-button"
                    disabled={loading || runtimeLoading}
                    aria-label={t("refresh", "Refresh")}
                    title={t("refresh", "Refresh")}
                    onClick={() => void (ready ? refresh() : refreshRuntime())}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="quick-toolbar-icon-button"
                    aria-label={t("close", "Close")}
                    onClick={() => closePopover(true)}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </header>
              {hasFleet && (
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}
                  aria-label={t("filterAgentState", "Filter agent state")}
                  className="quick-herdr-fleet-filter"
                >
                  {FILTER_STATES.map((state) => (
                    <option key={state} value={state}>
                      {stateLabel(state)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="quick-herdr-fleet-content">
              {visibleError && (
                <div role="alert" className="quick-toolbar-error">
                  {visibleError}
                </div>
              )}
              {!runtimeLoading && runtime && runtime.status !== "disabled" && !ready && (
                <div className="quick-toolbar-empty quick-herdr-fleet-hint" data-quick-toolbar-row>
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
                    className="quick-toolbar-action"
                    onClick={() => void retryConnection()}
                  >
                    {retrying ? t("connecting", "Connecting…") : t("retryConnection", "Retry connection")}
                  </button>
                </div>
              )}
              {showEmpty && (
                <div className="quick-toolbar-empty" data-quick-toolbar-row>
                  {t("noHerdrPanes", "This Herdr Session has no panes yet.")}
                </div>
              )}
              {hasFleet && visiblePaneIds.size === 0 && (
                <div className="quick-toolbar-empty">
                  {t("noHerdrPanesForState", "No panes match this agent state.")}
                </div>
              )}
              {hasFleet &&
                fleet?.workspaces.map((workspace) => {
                  const visibleTabs = workspace.tabs
                    .map((tab) => ({
                      tab,
                      panes: tab.paneIds
                        .filter((paneId) => visiblePaneIds.has(paneId))
                        .flatMap((paneId) => {
                          const pane = fleet.panes.find((item) => item.id === paneId);
                          return pane ? [pane] : [];
                        }),
                    }))
                    .filter(({ panes }) => panes.length > 0);
                  if (visibleTabs.length === 0) return null;
                  return (
                    <section key={workspace.id} className="quick-herdr-fleet-workspace" data-stale={fleet.stale}>
                      <h3>
                        <Layers3 size={13} aria-hidden="true" />
                        <span title={workspace.name || workspace.id}>{workspace.name || workspace.id}</span>
                      </h3>
                      {visibleTabs.map(({ tab, panes }) => {
                        const tabLabel = t("herdrTabName", "Tab {name}").replace("{name}", () => tab.name || tab.id);
                        return (
                          <div key={tab.id} className="quick-herdr-fleet-tab">
                            <div className="quick-herdr-fleet-tab-name" title={tabLabel}>
                              {tabLabel}
                            </div>
                            {panes.map((pane) => {
                              const state = pane.agent?.state ?? "unknown";
                              const invokedByChat = Boolean(pane.agent && chatPaneIds.has(pane.id));
                              const PaneIcon = pane.agent ? Bot : Terminal;
                              const shell = t("shellPane", "Shell pane");
                              const name = pane.agent?.name || pane.title || pane.id || shell;
                              return (
                                <div
                                  key={pane.id}
                                  className="quick-herdr-fleet-pane"
                                  data-herdr-pane={pane.id}
                                  data-quick-toolbar-row
                                  data-fleet-state={state}
                                  data-focused={pane.focused}
                                  data-invoked-by-chat={invokedByChat || undefined}
                                >
                                  <span className="quick-toolbar-mark" aria-hidden="true">
                                    <PaneIcon size={15} />
                                  </span>
                                  <div className="quick-herdr-fleet-copy">
                                    <div className="quick-herdr-fleet-pane-name" title={name}>
                                      {name}
                                    </div>
                                    <div className="quick-herdr-fleet-pane-meta">
                                      <span className="quick-herdr-fleet-pane-kind">{pane.agent?.kind ?? shell}</span>
                                      {invokedByChat && (
                                        <span className="quick-herdr-fleet-chat-badge">
                                          {t("herdrInvokedByChat", "Called by this chat")}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="quick-herdr-fleet-state">
                                    {pane.agent ? stateLabel(state) : shell}
                                  </span>
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
