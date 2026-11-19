import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { HerdrTerminalFrame } from "@contract/herdr";
import { useI18n } from "@/i18n";
import { call, subscribe } from "@/lib/api-client";
import "@xterm/xterm/css/xterm.css";

export function HerdrTerminal({
  paneId,
  mode = "control",
  releaseOnClose = true,
}: {
  paneId: string;
  mode?: "observe" | "control";
  releaseOnClose?: boolean;
}) {
  const { language } = useI18n();
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    let disposed = false;
    let terminalId: string | undefined;
    let controller = false;
    let offFrame: (() => void) | undefined;
    let offStatus: (() => void) | undefined;
    const pending: HerdrTerminalFrame[] = [];
    let pendingBytes = 0;
    const colors = getComputedStyle(host);
    const terminal = new Terminal({
      cursorBlink: mode === "control",
      disableStdin: mode === "observe",
      scrollback: 3_000,
      fontSize: 13,
      minimumContrastRatio: 4.5,
      theme: { background: colors.backgroundColor, foreground: colors.color, cursor: colors.color },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const dimensions = () => {
      const size = fit.proposeDimensions();
      return { cols: Math.max(2, Math.min(size?.cols || 80, 300)), rows: Math.max(1, Math.min(size?.rows || 24, 120)) };
    };
    const fail = (reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    };
    const frame = (value: HerdrTerminalFrame) => {
      if (disposed) return;
      if (!terminalId) {
        pendingBytes += value.bytes.byteLength;
        if (pendingBytes <= 4 * 1024 * 1024 && pending.length < 256) pending.push(value);
        return;
      }
      if (value.terminalId !== terminalId) return;
      if (value.full) {
        terminal.resize(value.cols, value.rows);
        terminal.reset();
      }
      terminal.write(value.bytes, () => {
        if (!disposed) void call("herdr.terminal.ack", { terminalId: value.terminalId, seq: value.seq }).catch(fail);
      });
    };
    const resize = new ResizeObserver(() => {
      if (terminalId && controller) void call("herdr.terminal.resize", { terminalId, ...dimensions() }).catch(fail);
    });
    resize.observe(host);
    const encoder = new TextEncoder();
    const input = terminal.onData((data) => {
      if (!terminalId || !controller) return;
      const bytes = encoder.encode(data);
      for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
        void call("herdr.terminal.input", { terminalId, bytes: bytes.slice(offset, offset + 32 * 1024) }).catch(fail);
      }
    });
    void (async () => {
      offFrame = await subscribe("herdr.terminal.frame", "*", frame);
      if (disposed) {
        offFrame();
        return;
      }
      offStatus = await subscribe("herdr.terminal.status", "*", (status) => {
        if (status.terminalId !== terminalId) return;
        controller = status.controller;
        if (status.error) fail(status.error.message);
      });
      if (disposed) {
        offStatus();
        return;
      }
      const opened = await call("herdr.terminal.open", { paneId, mode, ...dimensions() });
      if (disposed) {
        await call("herdr.terminal.close", {
          terminalId: opened.terminalId,
          release: mode === "control" && releaseOnClose,
        });
        return;
      }
      terminalId = opened.terminalId;
      controller = opened.controller;
      for (const value of pending.splice(0)) frame(value);
      if (controller) terminal.focus();
      setReady(true);
    })().catch(fail);
    return () => {
      disposed = true;
      resize.disconnect();
      input.dispose();
      offFrame?.();
      offStatus?.();
      terminal.dispose();
      if (terminalId)
        void call("herdr.terminal.close", { terminalId, release: mode === "control" && releaseOnClose }).catch(
          () => undefined,
        );
    };
  }, [paneId, mode, releaseOnClose]);

  return (
    <div className="hd-terminal">
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        !ready && <p role="status">{language.startsWith("zh") ? "正在连接终端…" : "Connecting to terminal…"}</p>
      )}
      <div className="hd-terminal-screen" ref={element} />
    </div>
  );
}
