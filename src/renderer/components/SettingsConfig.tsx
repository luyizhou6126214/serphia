import {
  ApiOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CompassOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  MessageOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons/es";
import {
  updateStatusColor,
  displayVersion,
  formatUpdateDate,
  formatBytes,
  updateDetailStyle,
} from "@/lib/update-display";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n, type AppLanguage } from "@/i18n";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig, type SkillsConfigHandle } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ToolchainsConfig } from "./ToolchainsSettings";
import { WindowsAgentShellSetting } from "./AgentShellSetting";
import { BrowserSettings } from "./browser/BrowserSettings";
import { ChannelsConfig } from "./channels/ChannelsConfig";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { ChatAppearancePreferences, ChatFontSize, ChatLayout } from "@shared/chat-appearance";
import type { WorkStepDisplay } from "@shared/work-step-display";
import type { DesktopUpdateState } from "../../contract/desktop";
import type { ManagedProcessCapability } from "../../contract/processes";
import { APP_AUTHOR, APP_GITHUB_URL, APP_VERSION, PI_VERSION } from "@/lib/app-version";
import { isAutoSessionTitleEnabled, setAutoSessionTitleEnabled } from "../lib/auto-session-title";
import { getCacheWarmingStatus, setCacheWarmingMode } from "../lib/api-client";
import { HerdrSettings } from "./herdr/HerdrSettings";
import { McpConfig, type McpConfigHandle } from "./mcp/McpConfig";

export type SettingsTab =
  "general" | "herdr" | "browser" | "channels" | "models" | "tools" | "skills" | "plugins" | "mcp" | "about";

type SettingsGroup = "workspace" | "integrations" | "system";

interface SettingsConfigProps {
  cwd: string | null;
  sessionId: string | null;
  initialTab?: SettingsTab;
  navigationRequestId?: number;
  onClose: () => void;
  onModelsChanged: () => void;
  onPluginsReloaded: () => void;
  onChannelsChanged: (snapshot: ChannelsSnapshot) => void;
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
  /** Element to refocus on close; the deferred wrapper captures it before any loading frame takes focus. */
  returnFocusTarget?: HTMLElement | null;
  registerTransition?: (handler: ((action: () => void) => void) | null) => void;
  navigationOpen?: boolean;
}

