import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { CharacterMark } from "@aora-bot/react";
import "@aora-bot/react/styles.css";
import {
  Columns2,
  Keyboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  Play,
  Rows2,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  type HerdrConversation,
  type HerdrPane,
  type HerdrRuntimeSnapshot,
  type HerdrStartableAgentKind,
} from "@contract/herdr";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { HerdrChatInput } from "./conversation/HerdrChatInput";
import { HerdrConversationView } from "./conversation/HerdrConversationView";
import { HerdrConversationWelcome } from "./conversation/HerdrConversationWelcome";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { HerdrTerminal } from "./HerdrTerminal";
import { HerdrAgentSelect } from "./HerdrAgentSelect";
import { HerdrAgentIcon } from "./HerdrAgentIcon";
import { herdrErrorLabel } from "./herdr-ui-copy";

interface Props {
  pane: HerdrPane;
  title: string;
  workStepDisplay?: WorkStepDisplay;
  stateLabel?: string;
  runtime: HerdrRuntimeSnapshot;
  active: boolean;
  focused: boolean;
  zoomed: boolean;
  canZoom: boolean;
  layoutBusy: boolean;
  onFocus: () => void;
  onZoom: () => void;
  onSplit: (direction: "horizontal" | "vertical") => void;
  style?: CSSProperties;
  selectPortal: RefObject<HTMLDivElement | null>;
  mode: "chat" | "terminal";
  setMode: (mode: "chat" | "terminal") => void;
  draft: string;
  setDraft: (text: string | ((previous: string) => string)) => void;
}

