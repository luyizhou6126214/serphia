import { useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo } from "@/lib/api-types";
import { shortenHomePath } from "@/lib/plugin-presentation";
import { PluginSearchPanel } from "./PluginSearchPanel";
import { ActionButton, PanelCard, PluginScopeSwitch, PluginTabSwitch, SectionLabel } from "./plugin-ui";
import { useRiseIn } from "./usePluginMotion";

export type PluginScope = PluginPackageInfo["scope"];
type AddTab = "market" | "source";

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project" ? `${shortenHomePath(cwd)}/.pi/agent/{npm,git}` : "~/.pi/agent/{npm,git}";
}

export function AddPluginPanel({
  cwd,
  source,
  scope,
  busy,
  applying,
  actionError,
  actionMessage,
  packages,
  onSourceChange,
  onScopeChange,
  onInstall,
  onSearchInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  busy: boolean;
  applying: boolean;
  actionError: string | null;
  actionMessage: string | null;
  packages: PluginPackageInfo[];
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
  onSearchInstall: (name: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<AddTab>("market");
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];
  useRiseIn(contentRef, tab);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <PluginTabSwitch<AddTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "market", label: t("pluginTabMarket", "Marketplace") },
            { value: "source", label: t("pluginTabSource", "From source") },
          ]}
        />
        <PluginScopeSwitch value={scope} onChange={onScopeChange} />
      </div>

      <div ref={contentRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "market" ? (
          <PluginSearchPanel packages={packages} onInstall={onSearchInstall} />
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <PanelCard style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <SectionLabel>{t("pluginSourceInstall", "Package source")}</SectionLabel>
                <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  {installLocation(scope, cwd)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  id="plugin-source"
                  ref={inputRef}
                  value={source}
                  onChange={(event) => onSourceChange(event.target.value)}
                  placeholder={t("pluginSourcePlaceholder", "npm:@scope/package")}
                  aria-label={t("pluginSource", "Source")}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 40,
                    padding: "0 12px",
                    border: "1px solid var(--border)",
                    borderRadius: 9,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    outline: "none",
                    transition: "border-color 140ms ease, box-shadow 140ms ease",
                  }}
                  onFocus={(event) => {
                    event.currentTarget.style.borderColor = "var(--accent-soft-border)";
                    event.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
                  }}
                  onBlur={(event) => {
                    event.currentTarget.style.borderColor = "var(--border)";
                    event.currentTarget.style.boxShadow = "none";
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && source.trim() && !busy) onInstall();
                  }}
                />
                <ActionButton
                  tone="primary"
                  onClick={onInstall}
                  disabled={busy || !source.trim()}
                  ariaLabel={t("install", "Install")}
                >
                  {busy ? t("installing", "Installing…") : t("install", "Install")}
                </ActionButton>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("pluginExamples", "Examples")}</span>
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      onSourceChange(example);
                      inputRef.current?.focus();
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      transition: "background 140ms ease, color 140ms ease",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "var(--bg-hover)";
                      event.currentTarget.style.color = "var(--text-muted)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "var(--bg)";
                      event.currentTarget.style.color = "var(--text-dim)";
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10.5, lineHeight: 1.55, color: "var(--text-dim)" }}>
                {t(
                  "pluginSourceHint",
                  "npm packages, a git URL, or a local path. Manual sources are installed with Pi's package manager.",
                )}
              </div>
            </PanelCard>
          </div>
        )}
      </div>

      {applying && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("pluginApplyingToSession", "Applying to the active session…")}
        </div>
      )}
      {actionMessage && <div style={{ fontSize: 12, color: "var(--accent)" }}>{actionMessage}</div>}
      {actionError && <div style={{ fontSize: 12, color: "var(--danger)", whiteSpace: "pre-wrap" }}>{actionError}</div>}
    </div>
  );
}
