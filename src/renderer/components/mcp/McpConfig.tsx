import { PlusOutlined } from "@ant-design/icons/es";
import { mcpAuthenticationMode } from "@shared/mcp-auth-mode";
import { mcpStateLabel, mcpLoginLabel } from "@/lib/mcp-state-label";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  McpConfigEntry,
  McpConfigurationSnapshot,
  McpPanelSnapshot,
  McpServerConfig,
  McpTarget,
  McpOAuthSnapshot,
  McpResourcePage,
} from "@contract/mcp";
import { call, subscribe } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { LatestRequestGate } from "@/lib/latest-request-gate";
import { McpServerEditor } from "./McpServerEditor";
import { McpToolsPanel } from "./McpToolsPanel";
import { McpActionMenu } from "./McpActionMenu";
import { McpServerRow } from "./McpServerRow";

export interface McpConfigHandle {
  requestLeave(action: () => void): void;
}
export const McpConfig = forwardRef<McpConfigHandle, { cwd: string | null; sessionId: string | null }>(
  function McpConfig({ cwd, sessionId }, ref) {
    const { t } = useI18n();
    const [snapshot, setSnapshot] = useState<McpConfigurationSnapshot>(),
      [panel, setPanel] = useState<McpPanelSnapshot>(),
      [selected, setSelected] = useState<{ name: string; extension: boolean }>(),
      [pendingToggle, setPendingToggle] = useState<{ name: string; enabled: boolean }>(),
      [editing, setEditing] = useState<{
        name: string;
        config: McpServerConfig;
        extension?: boolean;
        revision?: string;
      }>(),
      [dirty, setDirty] = useState(false),
      [busy, setBusy] = useState(false),
      [error, setError] = useState<string>(),
      [notice, setNotice] = useState<string>(),
      [pendingLeave, setPendingLeave] = useState<() => void>(),
      [probeId, setProbeId] = useState<string>(),
      [probe, setProbe] = useState<McpPanelSnapshot>(),
      [login, setLogin] = useState<McpOAuthSnapshot>(),
      [callbackUrl, setCallbackUrl] = useState(""),
      [resources, setResources] = useState<{ target: McpTarget; page: McpResourcePage }>(),
      [resourceText, setResourceText] = useState<string>(),
      [resourceRef, setResourceRef] = useState<{ hash: string; offset: number }>();
    const gate = useRef(new LatestRequestGate()).current,
      mounted = useRef(true),
      detail = useRef<HTMLDivElement>(null),
      addButton = useRef<HTMLButtonElement>(null),
      formOpener = useRef<"add" | "edit" | undefined>(undefined),
      requestId = useRef<string | undefined>(undefined),
      loginId = useRef<string | undefined>(undefined);
    const viewKey = JSON.stringify([cwd, sessionId]),
      view = useRef({ key: viewKey, generation: 0 });
    if (view.current.key !== viewKey) view.current = { key: viewKey, generation: view.current.generation + 1 };
    const viewGeneration = view.current.generation;
    const isCurrentView = () => mounted.current && view.current.generation === viewGeneration;
    const invoke: typeof call = async (method, ...args) => {
      const result = await call(method, ...args);
      if (!isCurrentView()) throw new Error("MCP view changed while the request was running");
      return result;
    };
    const target = (name: string): McpTarget => ({ name, scope: "global", cwd: cwd ?? undefined });
    const load = useCallback(async () => {
      if (!mounted.current || view.current.generation !== viewGeneration) return;
      const ticket = gate.begin();
      try {
        const [config, live] = await Promise.all([
          call("mcp.config.get", { scope: "global" }),
          sessionId ? call("mcp.snapshot", { sessionId }) : Promise.resolve(undefined),
        ]);
        if (!gate.isCurrent(ticket) || !mounted.current) return;
        setSnapshot(config);
        setPanel(live);
        setError(config.error ?? live?.error);
      } catch (e) {
        if (gate.isCurrent(ticket) && mounted.current) setError(e instanceof Error ? e.message : String(e));
      }
    }, [gate, sessionId, viewGeneration]);
    useEffect(() => {
      mounted.current = true;
      void load();
      const timer = setInterval(() => {
        void load();
      }, 3000);
      return () => {
        mounted.current = false;
        gate.invalidate();
        clearInterval(timer);
      };
    }, [gate, load]);
    useEffect(() => {
      if (!sessionId) return;
      let disposed = false;
      const offs: (() => void)[] = [];
      for (const promise of [
        subscribe("mcp.changed", sessionId, () => {
          void load();
        }),
        subscribe("mcp.oauth", sessionId, (status) => {
          if (!disposed && status.requestId === loginId.current) setLogin(status);
        }),
      ])
        void promise
          .then((off) => {
            if (disposed) off();
            else offs.push(off);
          })
          .catch(() => undefined);
      return () => {
        disposed = true;
        offs.forEach((off) => off());
      };
    }, [sessionId, load]);
    useEffect(() => {
      setSnapshot(undefined);
      setPanel(undefined);
      setProbe(undefined);
      setProbeId(undefined);
      setLogin(undefined);
      setResources(undefined);
      setResourceText(undefined);
      setResourceRef(undefined);
      setBusy(false);
      setPendingToggle(undefined);
      setNotice(undefined);
      return () => {
        if (requestId.current) void call("mcp.probe.cancel", { requestId: requestId.current }).catch(() => undefined);
        if (loginId.current) void call("mcp.oauth.cancel", { requestId: loginId.current }).catch(() => undefined);
        requestId.current = undefined;
        loginId.current = undefined;
      };
    }, [cwd, sessionId]);
    const leave = useCallback(
      (action: () => void) => {
        if (dirty) setPendingLeave(() => action);
        else action();
      },
      [dirty],
    );
    useImperativeHandle(ref, () => ({ requestLeave: leave }), [leave]);
    const run = async (operation: () => Promise<unknown>) => {
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        await operation();
        if (isCurrentView()) await load();
      } catch (e) {
        if (isCurrentView()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isCurrentView()) setBusy(false);
      }
    };
    const probeServer = (name: string) =>
      run(async () => {
        const id = crypto.randomUUID();
        requestId.current = id;
        setProbeId(id);
        try {
          const result = await invoke("mcp.probe", { ...target(name), requestId: id });
          if (isCurrentView()) {
            setProbe(result);
            setNotice(t("mcpProbeOnly", "This test used a temporary connection. Session status is shown separately."));
          }
        } finally {
          if (requestId.current === id) requestId.current = undefined;
          if (isCurrentView()) setProbeId(undefined);
        }
      });
    const startLogin = (name: string) =>
      run(async () => {
        const status = await call("mcp.oauth.start", target(name));
        if (!isCurrentView()) {
          await call("mcp.oauth.cancel", { requestId: status.requestId });
          return;
        }
        loginId.current = status.requestId;
        setLogin(status);
        for (;;) {
          const current = await invoke("mcp.oauth.get", { requestId: status.requestId });
          if (!isCurrentView()) return;
          setLogin(current);
          if (current.authUrl) {
            await window.piBridge?.openExternal(current.authUrl);
            break;
          }
          if (current.state !== "waiting") break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
    useEffect(() => {
      if (!login?.requestId || login.state !== "waiting") return;
      const id = login.requestId;
      let disposed = false;
      const timer = setInterval(() => {
        void call("mcp.oauth.get", { requestId: id })
          .then((status) => {
            if (!disposed) {
              setLogin(status);
              if (status.state !== "waiting") {
                setCallbackUrl("");
                void load();
              }
            }
          })
          .catch(() => undefined);
      }, 500);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    }, [login?.requestId, login?.state, load]);
    const previewResource = (value: McpTarget, uri: string) =>
      run(async () => {
        const result = await invoke("mcp.resource.read", { ...value, uri });
        setResourceText(result.content !== undefined ? JSON.stringify(result.content, null, 2) : result.preview);
        setResourceRef(result.hash ? { hash: result.hash, offset: 0 } : undefined);
      });
    const formOpen = Boolean(editing);
    useEffect(() => {
      if (formOpen) {
        formOpener.current = editing?.name ? "edit" : "add";
        detail.current
          ?.querySelector<HTMLElement>('.mcp-editor :is(input:not([readonly], [type="checkbox"]), textarea, select)')
          ?.focus();
      }
    }, [editing?.name, formOpen]);
    useEffect(() => {
      if (formOpen || busy || !formOpener.current) return;
      const editButton = detail.current
        ?.querySelector('.mcp-row-trigger[aria-expanded="true"]')
        ?.closest(".mcp-row-head")
        ?.querySelector<HTMLButtonElement>(".mcp-edit-button");
      (formOpener.current === "edit" ? (editButton ?? addButton.current) : addButton.current)?.focus();
      formOpener.current = undefined;
    }, [busy, formOpen]);
    useEffect(() => {
      if (pendingLeave)
        detail.current?.querySelector<HTMLButtonElement>('[role="alertdialog"] button:last-child')?.focus();
    }, [pendingLeave]);
    const edit = (entry: McpConfigEntry) => {
      leave(() => {
        const extension = entry.scope === "extension";
        setEditing({
          name: entry.name,
          config: entry.config,
          extension,
          revision: extension ? entry.revision : snapshot?.revision,
        });
        setSelected({ name: entry.name, extension });
        setDirty(false);
      });
    };
    const toggle = async (entry: McpConfigEntry, enabled: boolean) => {
      if (busy || !snapshot || snapshot.revision === "invalid") return;
      setPendingToggle({ name: entry.name, enabled });
      await run(async () => {
        await invoke("mcp.config.upsert", {
          scope: "global",
          name: entry.name,
          config: { ...entry.config, enabled },
          expectedRevision: snapshot.revision,
        });
      });
      if (isCurrentView()) setPendingToggle(undefined);
    };
    const expand = (name: string, extension: boolean) => {
      if (selected?.name === name && selected.extension === extension) setSelected(undefined);
      else setSelected({ name, extension });
    };

    return (
      <div className="mcp-config" data-mcp-config>
        <div className="mcp-column">
          <header className="mcp-page-header">
            <h3>{t("mcpSettings", "MCP servers")}</h3>
            <button
              ref={addButton}
              type="button"
              className="mcp-add-button"
              disabled={busy || (!snapshot && !error)}
              onClick={() =>
                leave(() => {
                  setEditing({
                    name: "",
                    config: { command: "", args: [], exposure: "codemode" },
                    revision: snapshot?.revision ?? "missing",
                  });
                  setDirty(false);
                })
              }
            >
              <PlusOutlined aria-hidden="true" />
              {t("mcpAdd", "Add server")}
            </button>
          </header>
          <div className="mcp-detail-pane" ref={detail}>
            {pendingLeave && (
              <div role="alertdialog" aria-label={t("mcpUnsaved", "Unsaved MCP changes")}>
                <p>{t("mcpDiscardQuestion", "Discard the unsaved MCP edit?")}</p>
                <button
                  onClick={() => {
                    const action = pendingLeave;
                    setPendingLeave(undefined);
                    setDirty(false);
                    setEditing(undefined);
                    action();
                  }}
                >
                  {t("mcpDiscard", "Discard changes")}
                </button>
                <button onClick={() => setPendingLeave(undefined)}>{t("mcpKeepEditing", "Keep editing")}</button>
              </div>
            )}
            {error && (
              <p role="alert" className="mcp-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {panel?.inactiveReason === "disabled" && (
              <p>{t("mcpDisabledBySettings", "builtin:mcp is disabled in shared settings.")}</p>
            )}
            {panel?.inactiveReason === "replaced" && (
              <p>
                {t(
                  "mcpReplacedByExtension",
                  "Another extension manages MCP in this session. Desktop connection controls are inactive.",
                )}
              </p>
            )}
            {sessionId && !panel?.adapterActive && (
              <button
                className="mcp-apply-session"
                disabled={busy}
                onClick={() => void run(() => invoke("agent.command", { sessionId, command: { type: "get_tools" } }))}
              >
                {t("mcpApplySession", "Apply MCP to this session")}
              </button>
            )}
            {!formOpen && snapshot && !snapshot.entries.length && !panel?.extensions?.length && (
              <p className="mcp-empty">{t("mcpNoServers", "No MCP servers configured.")}</p>
            )}
            {!formOpen && !!snapshot?.entries.length && (
              <div className="mcp-server-list">
                {snapshot.entries.map((entry) => {
                  const live = panel?.instances.find((instance) => instance.name === entry.name);
                  const ownLive = live?.scope === entry.scope && live?.source === entry.source && !live?.overrideSource;
                  const expanded = selected?.name === entry.name && !selected.extension;
                  const saving = pendingToggle?.name === entry.name;
                  const enabled = saving ? pendingToggle.enabled : entry.config.enabled !== false;
                  const state = entry.config.enabled === false ? "disabled" : (live?.state ?? "not-started");
                  return (
                    <McpServerRow
                      key={entry.name}
                      name={entry.name}
                      busy={busy}
                      onEdit={() => edit(entry)}
                      onExpand={() => expand(entry.name, false)}
                      metadata={
                        <>
                          <span className="mcp-transport-tag">{entry.config.url ? "HTTP" : "stdio"}</span>
                          <span className={`mcp-status-dot is-${state}`} aria-hidden="true" />
                          {saving ? t("saving", "Saving…") : mcpStateLabel(state, t)}
                          {live && (
                            <>
                              {" "}
                              · {t("mcpServerToolCount", "{count} tools").replace("{count}", String(live.toolCount))}
                            </>
                          )}
                        </>
                      }
                      toggle={
                        <button
                          type="button"
                          className="mcp-switch"
                          role="switch"
                          aria-label={`${t("mcpEnabled", "Enabled")} · ${entry.name}`}
                          aria-checked={enabled}
                          aria-disabled={busy || snapshot.revision === "invalid"}
                          onClick={() => void toggle(entry, !enabled)}
                        >
                          <span />
                        </button>
                      }
                    >
                      {expanded && (
                        <>
                          {live?.pendingApply && (
                            <p>{t("mcpPendingApply", "Waiting for the session to become idle")}</p>
                          )}
                          {live && !ownLive && <p>{t("mcpOverridden", "Overridden by another scope")}</p>}
                          {mcpAuthenticationMode(entry.config) === "header" && (
                            <p>
                              {t(
                                "mcpHeaderAuthHelp",
                                "Authentication uses the configured Authorization header. Edit the server to change it.",
                              )}
                            </p>
                          )}
                          {entry.config.auth && (
                            <p data-mcp-provider-auth>
                              <strong>{entry.config.auth.provider}</strong>
                              {" — "}
                              {t("mcpProviderAuthHelp", "Sign in through Models settings, then reconnect this server.")}
                            </p>
                          )}
                          <div className="mcp-actions">
                            <button
                              disabled={busy || entry.config.enabled === false}
                              onClick={() => void probeServer(entry.name)}
                            >
                              {t("mcpTest", "Test connection")}
                            </button>
                            {sessionId && ownLive && (
                              <button
                                disabled={busy || entry.config.enabled === false}
                                onClick={() => void run(() => invoke("mcp.reconnect", { sessionId, name: entry.name }))}
                              >
                                {t("mcpReconnect", "Reconnect session")}
                              </button>
                            )}
                            {mcpAuthenticationMode(entry.config) === "oauth" && (
                              <button disabled={busy} onClick={() => void startLogin(entry.name)}>
                                {t("mcpSignIn", "Sign in")}
                              </button>
                            )}
                            <McpActionMenu label={t("mcpMoreActions", "More actions")} disabled={busy}>
                              <button
                                disabled={busy || snapshot.revision === "invalid"}
                                onClick={() =>
                                  leave(() => {
                                    void run(async () => {
                                      await invoke("mcp.config.remove", {
                                        scope: "global",
                                        name: entry.name,
                                        expectedRevision: snapshot.revision,
                                      });
                                      setSelected(undefined);
                                    });
                                  })
                                }
                              >
                                {t("mcpRemove", "Remove")}
                              </button>
                              {mcpAuthenticationMode(entry.config) === "oauth" && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() => void run(() => invoke("mcp.oauth.logout", target(entry.name)))}
                                  >
                                    {t("mcpSignOut", "Sign out of this server")}
                                  </button>
                                </>
                              )}
                              <button
                                disabled={busy || entry.config.enabled === false}
                                onClick={() =>
                                  void run(async () => {
                                    const value = target(entry.name);
                                    setResources({ target: value, page: await invoke("mcp.resources", value) });
                                  })
                                }
                              >
                                {t("mcpResources", "Resources")}
                              </button>
                            </McpActionMenu>
                          </div>
                          {live?.error && <p className="mcp-error">{live.error}</p>}
                          {!!live?.diagnostics?.length && (
                            <details>
                              <summary>{t("mcpDiagnostics", "Connection diagnostics")}</summary>
                              <pre>{live.diagnostics.join("\n")}</pre>
                            </details>
                          )}
                        </>
                      )}
                    </McpServerRow>
                  );
                })}
              </div>
            )}
            {!formOpen && !!panel?.extensions?.length && (
              <section className="mcp-extension-list">
                <h4>{t("mcpExtensionServers", "Extension-registered servers")}</h4>
                <div className="mcp-server-list">
                  {panel.extensions.map((entry) => (
                    <McpServerRow
                      key={entry.name}
                      name={entry.name}
                      metadata={entry.source}
                      busy={busy}
                      onEdit={() => edit(entry)}
                      onExpand={() => expand(entry.name, true)}
                    >
                      {selected?.name === entry.name && selected.extension && (
                        <>
                          <p>
                            {t("mcpExtensionTemporary", "Changes to extension servers apply only to this session.")}
                          </p>
                          {sessionId && (
                            <div className="mcp-actions">
                              <button
                                disabled={busy}
                                onClick={() => void run(() => invoke("mcp.reconnect", { sessionId, name: entry.name }))}
                              >
                                {t("mcpReconnect", "Reconnect session")}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </McpServerRow>
                  ))}
                </div>
              </section>
            )}
            {probeId && (
              <button
                className="mcp-cancel-probe"
                onClick={() => void invoke("mcp.probe.cancel", { requestId: probeId })}
              >
                {t("mcpCancelProbe", "Cancel connection test")}
              </button>
            )}
            {probe && (
              <details>
                <summary>{t("mcpProbeResult", "Last connection test")}</summary>
                <pre>{JSON.stringify(probe, null, 2)}</pre>
              </details>
            )}
            {editing && (
              <McpServerEditor
                initial={editing}
                busy={busy}
                onDirty={() => setDirty(true)}
                onCancel={() =>
                  leave(() => {
                    setEditing(undefined);
                    setDirty(false);
                  })
                }
                onSave={(name, config) =>
                  void run(async () => {
                    if (editing.extension && sessionId)
                      await invoke("mcp.extension.update", {
                        sessionId,
                        name,
                        config,
                        expectedRevision: editing.revision!,
                      });
                    else
                      await invoke("mcp.config.upsert", {
                        scope: "global",
                        name,
                        config,
                        expectedRevision: editing.revision!,
                      });
                    setEditing(undefined);
                    setSelected({ name, extension: Boolean(editing.extension) });
                    setDirty(false);
                    setNotice(t("mcpSaved", "Configuration saved."));
                  })
                }
              />
            )}
            {login && (
              <section role="status">
                <strong>{t("mcpAuthorization", "MCP authorization")}</strong> · {mcpLoginLabel(login.state, t)}
                {login.error && <p>{login.error}</p>}
                {login.state === "waiting" && (
                  <>
                    <label>
                      {t("mcpCallbackUrl", "Paste callback URL")}
                      <input value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} />
                    </label>
                    <button
                      disabled={busy || !callbackUrl}
                      onClick={() =>
                        void run(async () => {
                          setLogin(await invoke("mcp.oauth.submit", { requestId: login.requestId, callbackUrl }));
                          setCallbackUrl("");
                        })
                      }
                    >
                      {t("mcpSubmitCallback", "Submit callback")}
                    </button>
                    <button
                      onClick={() =>
                        void run(async () => {
                          setLogin(await invoke("mcp.oauth.cancel", { requestId: login.requestId }));
                          setCallbackUrl("");
                        })
                      }
                    >
                      {t("mcpCancelLogin", "Cancel sign-in")}
                    </button>
                  </>
                )}
              </section>
            )}
            {resources && (
              <section>
                <h4>{t("mcpResources", "Resources")}</h4>
                {[...resources.page.resources, ...resources.page.templates].map((resource) => (
                  <div key={resource.uri}>
                    <code>{resource.uri}</code>
                    <button
                      disabled={busy || Boolean(resource.uriTemplate)}
                      onClick={() => void previewResource(resources.target, resource.uri)}
                    >
                      {t("mcpReadResource", "Read resource")}
                    </button>
                  </div>
                ))}
                {(resources.page.nextCursor || resources.page.nextTemplateCursor) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setResources({
                          ...resources,
                          page: await invoke("mcp.resources", {
                            ...resources.target,
                            cursor: resources.page.nextCursor,
                            templateCursor: resources.page.nextTemplateCursor,
                          }),
                        }),
                      )
                    }
                  >
                    {t("mcpMoreResources", "Next resource page")}
                  </button>
                )}
                {resourceText && <pre>{resourceText}</pre>}
                {resourceRef && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const chunk = await invoke("mcp.resource.content", resourceRef);
                        setResourceText(chunk.text);
                        setResourceRef(
                          chunk.nextOffset !== undefined
                            ? { hash: resourceRef.hash, offset: chunk.nextOffset }
                            : undefined,
                        );
                      })
                    }
                  >
                    {t("mcpMoreContent", "Read content page")}
                  </button>
                )}
              </section>
            )}
            {sessionId && !formOpen && (
              <McpToolsPanel
                key={sessionId}
                sessionId={sessionId}
                panel={panel}
                server={selected?.name}
                onChanged={load}
              />
            )}
          </div>
        </div>
      </div>
    );
  },
);
