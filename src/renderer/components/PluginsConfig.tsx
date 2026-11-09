import { call } from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { CapabilityRequired, parseCapabilityIssue, type CapabilityIssue } from "@/components/CapabilityRequired";
import { pluginRequestError } from "@/lib/plugin-presentation";
import { AddPluginPanel } from "./plugins/AddPluginPanel";
import { PackageDetail, type PluginAction } from "./plugins/PackageDetail";
import { PluginList } from "./plugins/PluginList";
import { ActionButton, PackageGlyph } from "./plugins/plugin-ui";
import { useStaggerIn } from "./plugins/usePluginMotion";

type PluginScope = PluginPackageInfo["scope"];
type PendingCapabilityOperation =
  | { kind: "action"; action: PluginAction; pkg: PluginPackageInfo }
  | { kind: "install"; source: string; scope: PluginScope; keepAddMode?: boolean };

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return (
    packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed) ??
    packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`) ??
    packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed))
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const shellRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [capabilityIssue, setCapabilityIssue] = useState<CapabilityIssue | null>(null);
  const [pendingCapabilityOperation, setPendingCapabilityOperation] = useState<PendingCapabilityOperation | null>(null);
  const [applying, setApplying] = useState(false);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await call("plugins.list", { cwd });
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current)) return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (caught) {
      setError(pluginRequestError(caught, t("pluginsLoadFailed", "Failed to load plugins.")));
    } finally {
      setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  useStaggerIn(shellRef, "[data-plugin-enter]", "plugins-shell", { y: 10, stagger: 0.05, duration: 0.3 });

  /**
   * A package install only changes `~/.pi/agent/settings.json`. Pi resolves
   * packages when a session binds its resources, so ask the active session to
   * reload immediately; otherwise the new tools/skills/commands stay invisible
   * until the user reloads manually.
   */
  const applyToSession = useCallback(
    (successMessage: string) => {
      if (!sessionId) return;
      setApplying(true);
      void sendAgentCommand(sessionId, { type: "reload" })
        .then(() => {
          onReloaded?.();
          setActionMessage(`${successMessage} ${t("pluginAppliedToSession", "Applied to the active session.")}`);
        })
        .catch((caught) => {
          setActionError(pluginRequestError(caught, t("pluginSessionReloadFailed", "Failed to reload session.")));
        })
        .finally(() => setApplying(false));
    },
    [onReloaded, sessionId, t],
  );

  const runAction = useCallback(
    async (action: PluginAction, pkg: PluginPackageInfo) => {
      const key = packageKey(pkg);
      setBusyKey(`${action}:${key}`);
      setActionError(null);
      setActionMessage(null);
      setCapabilityIssue(null);
      try {
        const next = await call("plugins.set", { action, source: pkg.source, scope: pkg.scope, cwd });
        setPendingCapabilityOperation(null);
        setData(next);
        let message = t("pluginPackageUpdated", "Package updated.");
        if (action === "remove") {
          setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
          if (next.packages.length === 0) setAddMode(true);
          message = t("pluginPackageRemoved", "Package removed.");
        } else if (action === "install") {
          message = t("pluginPackageInstalled", "Package installed.");
        } else if (action === "update") {
          message = t("pluginPackageUpdated", "Package updated.");
        } else if (action === "disable") {
          message = t("pluginPackageDisabledSuccessfully", "Package disabled.");
        } else {
          message = t("pluginPackageEnabled", "Package enabled.");
        }
        setActionMessage(message);
        applyToSession(message);
      } catch (caught) {
        const issue = parseCapabilityIssue(caught);
        if (issue) {
          setCapabilityIssue(issue);
          setPendingCapabilityOperation({ kind: "action", action, pkg });
          return;
        }
        setActionError(
          safePluginError(
            caught instanceof Error ? caught.message : undefined,
            t("pluginActionFailed", "Plugin action failed."),
            t,
          ),
        );
      } finally {
        setBusyKey(null);
      }
    },
    [applyToSession, cwd, t],
  );

  const installPluginSource = useCallback(
    async (source: string, scope: PluginScope, options: { keepAddMode?: boolean } = {}): Promise<boolean> => {
      const key = `${scope}\0${source}`;
      setBusyKey(`install:${key}`);
      setActionError(null);
      setActionMessage(null);
      setCapabilityIssue(null);
      try {
        const next = await call("plugins.set", { action: "install", source, scope, cwd });
        setPendingCapabilityOperation(null);
        setData(next);
        const installed = findInstalledPackage(next.packages, source, scope);
        if (!options.keepAddMode) {
          setSelected(installed ? packageKey(installed) : key);
          setAddMode(false);
          setInstallSource("");
        }
        const message = t("pluginPackageInstalled", "Package installed.");
        setActionMessage(message);
        applyToSession(message);
        return true;
      } catch (caught) {
        const issue = parseCapabilityIssue(caught);
        if (issue) {
          setCapabilityIssue(issue);
          setPendingCapabilityOperation({ kind: "install", source, scope, keepAddMode: options.keepAddMode });
          return false;
        }
        setActionError(
          safePluginError(
            caught instanceof Error ? caught.message : undefined,
            t("pluginInstallationFailed", "Plugin installation failed."),
            t,
          ),
        );
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [applyToSession, cwd, t],
  );

  const installPlugin = useCallback(async () => {
    const source = installSource.trim();
    if (!source) return;
    await installPluginSource(source, installScope);
  }, [installPluginSource, installScope, installSource]);

  /** Install a package picked from the registry results without leaving search. */
  const installFromSearch = useCallback(
    async (name: string): Promise<boolean> => installPluginSource(`npm:${name}`, installScope, { keepAddMode: true }),
    [installPluginSource, installScope],
  );

  const retryCapabilityOperation = useCallback(async () => {
    const pending = pendingCapabilityOperation;
    if (!pending) return;
    setCapabilityIssue(null);
    if (pending.kind === "action") await runAction(pending.action, pending.pkg);
    else await installPluginSource(pending.source, pending.scope, { keepAddMode: pending.keepAddMode });
  }, [installPluginSource, pendingCapabilityOperation, runAction]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage(t("pluginSessionReloaded", "Session reloaded."));
    } catch (caught) {
      setActionError(pluginRequestError(caught, t("pluginSessionReloadFailed", "Failed to reload session.")));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId, t]);

  const addBusy = busyKey?.startsWith("install:") ?? false;

  const totals = data?.totals;
  const summary = totals
    ? [
        t("pluginExtensionCount", "{count} ext").replace("{count}", String(totals.extensions)),
        t("pluginSkillCount", "{count} skills").replace("{count}", String(totals.skills)),
        t("pluginPromptCount", "{count} prompts").replace("{count}", String(totals.prompts)),
        t("pluginThemeCount", "{count} themes").replace("{count}", String(totals.themes)),
      ].join(" · ")
    : "";

  const refreshButton = (
    <ActionButton
      compact
      onClick={() => void loadPlugins()}
      disabled={loading || busyKey !== null}
      ariaLabel={t("refresh", "Refresh")}
    >
      {t("refresh", "Refresh")}
    </ActionButton>
  );

  return (
    <div
      style={
        embedded
          ? {
              position: "relative",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              padding: "10px 24px 0",
            }
          : {
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
      }
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 1040,
          maxWidth: embedded ? undefined : "calc(100vw - 16px)",
          height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "84vh",
          maxHeight: embedded ? undefined : "calc(100dvh - 16px)",
          background: embedded ? "transparent" : "var(--bg)",
          border: embedded ? "none" : "1px solid var(--border)",
          borderRadius: embedded ? 0 : 14,
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "0 24px 70px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        {!embedded ? (
          <div
            data-plugin-enter="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.1, color: "var(--text)" }}>
                {t("plugins", "Plugins")}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                {t("pluginSubtitle", "Pi packages for this workspace")}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {refreshButton}
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close", "Close")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: "2px 6px",
                }}
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          <div
            data-plugin-enter="true"
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              width: "100%",
              padding: "0 0 20px",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: "var(--text)" }}>
                {t("plugins", "Plugins")}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span>{summary}</span>
                {data?.diagnostics.length ? (
                  <span
                    title={data.diagnostics
                      .map(
                        (diagnostic) =>
                          `${diagnostic.type}: ${diagnostic.source ? `${diagnostic.source}: ` : ""}${diagnostic.message}`,
                      )
                      .join("\n")}
                    style={{
                      color: data.diagnostics.some((diagnostic) => diagnostic.type === "error")
                        ? "var(--danger)"
                        : "var(--warning)",
                      fontSize: 10.5,
                    }}
                  >
                    {t("pluginDiagnosticCount", "{count} diagnostics").replace(
                      "{count}",
                      String(data.diagnostics.length),
                    )}
                  </span>
                ) : null}
              </span>
            </div>
            {refreshButton}
          </div>
        )}

        <div
          ref={shellRef}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            gap: 20,
            width: "100%",
            overflow: "hidden",
          }}
        >
          {packages.length > 0 && (
            <aside
              data-plugin-enter="true"
              style={{
                width: isMobile ? "100%" : 250,
                maxHeight: isMobile ? "34vh" : undefined,
                flexShrink: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 16,
                background: "var(--bg-panel)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <PluginList
                groups={groupedPackages}
                selected={selected}
                addMode={addMode}
                loading={loading}
                error={error}
                onSelect={(key) => {
                  setSelected(key);
                  setAddMode(false);
                  setActionError(null);
                  setActionMessage(null);
                }}
                onAdd={() => {
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
              />
            </aside>
          )}

          <main
            data-plugin-enter="true"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflowX: "hidden",
              overflowY: addMode ? "hidden" : "auto",
              padding: addMode ? "0 4px 0 0" : "0 4px 40px 0",
            }}
          >
            {capabilityIssue && pendingCapabilityOperation && (
              <div style={{ marginBottom: 14, flexShrink: 0 }}>
                <CapabilityRequired
                  issue={capabilityIssue}
                  cwd={cwd}
                  onContinue={retryCapabilityOperation}
                  onCancel={() => {
                    setCapabilityIssue(null);
                    setPendingCapabilityOperation(null);
                  }}
                />
              </div>
            )}

            {addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                busy={addBusy}
                applying={applying}
                actionError={actionError}
                actionMessage={actionMessage}
                packages={packages}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
                onSearchInstall={installFromSearch}
              />
            ) : loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    style={{
                      height: 64,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--bg-panel)",
                      opacity: 0.6 - index * 0.12,
                    }}
                  />
                ))}
              </div>
            ) : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                applying={applying}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                style={{
                  minHeight: 300,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "var(--text-dim)",
                }}
              >
                <PackageGlyph name="pi" size={44} />
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("selectPackage", "Select a package")}</div>
                <div style={{ fontSize: 11.5 }}>
                  {t("pluginEmptyHint", "Or browse the marketplace to install your first package.")}
                </div>
              </div>
            )}
          </main>
        </div>

        {!embedded && (
          <div
            data-plugin-enter="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 20px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0, flex: 1, fontSize: 11, color: "var(--text-dim)", overflow: "hidden" }}>
              {data?.diagnostics.length ? (
                <span
                  title={data.diagnostics
                    .map(
                      (diagnostic) =>
                        `${diagnostic.type}: ${diagnostic.source ? `${diagnostic.source}: ` : ""}${diagnostic.message}`,
                    )
                    .join("\n")}
                  style={{
                    color: data.diagnostics.some((diagnostic) => diagnostic.type === "error")
                      ? "var(--danger)"
                      : "var(--warning)",
                  }}
                >
                  {t("pluginDiagnosticCount", "{count} diagnostics").replace(
                    "{count}",
                    String(data.diagnostics.length),
                  )}
                </span>
              ) : (
                <span>{summary}</span>
              )}
            </div>
            <ActionButton onClick={onClose} compact>
              {t("close", "Close")}
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}

function safePluginError(
  message: string | undefined,
  fallback: string,
  t: (key: string, fallback: string) => string,
): string {
  if (!message) return fallback;
  if (/ENOENT|spawn\s+(?:npm|npx|node|git)|not found/i.test(message)) {
    return t(
      "pluginDeveloperToolUnavailable",
      "A required developer tool is unavailable. Rescan tools or install the matching Essentials profile.",
    );
  }
  if (/failed to fetch|network\s*error|load failed/i.test(message)) return fallback;
  return message;
}
