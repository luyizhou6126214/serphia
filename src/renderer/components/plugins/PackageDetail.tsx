import { useRef, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { PluginActionParams, PluginPackageInfo } from "@/lib/api-types";
import {
  pluginResourceSummary,
  pluginVersionSummary,
  shortenHomePath,
  pluginStatusLabel,
} from "@/lib/plugin-presentation";
import {
  ActionButton,
  PackageGlyph,
  PanelCard,
  PluginSwitch,
  ScopeTag,
  SectionLabel,
  StatusPill,
  TypeBadge,
} from "./plugin-ui";
import { useRiseIn } from "./usePluginMotion";

export type PluginAction = PluginActionParams["action"];

type Translate = (key: string, fallback: string) => string;

const RESOURCE_GROUPS: Array<{
  kind: PluginPackageInfo["resources"][number]["kind"];
  label: (t: Translate) => string;
}> = [
  { kind: "extension", label: (t) => t("pluginExtensions", "Extensions") },
  { kind: "skill", label: (t) => t("skills", "Skills") },
  { kind: "prompt", label: (t) => t("pluginPrompts", "Prompts") },
  { kind: "theme", label: (t) => t("pluginThemes", "Themes") },
];

const RESOURCE_TYPE: Record<
  PluginPackageInfo["resources"][number]["kind"],
  "extension" | "skill" | "prompt" | "theme"
> = {
  extension: "extension",
  skill: "skill",
  prompt: "prompt",
  theme: "theme",
};

function ResourceRows({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = RESOURCE_GROUPS.map((group) => ({
    ...group,
    resources: pkg.resources.filter((resource) => resource.kind === group.kind),
  })).filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
        {pkg.disabled
          ? t("pluginPackageDisabled", "Package disabled")
          : t("pluginNoResolvedResources", "No resolved resources")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map((group) => (
        <div key={group.kind} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <SectionLabel>
            {group.label(t)} · {group.resources.length}
          </SectionLabel>
          {group.resources.map((resource) => (
            <div
              key={`${resource.kind}:${resource.path}`}
              title={resource.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 9px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <TypeBadge type={RESOURCE_TYPE[resource.kind]} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {resource.relativePath || resource.name}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  applying,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  applying: boolean;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { language, t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const key = `${pkg.scope}\0${pkg.source}`;
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  useRiseIn(ref, `${key}:${pkg.status}`);

  const meta: Array<{ label: string; value: ReactNode; mono?: boolean; tone?: string }> = [
    { label: t("pluginStatus", "Status"), value: pluginStatusLabel(pkg.status, t), tone: "var(--text-muted)" },
    {
      label: t("pluginVersion", "Version"),
      value: pluginVersionSummary(pkg, t),
      mono: true,
      tone: "var(--text-muted)",
    },
    {
      label: t("pluginPackage", "Package"),
      value: pkg.packageName ?? t("unknown", "unknown"),
      mono: true,
      tone: "var(--text-muted)",
    },
    {
      label: t("pluginResources", "Resources"),
      value: pluginResourceSummary(pkg, language, t),
      tone: "var(--text-muted)",
    },
    {
      label: t("pluginInstalledPath", "Installed path"),
      value: pkg.installedPath ? shortenHomePath(pkg.installedPath) : t("pluginNotFound", "Not found"),
      mono: true,
      tone: pkg.installedPath ? "var(--text-muted)" : "var(--danger)",
    },
    { label: t("pluginCwd", "Cwd"), value: shortenHomePath(cwd), mono: true, tone: "var(--text-dim)" },
  ];

  return (
    <div
      ref={ref}
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 900, margin: "0 auto" }}
    >
      <PanelCard style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <PackageGlyph name={pkg.packageName ?? pkg.source} size={52} />
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pkg.source}
              </span>
              <StatusPill status={pkg.status} />
              <ScopeTag scope={pkg.scope} />
              {pkg.filtered && !pkg.disabled && (
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: "var(--warning-soft)",
                    border: "1px solid var(--warning-border)",
                    color: "var(--warning)",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {t("pluginFiltered", "filtered")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {pkg.installedPath ? shortenHomePath(pkg.installedPath) : t("pluginNotFound", "Not found")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PluginSwitch
              enabled={enabled}
              loading={busy || reloadBusy}
              onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
              label={
                pkg.disabled ? t("pluginEnablePackage", "Enable package") : t("pluginDisablePackage", "Disable package")
              }
            />
            <ActionButton
              onClick={() => onAction("update", pkg)}
              disabled={busy || reloadBusy}
              ariaLabel={t("pluginUpdate", "Update")}
            >
              {busyKey === `update:${key}` ? t("pluginUpdating", "Updating…") : t("pluginUpdate", "Update")}
            </ActionButton>
            <ActionButton
              tone="danger"
              onClick={() => onAction("remove", pkg)}
              disabled={busy || reloadBusy}
              ariaLabel={t("pluginRemove", "Remove")}
            >
              {busyKey === `remove:${key}` ? t("pluginRemoving", "Removing…") : t("pluginRemove", "Remove")}
            </ActionButton>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("pluginReloadHint", "Reload applies resource changes to the open session.")}
          </span>
          <ActionButton
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            title={
              sessionId
                ? t("pluginReloadCurrentSession", "Reload current session")
                : t("pluginOpenSessionToReload", "Open a session to reload")
            }
          >
            {reloadBusy ? t("pluginReloading", "Reloading…") : t("pluginReloadSession", "Reload session")}
          </ActionButton>
        </div>
      </PanelCard>

      <PanelCard style={{ padding: 18 }}>
        <SectionLabel>{t("pluginDetails", "Details")}</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(92px, 128px) minmax(0, 1fr)",
            gap: "9px 16px",
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {meta.map((row) => (
            <div key={row.label} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-dim)" }}>{row.label}</div>
              <div
                style={{
                  color: row.tone ?? "var(--text-muted)",
                  fontFamily: row.mono ? "var(--font-mono)" : undefined,
                  overflowWrap: "anywhere",
                  minWidth: 0,
                }}
              >
                {row.value}
              </div>
            </div>
          ))}
        </div>
      </PanelCard>

      <PanelCard style={{ padding: 18 }}>
        <SectionLabel>{t("pluginResolvedResources", "Resolved resources")}</SectionLabel>
        <div style={{ marginTop: 10 }}>
          <ResourceRows pkg={pkg} />
        </div>
      </PanelCard>

      {applying && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("pluginApplyingToSession", "Applying to the active session…")}
        </div>
      )}
      {actionMessage && <div style={{ fontSize: 12, color: "var(--success)" }}>{actionMessage}</div>}
      {actionError && <div style={{ fontSize: 12, color: "var(--danger)", whiteSpace: "pre-wrap" }}>{actionError}</div>}
    </div>
  );
}
