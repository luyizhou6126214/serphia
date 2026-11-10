import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Square } from "lucide-react";
import type { ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { call, subscribe } from "@/lib/api-client";
import { useI18n } from "@/i18n";

function duration(process: ManagedProcessPublicInfo, now: number): string {
  if (!process.startedAt) return "—";
  const seconds = Math.max(0, Math.floor(((process.stoppedAt ?? now) - process.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function SessionBackgroundTasks({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [processes, setProcesses] = useState<ManagedProcessPublicInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const root = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const snapshot = await call("processes.list", { includeExited: true });
      if (current !== request.current) return;
      revision.current = Math.max(revision.current, snapshot.revision);
      setProcesses(snapshot.processes.filter((item) => item.ownerSessionId === sessionId));
      setError(null);
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sessionId]);

  useEffect(() => {
    const requests = request;
    setProcesses([]);
    setOpen(false);
    revision.current = 0;
    void refresh();
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribe("processes.changed", "*", (event) => {
      if (event.revision > revision.current) void refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else {
          unsubscribe = fn;
          void refresh();
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      requests.current++;
      unsubscribe?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      clearInterval(timer);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const invoke = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const active = processes.filter((item) => isManagedProcessActiveState(item.state));
  const ended = processes.filter((item) => !isManagedProcessActiveState(item.state));
  const clearable = ended.filter((item) => item.state !== "lost");
  if (processes.length === 0 && !error) return null;

  return (
    <div className="session-background" ref={root}>
      <button type="button" className="session-background-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("backgroundTaskCount", "{count} background tasks").replace("{count}", String(processes.length))}
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="session-background-popover" role="region" aria-label={t("backgroundTasks", "Background tasks")}>
          {error && (
            <div className="session-background-error" role="alert">
              {error}
            </div>
          )}
          {([active, ended] as const).map(
            (group, index) =>
              group.length > 0 && (
                <section key={index}>
                  <div className="session-background-group">
                    <span>
                      {index === 0 ? t("backgroundRunning", "Running") : t("backgroundEnded", "Ended")} {group.length}
                    </span>
                    {index === 1 && clearable.length > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void invoke(async () => {
                            for (const item of clearable)
                              await call("processes.dismiss", { processId: item.processId });
                          })
                        }
                      >
                        {t("clearBackgroundTasks", "Clear")}
                      </button>
                    )}
                  </div>
                  {group.map((item) => (
                    <div className="session-background-item" key={item.processId}>
                      <div className="session-background-row">
                        <span className="session-background-dot" data-state={item.state} />
                        <span className="session-background-kind">{item.kind}</span>
                        <button
                          className="session-background-command"
                          type="button"
                          title={item.commandDisplay}
                          onClick={() => setExpanded(expanded === item.processId ? null : item.processId)}
                          aria-expanded={expanded === item.processId}
                        >
                          {item.commandDisplay}
                        </button>
                        <span className="session-background-status">
                          {item.state}
                          {item.exit ? ` · ${item.exit.code ?? item.exit.signal ?? item.exit.reason}` : ""}
                        </span>
                        <span className="session-background-duration">{duration(item, now)}</span>
                        {isManagedProcessActiveState(item.state) && (
                          <button
                            className="session-background-stop"
                            type="button"
                            disabled={busy || item.state === "stopping"}
                            aria-label={t("stopBackgroundTask", "Stop background task")}
                            title={t("stop", "Stop")}
                            onClick={() =>
                              void invoke(() =>
                                call("processes.stop", {
                                  processId: item.processId,
                                  runId: item.runId,
                                  mode: "graceful",
                                }),
                              )
                            }
                          >
                            <Square size={12} />
                          </button>
                        )}
                        <button
                          className="session-background-expand"
                          type="button"
                          aria-label={t("backgroundTaskDetails", "Task details")}
                          aria-expanded={expanded === item.processId}
                          onClick={() => setExpanded(expanded === item.processId ? null : item.processId)}
                        >
                          <ChevronDown size={13} />
                        </button>
                      </div>
                      {expanded === item.processId && (
                        <div className="session-background-details">
                          <code>{item.commandDisplay}</code>
                          <span>{item.cwdDisplay}</span>
                          {item.lastOutput && <pre>{item.lastOutput.text}</pre>}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              ),
          )}
        </div>
      )}
    </div>
  );
}