export function SettingsConfig({
  cwd,
  sessionId,
  initialTab = "general",
  navigationRequestId = 0,
  onClose,
  onModelsChanged,
  onPluginsReloaded,
  onChannelsChanged,
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
  returnFocusTarget,
  registerTransition,
  navigationOpen = true,
}: SettingsConfigProps) {
  const { isDark, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const pageRef = useRef<HTMLDivElement>(null);
  const initiallyOpenNavigationRef = useRef(navigationOpen);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const skillsConfigRef = useRef<SkillsConfigHandle>(null);
  const mcpConfigRef = useRef<McpConfigHandle>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    returnFocusTarget !== undefined
      ? returnFocusTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
  );

  const requestSettingsTransition = useCallback((action: () => void) => {
    if (activeTabRef.current === "skills" && skillsConfigRef.current) {
      skillsConfigRef.current.requestLeave(action);
      return;
    }
    if (activeTabRef.current === "mcp" && mcpConfigRef.current) {
      mcpConfigRef.current.requestLeave(action);
      return;
    }
    action();
  }, []);

  useEffect(() => {
    registerTransition?.(requestSettingsTransition);
    return () => registerTransition?.(null);
  }, [registerTransition, requestSettingsTransition]);

  useEffect(() => {
    if (initialTab !== activeTabRef.current) requestSettingsTransition(() => setActiveTab(initialTab));
    // navigationRequestId intentionally retries an externally requested tab after a cancelled dirty-editor prompt.
  }, [initialTab, navigationRequestId, requestSettingsTransition]);

  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    if (initiallyOpenNavigationRef.current) closeButtonRef.current?.focus();
    else pageRef.current?.focus();
    return () => {
      returnFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (page && !page.contains(document.activeElement)) {
      document.getElementById(`settings-tab-${activeTab}`)?.focus();
    }
  }, [activeTab, navigationRequestId]);

  const groupLabels = {
    workspace: t("settingsWorkspaceGroup", "Workspace"),
    integrations: t("settingsIntegrationsGroup", "Integrations"),
    system: t("settingsSystemGroup", "System"),
  };
  const tabs = [
    {
      id: "general",
      group: "workspace",
      label: t("general", "General"),
      icon: SettingOutlined,
      description: t("settingsGeneralSummary", "Personalize your language, appearance, and chat experience."),
    },
    {
      id: "models",
      group: "workspace",
      label: t("models", "Models"),
      icon: RobotOutlined,
      description: t("settingsModelsSummary", "Manage model providers, routing, and runtime options."),
    },
    {
      id: "skills",
      group: "workspace",
      label: t("skills", "Skills"),
      icon: CompassOutlined,
      description: t("settingsSkillsSummary", "Browse and edit the skills available to the current project."),
    },
    {
      id: "plugins",
      group: "integrations",
      label: t("plugins", "Plugins"),
      icon: AppstoreOutlined,
      description: t("settingsPluginsSummary", "Discover, install, and manage plugins for this project."),
    },
    {
      id: "mcp",
      group: "integrations",
      label: t("mcpTab", "MCP"),
      icon: ApiOutlined,
      description: t(
        "settingsMcpSummary",
        "Connect external tools and manage server settings for the app or current project.",
      ),
    },
    {
      id: "browser",
      group: "integrations",
      label: t("browser", "Browser"),
      icon: GlobalOutlined,
      description: t(
        "browserSettingsDescription",
        "Websites run in Main-owned, sandboxed Electron WebContentsView instances. Agent access is a separate, default-off permission.",
      ),
    },
    {
      id: "herdr",
      group: "integrations",
      label: t("herdr", "Herdr"),
      icon: CloudServerOutlined,
      description: t(
        "herdrIntegrationDescription",
        "Configure how serphia connects to a local Herdr Session. Installations and updates are managed in Developer Tools.",
      ),
    },
    {
      id: "channels",
      group: "integrations",
      label: t("channels", "Channels"),
      icon: MessageOutlined,
      description: t(
        "channelsDescription",
        "Connect IM accounts, control access, and bind conversations to Pi sessions.",
      ),
    },
    {
      id: "tools",
      group: "system",
      label: t("developerTools", "Developer Tools"),
      icon: CodeOutlined,
      description: t("settingsToolsSummary", "Inspect tool availability and manage runtimes and local executables."),
    },
    {
      id: "about",
      group: "system",
      label: t("about", "About"),
      icon: InfoCircleOutlined,
      description: t("aboutDescription", "App, Pi, and project information."),
    },
  ] satisfies {
    id: SettingsTab;
    group: SettingsGroup;
    label: string;
    icon: typeof SettingOutlined;
    description: string;
  }[];
  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      className="settings-page"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestSettingsTransition(onClose);
        }
      }}
    >
      <aside
        className="settings-page-nav"
        aria-hidden={!navigationOpen || undefined}
        inert={!navigationOpen || undefined}
      >
        <div className="settings-page-nav-header">
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-page-back"
            onClick={() => requestSettingsTransition(onClose)}
            aria-label={t("settingsBack", "Back to chats")}
            title={t("settingsBack", "Back to chats")}
          >
            <ArrowLeftOutlined />
          </button>
          <span>{t("settings", "Settings")}</span>
        </div>
        <div
          role="tablist"
          aria-label={t("settings", "Settings")}
          aria-orientation="vertical"
          className="settings-page-tabs"
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeTab;
            return (
              <Fragment key={tab.id}>
                {tabs[index - 1]?.group !== tab.group && (
                  <div className="settings-page-tab-group" aria-hidden="true">
                    {groupLabels[tab.group]}
                  </div>
                )}
                <button
                  id={`settings-tab-${tab.id}`}
                  data-settings-group={tab.group}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="settings-tabpanel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    if (!active) requestSettingsTransition(() => setActiveTab(tab.id));
                  }}
                  onKeyDown={(event) => {
                    const currentIndex = tabs.findIndex((item) => item.id === tab.id);
                    let nextIndex: number | undefined;
                    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
                    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                    if (event.key === "Home") nextIndex = 0;
                    if (event.key === "End") nextIndex = tabs.length - 1;
                    if (nextIndex === undefined) return;
                    event.preventDefault();
                    const nextTab = tabs[nextIndex];
                    requestSettingsTransition(() => {
                      setActiveTab(nextTab.id);
                      document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
                    });
                  }}
                  className={`settings-page-tab${active ? " is-active" : ""}`}
                >
                  <tab.icon aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </aside>

      <main className="settings-page-main" data-settings-group={currentTab.group}>
        <div
          id="settings-tabpanel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className="settings-page-content"
        >
          {activeTab === "general" && (
            <GeneralSettings
              language={language}
              onLanguageChange={setLanguage}
              isDark={isDark}
              onThemeChange={(nextDark) => {
                if (nextDark !== isDark) toggleTheme();
              }}
              chatAppearance={chatAppearance}
              chatAppearanceSaving={chatAppearanceSaving}
              onChatAppearanceChange={onChatAppearanceChange}
            />
          )}
          {activeTab === "browser" && <BrowserSettings sessionId={sessionId} />}
          {activeTab === "mcp" && <McpConfig ref={mcpConfigRef} cwd={cwd} sessionId={sessionId} />}
          {activeTab === "herdr" && <HerdrSettings />}
          {activeTab === "models" && (
            <ModelsConfig embedded cwd={cwd} onClose={() => undefined} onChanged={onModelsChanged} />
          )}
          {activeTab === "tools" && <ToolchainsConfig cwd={cwd} />}
          {activeTab === "channels" && <ChannelsConfig onSnapshotChange={onChannelsChanged} />}
          {activeTab === "skills" &&
            (cwd ? (
              <SkillsConfig ref={skillsConfigRef} embedded cwd={cwd} onClose={() => undefined} />
            ) : (
              <ProjectRequired />
            ))}
          {activeTab === "plugins" &&
            (cwd ? (
              <PluginsConfig
                embedded
                cwd={cwd}
                sessionId={sessionId}
                onClose={() => undefined}
                onReloaded={onPluginsReloaded}
              />
            ) : (
              <ProjectRequired />
            ))}
          {activeTab === "about" && <AboutSettings onClose={onClose} />}
        </div>
      </main>
    </div>
  );
}

function AboutSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="settings-panel-scroll">
      <div className="settings-panel-column">
        <section>
          <h2 style={{ margin: "0 0 12px", fontSize: 14, color: "var(--text)" }}>
            {t("applicationInformation", "Application information")}
          </h2>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-panel)",
              overflow: "hidden",
            }}
          >
            <AboutRow label={t("softwareVersion", "Software version")} value={`v${APP_VERSION}`} />
            <AboutRow label={t("piVersion", "Pi version")} value={`v${PI_VERSION}`} />
            <AboutRow label={t("author", "Author")} value={APP_AUTHOR} />
            <AboutRow
              label={t("githubRepository", "GitHub repository")}
              value={
                <button
                  type="button"
                  title={t("openGithubRepository", "Open GitHub repository")}
                  onClick={() => void window.piBridge.openExternal(APP_GITHUB_URL)}
                  style={{
                    maxWidth: "100%",
                    padding: 0,
                    border: 0,
                    background: "none",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                  }}
                >
                  github.com/luyizhou6126214/serphia ↗
                </button>
              }
              last
            />
          </div>
        </section>

        <SoftwareUpdate onClose={onClose} />
      </div>
    </div>
  );
}

type UpdateAction = "status" | "check" | "download" | "install" | "automatic" | "logs";

