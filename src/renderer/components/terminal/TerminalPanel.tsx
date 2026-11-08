/**
 * One interactive terminal screen: a pty session in Main, rendered by xterm.
 * Mounting attaches to the retained output and the live stream; leaving the tab
 * only disposes the screen — the shell keeps running until the tab closes.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalEvent, TerminalSessionInfo } from "@contract/terminal";
import { useI18n } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import "./terminal.css";

/** Output coalescing window for screen fitting, in milliseconds. */
const RESIZE_DEBOUNCE_MS = 120;
/** One input frame stays below the Host's per-write input ceiling. */
const MAX_WRITE_CHARS = 60_000;

type TerminalPhase = "attaching" | "ready" | "missing" | "failed";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write one input frame in Host-sized pieces. */
function writeInput(terminalId: string, data: string): void {
  for (let offset = 0; offset < data.length; offset += MAX_WRITE_CHARS) {
    void window.piBridge.writeTerminal(terminalId, data.slice(offset, offset + MAX_WRITE_CHARS)).catch(() => undefined);
  }
}

/**
 * Draw one terminal session.
 * @param props - Host session id, visibility, and panel callbacks.
 * @returns the screen plus any pending, ended, or failed state.
 */
export function TerminalPanel({
  terminalId,
  visible,
  onTitleChange,
  onExited,
  onNewTerminal,
  onClose,
}: {
  terminalId: string;
  visible: boolean;
  onTitleChange?: (title: string) => void;
  onExited?: (exitCode: number | null) => void;
  onNewTerminal?: () => void;
  onClose?: () => void;
}): ReactNode {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [phase, setPhase] = useState<TerminalPhase>("attaching");
  const [info, setInfo] = useState<TerminalSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onTitleChange, onExited });
  callbacksRef.current = { onTitleChange, onExited };

  /** Fit the emulator to its container and report the size to the pty. */
  const fitAndReport = useCallback(() => {
    const xterm = terminalRef.current;
    const fit = fitRef.current;
    const element = elementRef.current;
    if (xterm === null || fit === null || element === null) return;
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    const dimensions = fit.proposeDimensions();
    if (dimensions === undefined || dimensions.cols < 2 || dimensions.rows < 1) return;
    xterm.resize(dimensions.cols, dimensions.rows);
    void window.piBridge.resizeTerminal(terminalId, dimensions.cols, dimensions.rows).catch(() => undefined);
  }, [terminalId]);

  // The emulator exists before the attach effect below runs: layout effects
  // commit in declaration order, and the attach effect needs a screen to write into.
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    const styles = getComputedStyle(element);
    const xterm = new Terminal({
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      scrollback: 5_000,
      theme: {
        background: styles.backgroundColor,
        foreground: styles.color,
        cursor: styles.color,
        cursorAccent: styles.backgroundColor,
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(element);
    terminalRef.current = xterm;
    fitRef.current = fit;
    const input = xterm.onData((data) => {
      writeInput(terminalId, data);
    });
    const title = xterm.onTitleChange((value) => {
      if (value.trim() !== "") callbacksRef.current.onTitleChange?.(value);
    });
    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null;
        fitAndReport();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      input.dispose();
      title.dispose();
      xterm.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [fitAndReport, terminalId]);

  // Attach: subscribe first so no frame is lost, then replay the retained output
  // and keep only frames newer than the sequence that output already covers.
  useEffect(() => {
    let disposed = false;
    let attached = false;
    let lastSeq = -1;
    const buffered: TerminalEvent[] = [];
    const apply = (event: TerminalEvent): void => {
      const xterm = terminalRef.current;
      if (event.type === "data") {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        xterm?.write(event.data);
        return;
      }
      if (event.type === "exited") {
        setInfo((current) => (current === null ? current : { ...current, state: "exited", exitCode: event.exitCode }));
        callbacksRef.current.onExited?.(event.exitCode);
        return;
      }
      setPhase("missing");
    };
    const unsubscribe = window.piBridge.onTerminalEvent((event) => {
      if (event.id !== terminalId) return;
      if (attached) apply(event);
      else buffered.push(event);
    });
    void window.piBridge
      .attachTerminal(terminalId)
      .then((result) => {
        if (disposed) return;
        const xterm = terminalRef.current;
        setInfo(result.info);
        lastSeq = result.seq;
        if (result.backlog !== "") xterm?.write(result.backlog);
        attached = true;
        for (const event of buffered.splice(0)) apply(event);
        setPhase("ready");
        fitAndReport();
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(messageOf(cause));
        setPhase("failed");
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [fitAndReport, terminalId]);

  // Re-theme on a light/dark switch without rebuilding the screen.
  useLayoutEffect(() => {
    const element = elementRef.current;
    const xterm = terminalRef.current;
    if (element === null || xterm === null) return;
    const styles = getComputedStyle(element);
    xterm.options.theme = {
      background: styles.backgroundColor,
      foreground: styles.color,
      cursor: styles.color,
      cursorAccent: styles.backgroundColor,
    };
  }, [isDark]);

  useEffect(() => {
    if (!visible) return;
    fitAndReport();
    terminalRef.current?.focus();
  }, [fitAndReport, visible]);

  const ended = info?.state === "exited";
  const showStatus = phase !== "ready" || ended;

  return (
    <div className="terminal-root">
      {showStatus && (
        <div className="terminal-status" role="status">
          {phase === "attaching" && <span>{t("rightPanelTerminalStarting", "Starting…")}</span>}
          {phase === "missing" && (
            <span>{t("rightPanelTerminalUnavailable", "This terminal is no longer available.")}</span>
          )}
          {phase === "failed" && (
            <span>{t("rightPanelTerminalUnavailable", "This terminal is no longer available.")}</span>
          )}
          {ended && (
            <span>
              {t("rightPanelTerminalExited", "Process exited ({code})").replace(
                "{code}",
                info?.exitCode === null || info?.exitCode === undefined ? "—" : String(info.exitCode),
              )}
            </span>
          )}
          {(phase === "missing" || phase === "failed" || ended) && onNewTerminal !== undefined && (
            <button type="button" className="terminal-status-button" onClick={onNewTerminal}>
              {t("rightPanelNewTerminal", "New terminal")}
            </button>
          )}
          {ended && onClose !== undefined && (
            <button type="button" className="terminal-status-button" onClick={onClose}>
              {t("rightPanelTerminalClose", "Close terminal")}
            </button>
          )}
        </div>
      )}
      <div className="terminal-screen" ref={elementRef} data-terminal-screen />
      {error !== null && phase === "failed" && (
        <p className="terminal-error" role="alert">
          {t("rightPanelTerminalFailed", "Could not start a terminal: {message}").replace("{message}", error)}
        </p>
      )}
    </div>
  );
}