export function HerdrPaneView({
  pane,
  title,
  workStepDisplay,
  stateLabel,
  runtime,
  active,
  focused,
  zoomed,
  canZoom,
  layoutBusy,
  onFocus,
  onZoom,
  onSplit,
  style,
  selectPortal,
  mode,
  setMode,
  draft,
  setDraft,
}: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<HerdrStartableAgentKind>("pi");
  const [control, setControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [issue, setIssue] = useState<string>();
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<{ text: string; version: number }>();
  const acknowledge = useCallback((loadedVersion: number) => {
    setPending((current) => (current && current.version <= loadedVersion ? undefined : current));
  }, []);
  const menu = useRef<HTMLDetailsElement>(null);
  const writable = active && runtime.capabilities.agentControl && !busy;
  const working = pane.agent?.state === "working";
  const [needsChoice, setNeedsChoice] = useState(false);
  const blocked = pane.agent?.state === "blocked" || needsChoice;
  const displayedState = blocked ? t("hdNeedsInput", "Needs input") : stateLabel;
  const waiting = pane.agent?.launchPending && !(pane.agent.kind === "pi" && pane.agent.state === "idle");
  const canSend = writable && !!pane.agent && !blocked && !waiting;
  const hint =
    !active || !runtime.capabilities.agentControl
      ? t("hdDraftOffline", "Draft saved here until the connection is ready")
      : blocked
        ? t("hdNeedsInput", "Needs input")
        : waiting
          ? t("hdAgentStarting", "Waiting for the agent to start")
          : undefined;
  const index = pane.id.match(/:p(\d+)$/)?.[1] ?? pane.id;
  const name = pane.agent ? title : pane.title || t("hdWindowNumber", "Window {n}").replace("{n}", index);
  const chatLabel = t("hdChat", "Chat");
  const screenLabel = t("hdScreen", "Screen");
  const source = JSON.stringify([pane.terminalId, pane.agent?.kind, pane.agent?.session?.displayValue]);
  useEffect(() => {
    const element = menu.current;
    function outside(e: PointerEvent) {
      if (element?.open && !element.contains(e.target as Node)) element.open = false;
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setIssue(undefined);
    try {
      await operation();
    } catch (e) {
      setIssue(herdrErrorLabel(e, t));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function send() {
    if (!draft.trim() || !canSend || lock.current) return;
    const text = draft;
    setDraft("");
    setPending({ text, version: version + 1 });
    void act(async () => {
      try {
        await call("herdr.pane.chat", { paneId: pane.id, prompt: text });
        setVersion(version + 1);
      } catch (error) {
        setDraft((previous) => (previous ? text + "\n\n" + previous : text));
        setPending(undefined);
        throw error;
      }
    });
  }
  function close() {
    if (
      !window.confirm(
        t("herdrClosePaneConfirm", "Close “{name}”? Tasks running in this pane will stop.").replace(
          "{name}",
          () => name,
        ),
      )
    )
      return;
    void act(async () => {
      await call("herdr.pane.close", { paneId: pane.id });
    });
  }
  function afterMenu(action: () => void) {
    if (menu.current) menu.current.open = false;
    action();
  }
  function switchMode(value: "chat" | "terminal") {
    setControl(false);
    setMode(value);
  }
  return (
    <div className="hd-cell" style={style}>
      <article
        className="hd-window chat-appearance-scope"
        data-focused={focused}
        onPointerDownCapture={onFocus}
        onFocusCapture={onFocus}
        aria-label={name}
      >
        <header className="hd-pane-head">
          {pane.agent ? <HerdrAgentIcon kind={pane.agent.kind} size={15} /> : <TerminalSquare size={15} />}
          <strong title={pane.foregroundCwd || pane.cwd}>{name}</strong>
          {pane.agent && (
            <span className="hd-state" title={displayedState}>
              <i className="hd-dot" data-state={blocked ? "blocked" : pane.agent.state} />
              <small>{displayedState}</small>
            </span>
          )}
          <div className="hd-spacer" />
          <div className="hd-switch" role="group" aria-label={name}>
            <button
              aria-pressed={mode === "chat"}
              aria-label={chatLabel}
              title={chatLabel}
              onClick={() => switchMode("chat")}
            >
              <MessageSquare size={13} />
              <span>{chatLabel}</span>
            </button>
            <button
              aria-pressed={mode === "terminal"}
              aria-label={screenLabel}
              title={screenLabel}
              onClick={() => switchMode("terminal")}
            >
              <TerminalSquare size={13} />
              <span>{screenLabel}</span>
            </button>
          </div>
          <button
            className="hd-icon hd-split"
            disabled={!active || layoutBusy}
            aria-label={t("hdSplitRight", "Split right")}
            title={t("hdSplitRight", "Split right")}
            onClick={() => onSplit("horizontal")}
          >
            <Columns2 size={14} />
          </button>
          <details
            ref={menu}
            className="hd-window-menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") afterMenu(() => menu.current?.querySelector("summary")?.focus());
            }}
          >
            <summary
              className="hd-icon"
              aria-label={t("hdWindowActions", "Window actions")}
              title={t("hdWindowActions", "Window actions")}
            >
              <MoreHorizontal size={16} />
            </summary>
            <div className="hd-popover">
              <button disabled={!active || layoutBusy} onClick={() => afterMenu(() => onSplit("horizontal"))}>
                <Columns2 size={14} />
                {t("hdSplitRight", "Split right")}
              </button>
              <button disabled={!active || layoutBusy} onClick={() => afterMenu(() => onSplit("vertical"))}>
                <Rows2 size={14} />
                {t("hdSplitBelow", "Split below")}
              </button>
              {canZoom && (
                <button onClick={() => afterMenu(onZoom)}>
                  {zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{" "}
                  {zoomed ? t("hdRestore", "Show all windows") : t("hdMaximize", "Expand window")}
                </button>
              )}
              <button disabled={!active || busy} onClick={() => afterMenu(close)}>
                <X size={14} />
                {t("hdClose", "Close pane")}
              </button>
            </div>
          </details>
        </header>
        {issue && (
          <div className="hd-notice" role="alert">
            {issue}
            <button aria-label={t("hdDismiss", "Dismiss")} onClick={() => setIssue(undefined)}>
              <X size={12} />
            </button>
          </div>
        )}
        {mode === "terminal" ? (
          <>
            {active && runtime.capabilities.terminalObserve ? (
              <>
                <div className="hd-terminal-tools">
                  <span>{control ? t("hdControl", "Keyboard control") : t("hdObserve", "Observe mode")}</span>
                  <button disabled={!runtime.capabilities.terminalControl} onClick={() => setControl((b) => !b)}>
                    <Keyboard size={13} />
                    {control ? t("hdObserve", "Observe mode") : t("hdControl", "Keyboard control")}
                  </button>
                </div>
                <HerdrTerminal
                  key={String(control)}
                  paneId={pane.id}
                  mode={control ? "control" : "observe"}
                  releaseOnClose={runtime.releaseControlOnViewClose}
                />
              </>
            ) : (
              <Transcript paneId={pane.id} source={source} enabled={active} version={0} name={name} screen />
            )}
          </>
        ) : !pane.agent ? (
          <div className="hd-launch">
            <div className="hd-agent-mark" aria-hidden="true">
              <CharacterMark shape="circle" color="violet" state="happy" face="capsule" sizePx={96} autoPause />
            </div>
            <h2>{t("hdStartChat", "Start an agent conversation")}</h2>
            <div className="hd-launch-controls">
              <HerdrAgentSelect
                value={kind}
                onChange={setKind}
                disabled={!writable}
                label={t("hdAgentType", "Agent type")}
                portal={selectPortal}
              />
              <button
                className="hd-primary"
                disabled={!writable}
                onClick={() =>
                  void act(async () => {
                    await call("herdr.agent.start", { paneId: pane.id, kind });
                  })
                }
              >
                <Play size={12} />
                {t("hdStart", "Start agent")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <Transcript
              key={source}
              paneId={pane.id}
              source={source}
              enabled={active}
              version={version}
              name={name}
              emptyState={<HerdrConversationWelcome kind={pane.agent.kind} name={name} />}
              working={working}
              cwd={pane.foregroundCwd ?? pane.cwd}
              workStepDisplay={workStepDisplay}
              pending={pending?.text}
              onRead={acknowledge}
              onChoice={setNeedsChoice}
            />
            {blocked && (
              <section className="hd-decision" aria-label={displayedState}>
                <div className="hd-decision-bar">
                  <span>
                    <i className="hd-dot" data-state="blocked" />
                    {t("hdNeedsInput", "Needs input")}
                  </span>
                  {(
                    [
                      ["up", "↑", t("hdPreviousOption", "Previous option")],
                      ["down", "↓", t("hdNextOption", "Next option")],
                      ["esc", "Esc", t("hdEscape", "Send Escape")],
                      ["enter", "Enter", t("hdConfirmOption", "Confirm selection")],
                    ] as const
                  ).map(([key, caption, label]) => (
                    <button
                      key={key}
                      type="button"
                      title={label}
                      aria-label={label}
                      disabled={!writable}
                      onClick={() =>
                        void act(async () => {
                          await call("herdr.agent.sendKeys", { paneId: pane.id, keys: [key] });
                          setVersion((n) => n + 1);
                        })
                      }
                    >
                      {caption}
                    </button>
                  ))}
                </div>
                <Transcript
                  paneId={pane.id}
                  source={source}
                  enabled={active}
                  version={version}
                  name={name}
                  screen
                  compact
                />
              </section>
            )}
            <HerdrChatInput
              value={draft}
              onChange={setDraft}
              onSend={send}
              canSend={canSend}
              agent={pane.agent.kind}
              agentName={name}
              state={blocked ? "blocked" : pane.agent.state}
              working={working}
              hint={hint}
              canInterrupt={writable}
              onInterrupt={() =>
                void act(async () => {
                  await call("herdr.agent.sendKeys", { paneId: pane.id, keys: ["ctrl+c"] });
                })
              }
            />
          </>
        )}
      </article>
    </div>
  );
}

function Transcript({
  paneId,
  source,
  enabled,
  version,
  name,
  emptyState,
  screen = false,
  compact = false,
  working = false,
  cwd,
  workStepDisplay,
  pending,
  onRead,
  onChoice,
}: {
  paneId: string;
  source: string;
  enabled: boolean;
  version: number;
  name: string;
  emptyState?: ReactNode;
  screen?: boolean;
  compact?: boolean;
  working?: boolean;
  cwd?: string;
  workStepDisplay?: WorkStepDisplay;
  pending?: string;
  onRead?: (loadedVersion: number) => void;
  onChoice?: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const [history, setHistory] = useState<HerdrConversation | null>(null);
  const [text, setText] = useState("");
  const [issue, setIssue] = useState<string>();
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const element = viewport.current;
    if (!enabled || !element) return;
    let disposed = false;
    let inView = true;
    let reading = false;
    async function read(force = false) {
      if (disposed || reading || (!force && (!inView || document.hidden))) return;
      reading = true;
      try {
        if (screen) {
          const result = await call("herdr.pane.read", { paneId, ...(compact ? { maxBytes: 4096 } : {}) });
          if (!disposed) setText(result.text);
        } else {
          const result = await call("herdr.pane.conversation", { paneId });
          if (!disposed) {
            setHistory((last) => (sameHistory(last, result) ? last : result));
            onChoice?.(!!result?.needsChoice);
            if (result) onRead?.(version);
          }
        }
        if (!disposed) setIssue(undefined);
      } catch (e) {
        if (!disposed) setIssue(herdrErrorLabel(e, t));
      } finally {
        reading = false;
      }
    }
    const wake = () => {
      void read();
    };
    const observer = new IntersectionObserver((entries) => {
      inView = !!entries.at(-1)?.isIntersecting;
      if (inView) wake();
    });
    observer.observe(element);
    void read(true);
    const timer = setInterval(wake, 1400);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      disposed = true;
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [compact, enabled, onChoice, onRead, paneId, screen, source, t, version]);
  useLayoutEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [history, text, pending]);
  return (
    <div
      className="hd-history"
      ref={viewport}
      aria-label={screen ? t("hdOutput", "Output") : t("hdChat", "Chat")}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 38;
      }}
    >
      {issue && (
        <p role="alert" className="hd-note">
          {issue}
        </p>
      )}
      {screen ? (
        <pre>{text || t("hdAwaitOutput", "Waiting for output…")}</pre>
      ) : (
        <div className="hd-thread">
          {history?.truncated && <p className="hd-note">{t("hdTail", "Showing recent output")}</p>}
          {!history?.messages.length && !pending && !working && emptyState}
          <HerdrConversationView
            rows={history?.messages ?? []}
            name={name}
            working={working}
            cwd={cwd}
            workStepDisplay={workStepDisplay}
            pending={pending}
          />
        </div>
      )}
    </div>
  );
}
function sameHistory(a: HerdrConversation | null, b: HerdrConversation | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.truncated === b.truncated &&
      a.messages.length === b.messages.length &&
      a.messages.every(
        (m, i) =>
          m.role === b.messages[i].role &&
          m.text === b.messages[i].text &&
          m.source === b.messages[i].source &&
          m.toolCallId === b.messages[i].toolCallId &&
          m.timestamp === b.messages[i].timestamp &&
          m.isError === b.messages[i].isError,
      ))
  );
}