function SoftwareUpdate({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n();
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [pendingAction, setPendingAction] = useState<UpdateAction | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const headingId = useId();
  const automaticChecksControlId = useId();
  const automaticChecksDescriptionId = useId();

  useEffect(() => {
    let disposed = false;
    let receivedStateEvent = false;
    const unsubscribe = window.piBridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedStateEvent = true;
      setState(nextState);
      setActionFailed(false);
    });

    void window.piBridge
      .getUpdateState()
      .then((nextState) => {
        if (!disposed && !receivedStateEvent) setState(nextState);
      })
      .catch(() => {
        if (!disposed && !receivedStateEvent) setActionFailed(true);
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const performAction = async (action: UpdateAction, operation: () => Promise<unknown>): Promise<void> => {
    setPendingAction(action);
    setActionFailed(false);
    try {
      await operation();
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  };

  const phase = state?.phase;
  const isBusy = pendingAction !== null;
  const statusTitle = getUpdateStatusTitle(state, t);

  return (
    <section aria-labelledby={headingId} style={{ marginTop: 28 }}>
      <h2 id={headingId} style={{ margin: "0 0 6px", fontSize: 14, color: "var(--text)" }}>
        {t("softwareUpdate", "Software update")}
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
        {t("softwareUpdateDescription", "Check stable releases and choose when a downloaded update is installed.")}
      </p>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16 }}>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                marginTop: 5,
                borderRadius: "50%",
                flexShrink: 0,
                background: updateStatusColor(phase),
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)" }}>{statusTitle}</div>
              {state && (
                <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
                  {t("currentVersion", "Current version")}: {displayVersion(state.currentVersion)}
                </div>
              )}
            </div>
          </div>

          {state?.checkedAt && (phase === "up-to-date" || phase === "idle") && (
            <p style={updateDetailStyle}>
              {t("lastChecked", "Last checked")}: {formatUpdateDate(state.checkedAt, language)}
            </p>
          )}

          {phase === "disabled" && (
            <p style={updateDetailStyle}>
              {t(
                "updatesDisabledDescription",
                "Software updates are available only in installed production builds on supported platforms.",
              )}
            </p>
          )}

          {state && (phase === "available" || phase === "downloading" || phase === "downloaded") && (
            <UpdateReleaseDetails state={state} language={language} />
          )}

          {state && phase === "downloading" && <UpdateDownloadProgress state={state} language={language} />}

          {state && phase === "downloaded" && (
            <p style={updateDetailStyle}>
              {state.installBlockedByActiveSessions
                ? t(
                    "updateInstallBlockedByActiveSessions",
                    "Active Agent tasks must finish before restart. Choose Later to install when you next fully quit.",
                  )
                : t(
                    "updateRestartWarning",
                    "Restart now, or choose Later to install when you next fully quit the app.",
                  )}
            </p>
          )}

          {state?.phase === "error" && state.error && (
            <div role="alert" aria-atomic="true" style={{ marginTop: 12 }}>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "#f87171" }}>
                {getUpdateErrorMessage(state.error, t)}
              </p>
              <code style={{ display: "block", marginTop: 5, fontSize: 10, color: "var(--text-dim)" }}>
                {state.error.code}
              </code>
            </div>
          )}

          {actionFailed && (
            <p role="alert" style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.55, color: "#f87171" }}>
              {t("updateActionFailed", "The update action could not be completed. Try again or open the logs.")}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {(phase === "idle" || phase === "up-to-date") && (
              <UpdateButton
                primary
                disabled={isBusy}
                busy={pendingAction === "check"}
                label={t("checkForUpdates", "Check for updates")}
                onClick={() => void performAction("check", () => window.piBridge.checkForUpdates())}
              />
            )}
            {phase === "checking" && (
              <UpdateButton
                primary
                disabled
                busy
                label={t("checkingForUpdates", "Checking for updates…")}
                onClick={() => undefined}
              />
            )}
            {phase === "available" && (
              <UpdateButton
                primary
                disabled={isBusy}
                busy={pendingAction === "download"}
                label={t("downloadUpdate", "Download update")}
                onClick={() => void performAction("download", () => window.piBridge.downloadUpdate())}
              />
            )}
            {state && phase === "downloaded" && (
              <>
                <UpdateButton
                  primary
                  disabled={isBusy || state.installBlockedByActiveSessions}
                  busy={pendingAction === "install"}
                  label={t("restartAndInstall", "Restart and install")}
                  onClick={() => void performAction("install", () => window.piBridge.installUpdate())}
                />
                <UpdateButton disabled={isBusy} label={t("installLater", "Later")} onClick={onClose} />
              </>
            )}
            {state?.phase === "error" && state.canRetry && (
              <UpdateButton
                primary
                disabled={isBusy}
                busy={pendingAction === "check"}
                label={t("retryUpdate", "Retry")}
                onClick={() => void performAction("check", () => window.piBridge.checkForUpdates())}
              />
            )}
            {!state && actionFailed && (
              <UpdateButton
                primary
                disabled={isBusy}
                busy={pendingAction === "status"}
                label={t("retryUpdate", "Retry")}
                onClick={() =>
                  void performAction("status", async () => {
                    setState(await window.piBridge.getUpdateState());
                  })
                }
              />
            )}
            {(phase === "error" || actionFailed) && (
              <UpdateButton
                disabled={isBusy}
                busy={pendingAction === "logs"}
                label={t("openLogs", "Open logs")}
                onClick={() => void performAction("logs", () => window.piBridge.openLogs())}
              />
            )}
          </div>
        </div>

        <div
          style={{
            minHeight: 56,
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <label htmlFor={automaticChecksControlId} style={{ fontSize: 12, color: "var(--text)" }}>
              {t("automaticUpdateChecks", "Automatically check for updates")}
            </label>
            <div
              id={automaticChecksDescriptionId}
              style={{ marginTop: 3, fontSize: 10, lineHeight: 1.45, color: "var(--text-dim)" }}
            >
              {t("automaticUpdateChecksDescription", "Checks periodically without downloading updates automatically.")}
            </div>
          </div>
          <input
            id={automaticChecksControlId}
            type="checkbox"
            aria-describedby={automaticChecksDescriptionId}
            checked={state?.automaticChecksEnabled ?? false}
            disabled={!state || phase === "disabled" || isBusy}
            onChange={(event) => {
              const enabled = event.target.checked;
              void performAction("automatic", async () => {
                const nextState = await window.piBridge.setAutomaticUpdateChecks(enabled);
                setState(nextState);
              });
            }}
            style={{ width: 18, height: 18, margin: 0, accentColor: "var(--accent)", cursor: "pointer" }}
          />
        </div>
      </div>
    </section>
  );
}

function UpdateReleaseDetails({ state, language }: { state: DesktopUpdateState; language: AppLanguage }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.55, color: "var(--text-muted)" }}>
      {state.availableVersion && (
        <div>
          {t("availableVersion", "Available version")}: {displayVersion(state.availableVersion)}
        </div>
      )}
      {state.releaseName && <div>{state.releaseName}</div>}
      {state.releaseDate && (
        <div>
          {t("releaseDate", "Released")}: {formatUpdateDate(state.releaseDate, language)}
        </div>
      )}
      {state.releaseNotes && (
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 5, fontWeight: 650, color: "var(--text)" }}>
            {t("releaseNotes", "Release notes")}
          </div>
          <pre
            tabIndex={0}
            aria-label={t("releaseNotes", "Release notes")}
            style={{
              margin: 0,
              maxHeight: 180,
              overflowY: "auto",
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontFamily: "inherit",
              fontSize: 11,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {state.releaseNotes}
          </pre>
        </div>
      )}
    </div>
  );
}

