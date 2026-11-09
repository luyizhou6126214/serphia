import { useMemo, useRef } from "react";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo } from "@/lib/api-types";
import { pluginResourceSummary, pluginVersionSummary } from "@/lib/plugin-presentation";
import { ActionButton, PackageGlyph } from "./plugin-ui";
import { useStaggerIn } from "./usePluginMotion";

export type PluginScope = PluginPackageInfo["scope"];

const STATUS_DOT: Record<PluginPackageInfo["status"], string> = {
  loaded: "var(--accent)",
  installed: "var(--warning)",
  disabled: "var(--text-dim)",
  missing: "var(--danger)",
};

function shortVersion(pkg: PluginPackageInfo): string | undefined {
  return pkg.version ?? pkg.configuredVersion;
}

export function PluginList({
  groups,
  selected,
  addMode,
  loading,
  error,
  onSelect,
  onAdd,
}: {
  groups: Array<{ scope: PluginScope; packages: PluginPackageInfo[] }>;
  selected: string | null;
  addMode: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (key: string) => void;
  onAdd: () => void;
}) {
  const { language, t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const signature = useMemo(
    () => groups.flatMap((group) => group.packages.map((pkg) => `${pkg.scope}:${pkg.source}:${pkg.status}`)).join("|"),
    [groups],
  );
  useStaggerIn(listRef, "[data-plugin-item]", signature || "empty", { y: 6, stagger: 0.02, duration: 0.22 });

  const count = groups.reduce((total, group) => total + group.packages.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "2px 8px 8px",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          {t("pluginInstalledSection", "Installed")}
        </span>
        <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 4px 8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading ? (
          <div style={{ padding: "12px 8px", fontSize: 12, color: "var(--text-muted)" }}>
            {t("loading", "Loading…")}
          </div>
        ) : error ? (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "var(--danger)" }}>{error}</div>
        ) : count === 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: 190,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              padding: "16px 10px",
              textAlign: "center",
            }}
          >
            <PackageGlyph name="pi" size={38} />
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("pluginNoPackages", "No packages installed")}
            </div>
            <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--text-dim)", maxWidth: 180 }}>
              {t("pluginNoPackagesHint", "Browse the marketplace to add tools, skills, themes, and prompts.")}
            </div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.scope} style={{ marginBottom: 8 }}>
              <div
                style={{
                  padding: "8px 8px 4px",
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "var(--text-dim)",
                }}
              >
                {group.scope === "project" ? t("pluginScopeProject", "project") : t("pluginScopeGlobal", "global")}
              </div>
              {group.packages.map((pkg) => {
                const key = `${pkg.scope}\0${pkg.source}`;
                const isSelected = !addMode && selected === key;
                return (
                  <div
                    key={key}
                    data-plugin-item="true"
                    role="button"
                    tabIndex={0}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onSelect(key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(key);
                      }
                    }}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "9px 9px 9px 11px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isSelected ? "var(--bg-selected)" : "transparent",
                      transition: "background 140ms ease",
                    }}
                    onMouseEnter={(event) => {
                      if (!isSelected) event.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(event) => {
                      if (!isSelected) event.currentTarget.style.background = "transparent";
                    }}
                  >
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 9,
                          bottom: 9,
                          width: 2,
                          borderRadius: 2,
                          background: "var(--accent)",
                        }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        marginTop: 5,
                        flexShrink: 0,
                        background: STATUS_DOT[pkg.status],
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: isSelected ? 600 : 500,
                          color: "var(--text)",
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {pkg.packageName ?? pkg.source.replace(/^npm:/, "")}
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 10,
                          color: "var(--text-dim)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {pluginResourceSummary(pkg, language, t)}
                      </div>
                      {shortVersion(pkg) && (
                        <div
                          style={{
                            marginTop: 1,
                            fontSize: 9.5,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pluginVersionSummary(pkg, t)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div style={{ padding: "8px 4px 0", borderTop: "1px solid var(--border)" }}>
        <ActionButton
          onClick={onAdd}
          compact
          tone={addMode ? "primary" : "ghost"}
          ariaLabel={t("addPlugin", "Add plugin")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("addPlugin", "Add plugin")}
          </span>
        </ActionButton>
      </div>
    </div>
  );
}
