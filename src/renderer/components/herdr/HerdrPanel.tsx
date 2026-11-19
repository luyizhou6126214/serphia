import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  AppWindow,
  ChevronDown,
  Folder,
  FolderPlus,
  Layers2,
  ListFilter,
  PanelTop,
  Pencil,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import type { HerdrAgentState, HerdrPane, HerdrRuntimeSnapshot, HerdrTab } from "@contract/herdr";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { useHerdrRuntime } from "@/hooks/useHerdrRuntime";
import { useHerdrFleet } from "@/hooks/useHerdrFleet";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { getFileName } from "@/lib/file-paths";
import { herdrErrorLabel, herdrRuntimeStatusLabel } from "./herdr-ui-copy";
import { HerdrPaneView } from "./HerdrPaneView";
import "./HerdrPanel.css";

gsap.registerPlugin(useGSAP);
type OpenSettings = (tab: "herdr" | "tools") => void;

function Toolbar({
  children,
  runtime,
  onSettings,
}: {
  children?: ReactNode;
  runtime: HerdrRuntimeSnapshot | null;
  onSettings: OpenSettings;
}) {
  const { t } = useI18n();
  return (
    <header className="hd-toolbar">
      <h1>
        <Layers2 size={16} strokeWidth={1.8} />
        Herdr
      </h1>
      {children}
      <span className="hd-connection" role="status" title={runtime?.sessionName}>
        <i data-ready={runtime?.status === "ready"} />
        {herdrRuntimeStatusLabel(runtime?.status, t)}
      </span>
      <button
        className="hd-icon"
        onClick={() => onSettings("herdr")}
        aria-label={t("hdSettings", "Herdr settings")}
        title={t("hdSettings", "Herdr settings")}
      >
        <Settings2 size={15} />
      </button>
    </header>
  );
}

