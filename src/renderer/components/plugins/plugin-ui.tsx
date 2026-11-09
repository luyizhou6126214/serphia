import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo, PluginPackageType } from "@/lib/api-types";
import { pluginScopeLabel, pluginStatusLabel } from "@/lib/plugin-presentation";
import { movePill, moveScopePill } from "./usePluginMotion";

export type PluginScope = PluginPackageInfo["scope"];

export type ActionTone = "primary" | "ghost" | "danger";

const TONES: Record<ActionTone, CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    borderColor: "var(--accent)",
  },
  ghost: {
    background: "var(--bg-panel)",
    color: "var(--text-muted)",
    borderColor: "var(--border)",
  },
  danger: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    borderColor: "var(--danger-border)",
  },
};

export function ActionButton({
  children,
  onClick,
  disabled = false,
  tone = "ghost",
  title,
  ariaLabel,
  compact = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: ActionTone;
  title?: string;
  ariaLabel?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        ...TONES[tone],
        minHeight: compact ? 28 : 32,
        padding: compact ? "4px 11px" : "6px 14px",
        borderRadius: 9,
        borderWidth: 1,
        borderStyle: "solid",
        fontSize: compact ? 11.5 : 12,
        fontWeight: tone === "primary" ? 600 : 500,
        letterSpacing: 0.1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

const TYPE_TONES: Record<PluginPackageType, { background: string; color: string; border: string }> = {
  extension: { background: "var(--accent-soft)", color: "var(--accent)", border: "var(--accent-soft-border)" },
  skill: { background: "var(--info-soft)", color: "var(--info)", border: "var(--info-border)" },
  theme: { background: "var(--warning-soft)", color: "var(--warning)", border: "var(--warning-border)" },
  prompt: { background: "var(--success-soft)", color: "var(--success)", border: "var(--success-border)" },
};

type Translate = (key: string, fallback: string) => string;

/** Explicit calls keep the i18n key audit static. */
export function pluginTypeLabel(type: PluginPackageType, t: Translate): string {
  switch (type) {
    case "extension":
      return t("pluginTypeExtension", "Extension");
    case "skill":
      return t("pluginTypeSkill", "Skill");
    case "theme":
      return t("pluginTypeTheme", "Theme");
    default:
      return t("pluginTypePrompt", "Prompt");
  }
}

export function TypeBadge({ type }: { type: PluginPackageType }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        ...TYPE_TONES[type],
        padding: "1px 7px",
        borderRadius: 999,
        borderWidth: 1,
        borderStyle: "solid",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.2,
        textTransform: "lowercase",
      }}
    >
      {pluginTypeLabel(type, t)}
    </span>
  );
}

const STATUS_TONES: Record<PluginPackageInfo["status"], { dot: string; background: string; color: string }> = {
  loaded: { dot: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" },
  installed: { dot: "var(--warning)", background: "var(--warning-soft)", color: "var(--warning)" },
  disabled: { dot: "var(--text-dim)", background: "var(--bg-subtle)", color: "var(--text-dim)" },
  missing: { dot: "var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" },
};

export function StatusPill({ status }: { status: PluginPackageInfo["status"] }) {
  const { t } = useI18n();
  const tone = STATUS_TONES[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.background,
        color: tone.color,
        fontSize: 10.5,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone.dot }} />
      {pluginStatusLabel(status, t)}
    </span>
  );
}

/** Deterministic monogram tile: no per-package hashing, same accent material. */
export function PackageGlyph({ name, size = 44 }: { name: string; size?: number }) {
  const stem = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  const letters = stem
    .replace(/^pi[-_]?/i, "")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, var(--accent-soft), var(--bg-panel))",
        border: "1px solid var(--accent-soft-border)",
        color: "var(--accent)",
        fontFamily: "var(--font-mono)",
        fontSize: Math.round(size * 0.32),
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      {letters || "PI"}
    </div>
  );
}

export function ScopeTag({ scope }: { scope: PluginScope }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        padding: "1px 7px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text-dim)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.2,
      }}
    >
      {pluginScopeLabel(scope, t)}
    </span>
  );
}

/** Two-seat scope switch with a sliding pill. */
export function PluginScopeSwitch({ value, onChange }: { value: PluginScope; onChange: (scope: PluginScope) => void }) {
  const { t } = useI18n();
  const pillRef = useRef<HTMLDivElement>(null);
  const project = value === "project";

  useEffect(() => {
    moveScopePill(pillRef.current, project);
  }, [project]);

  return (
    <div
      role="group"
      aria-label={t("pluginScope", "Package scope")}
      style={{
        position: "relative",
        display: "inline-flex",
        width: 168,
        height: 30,
        padding: 2,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        flexShrink: 0,
      }}
    >
      <div
        ref={pillRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: "calc(50% - 3px)",
          height: 24,
          borderRadius: 6,
          background: "var(--bg-selected)",
          border: "1px solid var(--border)",
          transform: project ? "translateX(100%)" : "none",
        }}
      />
      {(["global", "project"] as PluginScope[]).map((scope) => (
        <button
          key={scope}
          type="button"
          onClick={() => onChange(scope)}
          aria-pressed={value === scope}
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            border: "none",
            background: "none",
            color: value === scope ? "var(--text)" : "var(--text-dim)",
            fontSize: 11.5,
            fontWeight: value === scope ? 600 : 500,
            cursor: "pointer",
            borderRadius: 6,
          }}
        >
          {pluginScopeLabel(scope, t)}
        </button>
      ))}
    </div>
  );
}

/** Compact toggle; keeps the aria label the detail actions use. */
export function PluginSwitch({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        flexShrink: 0,
        width: 38,
        height: 21,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 180ms ease",
        opacity: loading ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 20 : 3,
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
          transition: "left 180ms cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

const TAB_WIDTH = 136;

/** Underline tabs: labels never overlap, and a thin accent bar slides under them. */
export function PluginTabSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    movePill(barRef.current, index);
  }, [index, options.length]);

  return (
    <div
      role="tablist"
      style={{
        position: "relative",
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: TAB_WIDTH,
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            style={{
              height: 38,
              padding: "0 12px",
              border: "none",
              background: "none",
              color: active ? "var(--text)" : "var(--text-dim)",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
      <div
        ref={barRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          bottom: -1,
          width: `calc(100% / ${options.length})`,
          height: 2,
          borderRadius: 2,
          background: "var(--accent)",
          transform: `translateX(${index * 100}%)`,
        }}
      />
    </div>
  );
}

export function PanelCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "var(--bg-panel)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: "var(--text-dim)",
      }}
    >
      {children}
    </div>
  );
}