function UpdateDownloadProgress({ state, language }: { state: DesktopUpdateState; language: AppLanguage }) {
  const { t } = useI18n();
  const percent = Number.isFinite(state.percent) ? Math.max(0, Math.min(100, state.percent ?? 0)) : 0;
  const progressText = `${percent.toFixed(1)}%`;
  return (
    <div style={{ marginTop: 14 }}>
      <progress
        max={100}
        value={percent}
        aria-label={t("updateDownloadProgress", "Update download progress")}
        aria-valuetext={progressText}
        style={{ width: "100%", height: 8, accentColor: "var(--accent)" }}
      />
      <div
        style={{
          marginTop: 5,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 10,
          color: "var(--text-dim)",
        }}
      >
        <span>{progressText}</span>
        <span>
          {state.transferred !== undefined && state.total !== undefined
            ? `${formatBytes(state.transferred, language)} / ${formatBytes(state.total, language)}`
            : t("calculatingDownloadSize", "Calculating size…")}
          {state.bytesPerSecond !== undefined && state.bytesPerSecond > 0
            ? ` · ${formatBytes(state.bytesPerSecond, language)}/${t("secondShort", "s")}`
            : ""}
        </span>
      </div>
    </div>
  );
}

function UpdateButton({
  label,
  onClick,
  primary = false,
  disabled = false,
  busy = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 34,
        padding: "7px 12px",
        border: `1px solid ${primary ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 6,
        background: primary ? "var(--accent)" : "var(--bg)",
        color: primary ? "white" : "var(--text)",
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function getUpdateStatusTitle(state: DesktopUpdateState | null, t: (key: string, fallback: string) => string): string {
  if (!state) return t("loadingUpdateStatus", "Loading update status…");
  switch (state.phase) {
    case "disabled":
      return t("updatesDisabled", "Updates are unavailable in this build");
    case "idle":
      return t("readyToCheckForUpdates", "Ready to check for updates");
    case "checking":
      return t("checkingForUpdates", "Checking for updates…");
    case "up-to-date":
      return t("appIsUpToDate", "You are using the latest version");
    case "available":
      return t("updateAvailable", "An update is available");
    case "downloading":
      return t("downloadingUpdate", "Downloading update…");
    case "downloaded":
      return t("updateReadyToInstall", "Update ready to install");
    case "installing":
      return t("installingUpdate", "Restarting to install the update…");
    case "error":
      return t("updateFailed", "Update failed");
  }
}

function getUpdateErrorMessage(
  error: NonNullable<DesktopUpdateState["error"]>,
  t: (key: string, fallback: string) => string,
): string {
  switch (error.code) {
    case "UPDATE_OFFLINE":
      return t("updateErrorOffline", "Unable to reach the update service. Check your network and try again.");
    case "UPDATE_NOT_PUBLISHED":
      return t("updateErrorNotPublished", "The update is not available yet and may still be under release review.");
    case "UPDATE_METADATA_INVALID":
      return t(
        "updateErrorMetadataInvalid",
        "The update information is invalid or incomplete. This version was not changed.",
      );
    case "UPDATE_SIGNATURE_INVALID":
      return t("updateErrorSignatureInvalid", "Update signature verification failed. Installation was stopped.");
    case "UPDATE_DOWNLOAD_FAILED":
      return t("updateErrorDownloadFailed", "The download failed. You can continue using this version and try again.");
    case "UPDATE_BUSY":
      return t("updateErrorBusy", "Another update task is already in progress.");
    case "UPDATE_INVALID_STATE":
      return t("updateErrorInvalidState", "This update action is not available in the current state.");
    case "UPDATE_UNSUPPORTED":
      return t("updateErrorUnsupported", "This build or platform does not support automatic updates.");
    case "UPDATE_UNKNOWN":
      return t("updateErrorUnknown", "An unexpected update error occurred. This version was not changed.");
  }
}

function AboutRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        minHeight: 52,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 13, color: "var(--text-muted)" }}>{label}</span>
      <span
        style={{
          minWidth: 0,
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function GeneralSettings({
  language,
  onLanguageChange,
  isDark,
  onThemeChange,
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  isDark: boolean;
  onThemeChange: (dark: boolean) => void;
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
}) {
  const { t } = useI18n();
  const [backgroundMode, setBackgroundMode] = useState(true);
  const [backgroundModeLoading, setBackgroundModeLoading] = useState(true);
  const [backgroundModeSaving, setBackgroundModeSaving] = useState(false);
  const [backgroundModeError, setBackgroundModeError] = useState<"load" | "save" | null>(null);
  const [managedProcessesEnabled, setManagedProcessesEnabled] = useState(false);
  const [managedProcessesLoading, setManagedProcessesLoading] = useState(true);
  const [managedProcessesSaving, setManagedProcessesSaving] = useState(false);
  const [managedProcessesError, setManagedProcessesError] = useState<"load" | "save" | null>(null);
  const [managedProcessCapability, setManagedProcessCapability] = useState<ManagedProcessCapability | null>(null);
  const [autoSessionTitle, setAutoSessionTitle] = useState(() => isAutoSessionTitleEnabled());
  const [cacheWarmingMode, setCacheWarmingModeState] = useState<"off" | "streaming" | "idle">("streaming");
  const [cacheWarmingLoading, setCacheWarmingLoading] = useState(true);
  const [cacheWarmingSaving, setCacheWarmingSaving] = useState(false);
  const [cacheWarmingError, setCacheWarmingError] = useState<"load" | "save" | "partial" | null>(null);
  const [chatAppearanceError, setChatAppearanceError] = useState(false);
  const languageControlId = useId();
  const backgroundModeControlId = useId();
  const managedProcessesControlId = useId();
  const autoSessionTitleControlId = useId();
  const cacheWarmingControlId = useId();
  const chatFontSizeControlId = useId();
  const chatLayoutControlId = useId();
  const workStepDisplayControlId = useId();
  const themeControlId = useId();
  useEffect(() => {
    let disposed = false;
    void getCacheWarmingStatus()
      .then((status) => {
        if (disposed) return;
        setCacheWarmingModeState(status.mode);
        setCacheWarmingError(status.loadFailed ? "load" : null);
      })
      .catch(() => {
        if (!disposed) setCacheWarmingError("load");
      })
      .finally(() => {
        if (!disposed) setCacheWarmingLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    void Promise.all([window.piBridge.getUiState(), window.piBridge.getManagedProcessCapability()])
      .then(([state, capability]) => {
        if (!disposed) {
          setBackgroundMode(state.backgroundMode !== false);
          setManagedProcessesEnabled(state.managedProcessesEnabled === true);
          setManagedProcessCapability(capability);
        }
      })
      .catch(() => {
        if (!disposed) {
          setBackgroundModeError("load");
          setManagedProcessesError("load");
        }
      })
      .finally(() => {
        if (!disposed) {
          setBackgroundModeLoading(false);
          setManagedProcessesLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const saveBackgroundMode = async (next: boolean): Promise<void> => {
    const previous = backgroundMode;
    setBackgroundMode(next);
    setBackgroundModeSaving(true);
    setBackgroundModeError(null);
    try {
      await window.piBridge.setUiState({ backgroundMode: next });
    } catch {
      setBackgroundMode(previous);
      setBackgroundModeError("save");
    } finally {
      setBackgroundModeSaving(false);
    }
  };
  const saveManagedProcesses = async (next: boolean): Promise<void> => {
    const previous = managedProcessesEnabled;
    setManagedProcessesEnabled(next);
    setManagedProcessesSaving(true);
    setManagedProcessesError(null);
    try {
      await window.piBridge.setUiState({ managedProcessesEnabled: next });
    } catch {
      setManagedProcessesEnabled(previous);
      setManagedProcessesError("save");
    } finally {
      setManagedProcessesSaving(false);
    }
  };
  const saveChatAppearance = async (next: ChatAppearancePreferences): Promise<void> => {
    setChatAppearanceError(false);
    try {
      await onChatAppearanceChange(next);
    } catch {
      setChatAppearanceError(true);
    }
  };
  const saveCacheWarming = async (next: "off" | "streaming" | "idle"): Promise<void> => {
    const previous = cacheWarmingMode;
    setCacheWarmingSaving(true);
    setCacheWarmingError(null);
    try {
      const result = await setCacheWarmingMode(next);
      setCacheWarmingModeState(result.mode);
      setCacheWarmingError(result.pendingSessionCount > 0 ? "partial" : null);
    } catch {
      try {
        const status = await getCacheWarmingStatus();
        setCacheWarmingModeState(status.mode);
        setCacheWarmingError(status.loadFailed ? "load" : "save");
      } catch {
        setCacheWarmingModeState(previous);
        setCacheWarmingError("save");
      }
    } finally {
      setCacheWarmingSaving(false);
    }
  };
  const managedProcessCapabilityMessage = (() => {
    if (!managedProcessCapability || managedProcessCapability.ready) return null;
    switch (managedProcessCapability.errorCode) {
      case "ARCH_UNSUPPORTED":
        return t("managedProcessesArchUnsupported", "Managed processes require Windows x64 on this platform.");
      case "HELPER_MISSING":
        return t(
          "managedProcessesHelperMissing",
          "The Windows process helper is missing. Reinstall the app, then restart it.",
        );
      case "HELPER_INTEGRITY":
        return t(
          "managedProcessesHelperIntegrity",
          "The Windows process helper failed its integrity check. Reinstall the app, then restart it.",
        );
      case "OWNER_IDENTITY_UNAVAILABLE":
        return t(
          "managedProcessesOwnerUnavailable",
          "Windows process ownership could not be verified. Restart the app before enabling this feature.",
        );
      case "REAPER_UNHEALTHY":
        return t(
          "managedProcessesReaperUnhealthy",
          "A previous process tree could not be safely verified as stopped. Restart the app or export diagnostics.",
        );
      default:
        return t("managedProcessesUnsupported", "Managed processes are not available on this platform.");
    }
  })();
  const managedProcessesUnavailable = !managedProcessCapability?.ready;
  return (
    <div className="settings-panel-scroll settings-general-content">
      <section>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
          {t("interfaceLanguage", "Interface language")}
        </h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("interfaceLanguageDescription", "Choose the language used by the app. Changes take effect immediately.")}
        </p>
        <SettingRow label={t("language", "Language")} controlId={languageControlId}>
          <select
            id={languageControlId}
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
            style={selectStyle}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
          </select>
        </SettingRow>
      </section>

      <hr />

      <WindowsAgentShellSetting />

      <section>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{t("managedProcesses", "Managed processes")}</h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "managedProcessesDescription",
            "Let Agents run development servers and watchers under app-owned lifecycle control. Processes have the same local access as Bash and are not a sandbox.",
          )}
        </p>
        <SettingRow
          label={t("managedProcessesEnable", "Enable managed background processes")}
          controlId={managedProcessesControlId}
        >
          <label
            htmlFor={managedProcessesControlId}
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              cursor: managedProcessesUnavailable ? "not-allowed" : "pointer",
            }}
          >
            <input
              id={managedProcessesControlId}
              type="checkbox"
              checked={managedProcessesEnabled}
              disabled={managedProcessesUnavailable || managedProcessesLoading || managedProcessesSaving}
              onChange={(event) => void saveManagedProcesses(event.target.checked)}
              style={{
                width: 18,
                height: 18,
                margin: 0,
                accentColor: "var(--accent)",
              }}
            />
          </label>
        </SettingRow>
        {managedProcessCapabilityMessage && (
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)" }}>
            {managedProcessCapabilityMessage}
          </p>
        )}
        {managedProcessCapability?.ready &&
          managedProcessCapability.backend === "windows-job" &&
          managedProcessCapability.helperProvenance === "windows-native-dev" && (
            <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)" }}>
              {t("managedProcessesDeveloperBuild", "Developer build — not a release-validated Windows helper.")}
            </p>
          )}
        {managedProcessesError && (
          <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "#f87171" }}>
            {managedProcessesError === "save"
              ? t(
                  "managedProcessesSaveFailed",
                  "Managed process settings could not be saved. The previous setting was restored.",
                )
              : t(
                  "managedProcessesLoadFailed",
                  "Managed process settings could not be loaded. The feature remains disabled.",
                )}
          </p>
        )}
      </section>

      <hr />

      <section>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{t("backgroundMode", "Background mode")}</h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("backgroundModeDescription", "Keep messaging channels connected when the window is closed.")}
        </p>
        <SettingRow label={t("closeToTray", "Close window to tray")} controlId={backgroundModeControlId}>
          <label
            htmlFor={backgroundModeControlId}
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              id={backgroundModeControlId}
              type="checkbox"
              checked={backgroundMode}
              disabled={backgroundModeLoading || backgroundModeSaving}
              onChange={(event) => {
                void saveBackgroundMode(event.target.checked);
              }}
              style={{
                width: 18,
                height: 18,
                margin: 0,
                accentColor: "var(--accent)",
                cursor: backgroundModeLoading || backgroundModeSaving ? "not-allowed" : "pointer",
              }}
            />
          </label>
        </SettingRow>
        {backgroundModeError && (
          <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "#f87171" }}>
            {backgroundModeError === "save"
              ? t("backgroundModeSaveFailed", "Background mode could not be saved. The previous setting was restored.")
              : t("backgroundModeLoadFailed", "Background mode could not be loaded. The default remains selected.")}
          </p>
        )}
      </section>

      <hr />

      <section>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{t("conversationSettings", "Conversation")}</h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "conversationSettingsDescription",
            "Control automatic titles, chat text size, conversation reading width, and work-step detail.",
          )}
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          <SettingRow label={t("autoSessionTitle", "Auto-title new sessions")} controlId={autoSessionTitleControlId}>
            <label
              htmlFor={autoSessionTitleControlId}
              style={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              <input
                id={autoSessionTitleControlId}
                type="checkbox"
                checked={autoSessionTitle}
                onChange={(event) => {
                  const next = event.target.checked;
                  setAutoSessionTitle(next);
                  setAutoSessionTitleEnabled(next);
                }}
                style={{
                  width: 18,
                  height: 18,
                  margin: 0,
                  accentColor: "var(--accent)",
                  cursor: "pointer",
                }}
              />
            </label>
          </SettingRow>
          <SettingRow label={t("cacheWarming", "Prompt cache warming")} controlId={cacheWarmingControlId}>
            <select
              id={cacheWarmingControlId}
              value={cacheWarmingMode}
              disabled={cacheWarmingLoading || cacheWarmingSaving || cacheWarmingError === "load"}
              onChange={(event) => {
                void saveCacheWarming(event.target.value as "off" | "streaming" | "idle");
              }}
              style={{ ...selectStyle, cursor: cacheWarmingSaving ? "wait" : "pointer" }}
            >
              <option value="off">{t("cacheWarmingOff", "Off")}</option>
              <option value="streaming">{t("cacheWarmingStreaming", "During long tool runs")}</option>
              <option value="idle">{t("cacheWarmingIdle", "Also while idle")}</option>
            </select>
          </SettingRow>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)" }}>
            {t(
              "cacheWarmingDescription",
              "Cache warming may use model tokens. This setting is shared with the Pi CLI.",
            )}
          </p>
          {cacheWarmingError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--danger)" }}>
              {cacheWarmingError === "load"
                ? t("cacheWarmingLoadFailed", "The Pi cache warming setting could not be read.")
                : cacheWarmingError === "partial"
                  ? t("cacheWarmingPartial", "Saved, but some active sessions could not update. Reopen those sessions.")
                  : t("cacheWarmingSaveFailed", "The Pi cache warming setting could not be saved.")}
            </p>
          )}
          <SettingRow label={t("chatFontSize", "Chat text size")} controlId={chatFontSizeControlId}>
            <select
              id={chatFontSizeControlId}
              value={chatAppearance.fontSize}
              disabled={chatAppearanceSaving}
              onChange={(event) => {
                void saveChatAppearance({
                  ...chatAppearance,
                  fontSize: event.target.value as ChatFontSize,
                });
              }}
              style={{ ...selectStyle, cursor: chatAppearanceSaving ? "wait" : "pointer" }}
            >
              <option value="small">{t("chatFontSizeSmall", "Small")}</option>
              <option value="standard">{t("chatFontSizeStandard", "Standard")}</option>
              <option value="large">{t("chatFontSizeLarge", "Large")}</option>
              <option value="extra-large">{t("chatFontSizeExtraLarge", "Extra large")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("chatLayout", "Conversation width")} controlId={chatLayoutControlId}>
            <select
              id={chatLayoutControlId}
              value={chatAppearance.layout}
              disabled={chatAppearanceSaving}
              onChange={(event) => {
                void saveChatAppearance({
                  ...chatAppearance,
                  layout: event.target.value as ChatLayout,
                });
              }}
              style={{ ...selectStyle, cursor: chatAppearanceSaving ? "wait" : "pointer" }}
            >
              <option value="fixed">{t("chatLayoutFixed", "Comfortable width")}</option>
              <option value="wide">{t("chatLayoutWide", "Expanded width")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("workStepDisplay", "Work steps")} controlId={workStepDisplayControlId}>
            <select
              id={workStepDisplayControlId}
              value={chatAppearance.workStepDisplay}
              disabled={chatAppearanceSaving}
              onChange={(event) => {
                void saveChatAppearance({
                  ...chatAppearance,
                  workStepDisplay: event.target.value as WorkStepDisplay,
                });
              }}
              style={{ ...selectStyle, cursor: chatAppearanceSaving ? "wait" : "pointer" }}
            >
              <option value="compact">{t("workStepDisplayCompact", "Compact")}</option>
              <option value="standard">{t("workStepDisplayStandard", "Standard")}</option>
              <option value="detailed">{t("workStepDisplayDetailed", "Detailed")}</option>
              <option value="verbose">{t("workStepDisplayVerbose", "Verbose")}</option>
            </select>
          </SettingRow>
          <p style={{ margin: "-4px 0 10px", fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)" }}>
            {t("workStepDisplayDescription", "Choose how much tool-call detail to show in the conversation.")}
          </p>
        </div>
        {chatAppearanceError && (
          <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--danger)" }}>
            {t("chatAppearanceSaveFailed", "Chat appearance could not be saved. The previous settings were restored.")}
          </p>
        )}
      </section>

      <hr />

      <section>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{t("appearance", "Appearance")}</h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("appearanceDescription", "Choose the color mode used by the app.")}
        </p>
        <SettingRow label={t("theme", "Theme")} controlId={themeControlId}>
          <select
            id={themeControlId}
            value={isDark ? "dark" : "light"}
            onChange={(event) => onThemeChange(event.target.value === "dark")}
            style={selectStyle}
          >
            <option value="light">{t("light", "Light")}</option>
            <option value="dark">{t("dark", "Dark")}</option>
          </select>
        </SettingRow>
      </section>
    </div>
  );
}

function SettingRow({ label, controlId, children }: { label: string; controlId: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        minHeight: 52,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-panel)",
      }}
    >
      <label htmlFor={controlId} style={{ fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ProjectRequired() {
  const { t } = useI18n();
  return (
    <div className="settings-panel-scroll">
      <div className="settings-panel-column">
        <section className="settings-empty-card">
          <div className="settings-empty-icon" aria-hidden="true">
            <FolderOpenOutlined />
          </div>
          <div>
            <h2>{t("projectRequiredTitle", "Select a project first")}</h2>
            <p>
              {t(
                "projectRequiredDescription",
                "Skills and plugins depend on the current project. Select a project directory from the sidebar first.",
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  minWidth: 160,
  minHeight: 36,
  padding: "7px 30px 7px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
};