export default function HerdrPanel({
  onSettings,
  workStepDisplay,
}: {
  onSettings: OpenSettings;
  workStepDisplay?: WorkStepDisplay;
}) {
  const { t } = useI18n();
  const { runtime, loading, error, refresh } = useHerdrRuntime();
  const [connecting, setConnecting] = useState(false);
  const [issue, setIssue] = useState<string>();
  const needsInstall =
    runtime?.mode === "managed" &&
    ["HERDR_BINARY_NOT_FOUND", "HERDR_BINARY_INTEGRITY_FAILED"].includes(runtime.error?.code ?? "");
  const waiting =
    (!runtime && loading) || ["probing", "starting", "connecting", "reconnecting"].includes(runtime?.status ?? "");
  async function connect() {
    setConnecting(true);
    setIssue(undefined);
    try {
      if (runtime) await call("herdr.runtime.connect");
      await refresh();
    } catch (e) {
      setIssue(herdrErrorLabel(e, t));
    } finally {
      setConnecting(false);
    }
  }
  return (
    <main className="hd-panel" aria-label="Herdr">
      {runtime?.capabilities.readOnly ? (
        <Desk
          key={JSON.stringify([runtime.sourceGeneration, runtime.mode, runtime.sessionName])}
          runtime={runtime}
          workStepDisplay={workStepDisplay}
          onSettings={onSettings}
        />
      ) : (
        <>
          <Toolbar runtime={runtime} onSettings={onSettings} />
          <div className="hd-blank">
            <AppWindow size={27} strokeWidth={1.35} />
            <h2>{waiting ? t("loadingHerdr", "Loading Herdr…") : t("hdConnectTitle", "Connect to Herdr")}</h2>
            <p>
              {issue ??
                (runtime?.error || error
                  ? herdrErrorLabel(runtime?.error ?? error, t)
                  : t(
                      "hdConnectHint",
                      "Connect a local Herdr session to see its agents, read their output and reply.",
                    ))}
            </p>
            {!waiting && (
              <button
                className="hd-primary"
                disabled={connecting}
                onClick={
                  needsInstall
                    ? () => onSettings("tools")
                    : runtime?.status === "disabled"
                      ? () => onSettings("herdr")
                      : () => void connect()
                }
              >
                {needsInstall
                  ? t("developerTools", "Developer Tools")
                  : runtime?.status === "disabled"
                    ? t("hdConfigure", "Set up connection")
                    : t("retryConnection", "Retry connection")}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function paneIdentity(pane: HerdrPane) {
  return JSON.stringify([pane.id, pane.terminalId, pane.agent?.kind ?? "shell"]);
}

function Desk({
  runtime,
  onSettings,
  workStepDisplay,
}: {
  runtime: HerdrRuntimeSnapshot;
  onSettings: OpenSettings;
  workStepDisplay?: WorkStepDisplay;
}) {
  const { t } = useI18n();
  const { fleet, error, loading, refresh } = useHerdrFleet(true);
  const [selection, setSelection] = useState<{ workspaceId: string; tabId: string; paneId: string }>();
  const [zoom, setZoom] = useState<string>();
  const [filter, setFilter] = useState<HerdrAgentState | "all">("all");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, "chat" | "terminal">>({});
  const root = useRef<HTMLDivElement>(null);
  const navigator = useRef<HTMLDetailsElement>(null);
  const workspaces = fleet?.workspaces ?? [];
  const panes = fleet?.panes ?? [];
  const ws =
    workspaces.find((w) => w.id === selection?.workspaceId) ?? workspaces.find((w) => w.focused) ?? workspaces[0];
  const tab = ws?.tabs.find((v) => v.id === selection?.tabId) ?? ws?.tabs.find((v) => v.focused) ?? ws?.tabs[0];
  const group = panes.filter((p) => p.tabId === tab?.id && p.workspaceId === ws?.id);
  const focused = group.find((p) => p.id === selection?.paneId) ?? group.find((p) => p.focused) ?? group[0];
  const zoomed = group.find((p) => p.id === zoom);
  const visible = zoomed ? [zoomed] : group;
  const ready = runtime.status === "ready" && !!fleet && !fleet.stale;
  const writable = ready && !busy;
  const labels = {
    all: t("allStates", "All states"),
    blocked: t("hdNeedsInput", "Needs input"),
    working: t("herdrStateWorking", "Working"),
    done: t("herdrStateDone", "Done"),
    idle: t("herdrStateIdle", "Idle"),
    unknown: t("herdrStateUnknown", "Unknown"),
  };
  const paneName = (p: HerdrPane) => p.agent?.name || p.agent?.kind || p.title || t("shellPane", "Shell pane");
  const tabName = (v: HerdrTab) =>
    !v.name || /^\d+$/.test(v.name) ? t("herdrTabName", "Tab {name}").replace("{name}", v.name || v.id) : v.name;
  const matches = panes.filter((p) => filter === "all" || p.agent?.state === filter);

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await action();
    } catch (e) {
      setIssue(herdrErrorLabel(e, t));
    } finally {
      setBusy(false);
    }
  }
  function pick(p: HerdrPane) {
    setSelection({ workspaceId: p.workspaceId, tabId: p.tabId, paneId: p.id });
  }
  function focus(p: HerdrPane) {
    pick(p);
    if (ready && !p.focused)
      void call("herdr.pane.focus", { paneId: p.id }).catch((e) => setIssue(herdrErrorLabel(e, t)));
  }
  function chooseTab(v: HerdrTab) {
    const preferred = panes.find((p) => p.tabId === v.id && p.focused);
    setSelection({ workspaceId: v.workspaceId, tabId: v.id, paneId: preferred?.id ?? v.paneIds[0] ?? "" });
    setZoom(undefined);
    setRenaming(undefined);
    if (ready && fleet?.focusedTabId !== v.id)
      void call("herdr.tab.focus", { tabId: v.id }).catch((e) => setIssue(herdrErrorLabel(e, t)));
  }
  async function chooseDirectory() {
    const cwd = await window.piBridge.selectDirectory();
    if (cwd) await call("system.allowRoot", { path: cwd });
    return cwd;
  }
  function createWorkspace() {
    void act(async () => {
      const cwd = await chooseDirectory();
      if (!cwd) return;
      const result = await call("herdr.workspace.create", { cwd, name: getFileName(cwd) || undefined });
      setZoom(undefined);
      setSelection({ workspaceId: result.workspaceId, tabId: "", paneId: result.rootPaneId });
    });
  }
  function createTab() {
    if (!ws) return;
    const workspaceId = ws.id;
    void act(async () => {
      const cwd = focused?.foregroundCwd ?? focused?.cwd;
      async function create() {
        if (cwd) {
          try {
            return await call("herdr.tab.create", { workspaceId, cwd });
          } catch (e) {
            if (!/forbidden|access denied|not authorized/i.test(String(e))) throw e;
          }
        }
        const picked = await chooseDirectory();
        return picked ? call("herdr.tab.create", { workspaceId, cwd: picked }) : null;
      }
      const result = await create();
      if (result) {
        setSelection({ ...result, paneId: result.rootPaneId });
        setZoom(undefined);
      }
    });
  }
  function closeTab(v: HerdrTab) {
    if (
      window.confirm(
        t("herdrCloseTabConfirm", "Close “{name}”? All panes in this tab and their running tasks will stop.").replace(
          "{name}",
          () => tabName(v),
        ),
      )
    )
      void act(async () => {
        await call("herdr.tab.close", { tabId: v.id });
      });
  }

  useGSAP(
    () => {
      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        const cells = root.current?.querySelectorAll(".hd-window");
        if (cells?.length)
          gsap.from(cells, {
            y: 9,
            opacity: 0.48,
            duration: 0.32,
            ease: "power3.out",
            stagger: 0.035,
            clearProps: "transform,opacity",
          });
      });
      return () => motion.revert();
    },
    { scope: root, dependencies: [tab?.id, zoomed?.id, group.length], revertOnUpdate: true },
  );
  useGSAP(
    () => {
      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        const light = root.current?.querySelector(".hd-window[data-focused=true] .hd-focus-light");
        if (light)
          gsap.fromTo(
            light,
            { scaleX: 0.04, opacity: 1 },
            { scaleX: 1, opacity: 0, duration: 0.8, ease: "power3.out" },
          );
      });
      return () => motion.revert();
    },
    { scope: root, dependencies: [focused?.id], revertOnUpdate: true },
  );
  useEffect(() => {
    root.current?.querySelector(".hd-tab[data-current=true]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab?.id]);
  useEffect(() => {
    function dismiss(e: PointerEvent) {
      if (navigator.current && !navigator.current.contains(e.target as Node)) navigator.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const rects = visible.map((p) => p.rect);
  const tiled = visible.length > 1 && rects.every((r) => !!r);
  const left = tiled ? Math.min(...rects.map((r) => r!.x)) : 0;
  const top = tiled ? Math.min(...rects.map((r) => r!.y)) : 0;
  const width = tiled ? Math.max(...rects.map((r) => r!.x + r!.width)) - left : 1;
  const height = tiled ? Math.max(...rects.map((r) => r!.y + r!.height)) - top : 1;
  const message =
    issue ?? (error ? herdrErrorLabel(error, t) : fleet?.stale ? t("herdrSnapshotStale", "Snapshot stale") : null);
  return (
    <div className="hd-desk" ref={root}>
      <Toolbar runtime={runtime} onSettings={onSettings}>
        {ws && (
          <>
            <span className="hd-divider" />
            <label className="hd-workspace-picker">
              <Folder size={14} />
              <span>{ws.name || ws.id}</span>
              <ChevronDown size={12} />
              <select
                aria-label={t("workspaces", "Workspaces")}
                value={ws.id}
                onChange={(e) => {
                  const next = workspaces.find((w) => w.id === e.target.value);
                  const v = next?.tabs.find((v) => v.focused) ?? next?.tabs[0];
                  if (v) chooseTab(v);
                  else if (next) setSelection({ workspaceId: next.id, tabId: "", paneId: "" });
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name || w.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="hd-icon"
              disabled={!writable}
              aria-label={t("hdNewWorkspace", "New workspace")}
              title={t("hdNewWorkspace", "New workspace")}
              onClick={createWorkspace}
            >
              <FolderPlus size={15} />
            </button>
          </>
        )}
        <div className="hd-spacer" />
        {!!panes.length && (
          <details
            className="hd-navigator"
            ref={navigator}
            onKeyDown={(e) => {
              if (e.key === "Escape" && navigator.current) {
                navigator.current.open = false;
                navigator.current.querySelector("summary")?.focus();
              }
            }}
          >
            <summary title={t("hdWindows", "Windows")} aria-label={t("hdWindows", "Windows")}>
              <ListFilter size={15} />
              <span>{t("hdWindows", "Windows")}</span>
            </summary>
            <div className="hd-popover">
              <select
                value={filter}
                aria-label={t("filterAgentState", "Filter agent state")}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
              >
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {matches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setZoom(undefined);
                    focus(p);
                    if (navigator.current) navigator.current.open = false;
                  }}
                >
                  <i className="hd-dot" data-state={p.agent?.state} />
                  <span>
                    {paneName(p)}
                    <small>
                      {workspaces.find((w) => w.id === p.workspaceId)?.name || p.workspaceId} / {p.tabId}
                    </small>
                  </span>
                </button>
              ))}
              {!matches.length && <p>{t("noHerdrPanesForState", "No panes match this agent state.")}</p>}
            </div>
          </details>
        )}
      </Toolbar>
      {ws && (
        <nav className="hd-tabbar" aria-label={t("hdTabs", "Workspace tabs")}>
          <div className="hd-tabscroll">
            {ws.tabs.map((v, index) => (
              <div key={v.id} className="hd-tab" data-current={v.id === tab?.id}>
                {renaming === v.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
                      setRenaming(undefined);
                      if (name && name !== v.name)
                        void act(async () => {
                          await call("herdr.tab.rename", { tabId: v.id, name });
                        });
                    }}
                  >
                    <input
                      autoFocus
                      name="name"
                      maxLength={256}
                      defaultValue={v.name || tabName(v)}
                      aria-label={t("hdRenameTab", "Rename tab")}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => setRenaming(undefined)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenaming(undefined);
                      }}
                    />
                  </form>
                ) : (
                  <button
                    className="hd-tab-pick"
                    aria-current={v.id === tab?.id ? "page" : undefined}
                    onClick={() => chooseTab(v)}
                    onDoubleClick={() => writable && setRenaming(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === "F2" && writable) {
                        e.preventDefault();
                        setRenaming(v.id);
                      }
                      const nextIndex = {
                        ArrowLeft: (index + ws.tabs.length - 1) % ws.tabs.length,
                        ArrowRight: (index + 1) % ws.tabs.length,
                        Home: 0,
                        End: ws.tabs.length - 1,
                      }[e.key];
                      if (nextIndex !== undefined) {
                        e.preventDefault();
                        chooseTab(ws.tabs[nextIndex]);
                        root.current?.querySelectorAll<HTMLButtonElement>(".hd-tab-pick")[nextIndex]?.focus();
                      }
                    }}
                  >
                    <PanelTop size={14} />
                    <span>{tabName(v)}</span>
                  </button>
                )}
                {tab?.id === v.id && !renaming && (
                  <>
                    <button
                      className="hd-tab-action hd-rename"
                      disabled={!writable}
                      onClick={() => setRenaming(v.id)}
                      title={t("hdRenameTab", "Rename tab")}
                      aria-label={t("hdRenameTab", "Rename tab")}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      className="hd-tab-action"
                      disabled={!writable}
                      onClick={() => closeTab(v)}
                      aria-label={t("herdrCloseTab", "Close tab “{name}”").replace("{name}", () => tabName(v))}
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <button
            className="hd-icon hd-addtab"
            disabled={!writable}
            onClick={createTab}
            title={t("hdNewTab", "New tab")}
            aria-label={t("hdNewTab", "New tab")}
          >
            <Plus size={15} />
          </button>
        </nav>
      )}
      {message && (
        <div className="hd-notice" role="alert">
          {message}
          <button
            onClick={() => {
              setIssue(undefined);
              void refresh();
            }}
          >
            {t("retryUpdate", "Retry")}
          </button>
        </div>
      )}
      {!visible.length ? (
        <div className="hd-blank">
          <div className="hd-window-glyph" aria-hidden="true">
            <i />
            <i />
          </div>
          <h2>{loading && !fleet ? t("loadingHerdr", "Loading Herdr…") : t("hdEmpty", "Start a workspace")}</h2>
          <p>{t("hdEmptyHint", "Choose a project folder to open your first agent window.")}</p>
          <button className="hd-primary" disabled={!writable} onClick={ws ? createTab : createWorkspace}>
            <Plus size={14} />
            {ws ? t("hdNewTab", "New tab") : t("hdNewWorkspace", "New workspace")}
          </button>
        </div>
      ) : (
        <div className="hd-canvas-scroll">
          <div
            className="hd-canvas"
            data-tiled={tiled}
            data-many={visible.length > 1}
            style={
              {
                "--hd-cols": Math.min(visible.length, 2),
                "--hd-min-w": tiled ? Math.ceil((width / Math.min(...rects.map((r) => r!.width))) * 224) + "px" : "0px",
                "--hd-min-h": tiled
                  ? Math.ceil((height / Math.min(...rects.map((r) => r!.height))) * 245) + "px"
                  : Math.ceil(visible.length / 2) * 245 + "px",
              } as CSSProperties
            }
          >
            {visible.map((p) => {
              const id = paneIdentity(p);
              const rect = p.rect;
              const style =
                tiled && rect
                  ? {
                      left: (100 * (rect.x - left)) / width + "%",
                      top: (100 * (rect.y - top)) / height + "%",
                      width: (100 * rect.width) / width + "%",
                      height: (100 * rect.height) / height + "%",
                    }
                  : undefined;
              return (
                <HerdrPaneView
                  key={id}
                  pane={p}
                  style={style}
                  title={paneName(p)}
                  workStepDisplay={workStepDisplay}
                  stateLabel={p.agent ? labels[p.agent.state] : undefined}
                  runtime={runtime}
                  active={ready}
                  focused={focused?.id === p.id}
                  onFocus={() => {
                    if (focused?.id !== p.id) focus(p);
                  }}
                  zoomed={!!zoomed}
                  canZoom={group.length > 1}
                  onZoom={() => {
                    pick(p);
                    setZoom(zoomed ? undefined : p.id);
                  }}
                  onSplit={(direction) =>
                    void act(async () => {
                      const result = await call("herdr.pane.split", { paneId: p.id, direction });
                      setSelection({ ...p, paneId: result.paneId });
                      setZoom(undefined);
                    })
                  }
                  layoutBusy={busy}
                  mode={modes[id] ?? "chat"}
                  setMode={(mode) => setModes((prev) => ({ ...prev, [id]: mode }))}
                  draft={drafts[id] ?? ""}
                  setDraft={(text) =>
                    setDrafts((prev) => ({ ...prev, [id]: typeof text === "function" ? text(prev[id] ?? "") : text }))
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
