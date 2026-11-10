import { Check, ChevronDown, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ModelCatalogStatus } from "@contract/types";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { ToolPreset, SelectableToolPreset } from "@shared/tool-presets";
import { thinkingMenuLevels, type ThinkingLevelOption } from "@shared/thinking-levels";

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export interface ComposerToolbarOptions {
  onAbort: () => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelStatus?: ReactNode;
  modelList?: { id: string; name: string; provider: string }[];
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelsRefreshCancel?: () => void;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: SelectableToolPreset) => void;
  toolSelectionError?: string;
  thinkingLevel?: ThinkingLevelOption;
  onThinkingLevelChange?: (level: ThinkingLevelOption) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
}

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = {
  off: "none",
  default: "default",
  full: "full",
};
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (
    MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
    MODEL_OPTION_COLLATOR.compare(a.provider, b.provider) ||
    MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId)
  );
}

/** Local menu placement, dismissal and focus ownership for the composer controls. */
function ComposerToolbarView({
  options,
  isMobile,
  hasAttachments,
  onAttach,
}: {
  options: ComposerToolbarOptions;
  isMobile: boolean;
  hasAttachments: boolean;
  onAttach: () => void;
}) {
  const { t } = useI18n();
  const {
    onAbort,
    isStreaming,
    model,
    isAutoModelSelection,
    modelNames,
    modelStatus,
    modelList,
    modelCatalog,
    modelRefreshing,
    onModelChange,
    onModelsRefresh,
    onModelsRefreshCancel,
    toolPreset,
    onToolPresetChange,
    toolSelectionError,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
  } = options;
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
    viewportWidth: number;
    viewportHeight: number;
  } | null>(null);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const toolButtonRef = useRef<HTMLButtonElement>(null);
  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {})
      .map(([modelId, name]) => ({
        provider: model?.provider ?? "unknown",
        modelId,
        name,
      }))
      .sort(compareModelOptions);
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const thinkingLabels: Record<ThinkingLevelOption, string> = {
    auto: t("thinkingAuto", "Auto"),
    off: t("thinkingOff", "Off"),
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
    max: t("thinkingMax", "Maximum"),
  };
  const thinkingDescriptions: Record<ThinkingLevelOption, string> = {
    auto: t("thinkingDefaultDescription", "Use Pi default"),
    off: t("thinkingOffDescription", "Reasoning off"),
    minimal: t("thinkingMinimalDescription", "Minimal reasoning"),
    low: t("thinkingLowDescription", "Low reasoning"),
    medium: t("thinkingMediumDescription", "Medium reasoning"),
    high: t("thinkingHighDescription", "High reasoning"),
    xhigh: t("thinkingXHighDescription", "Extra-high reasoning"),
    max: t("thinkingMaxDescription", "Maximum reasoning"),
  };
  const thinkingChoiceLabel = (level: ThinkingLevelOption): string => {
    const mapped = level === "auto" ? undefined : thinkingLevelMap?.[level];
    return mapped != null && mapped !== level ? `${thinkingLabels[level]} → ${mapped}` : thinkingLabels[level];
  };
  const thinkingDisplayLabel = thinkingChoiceLabel(thinkingLevel ?? "auto");
  const thinkingSteps = thinkingMenuLevels(availableThinkingLevels);
  const thinkingStep = Math.max(0, thinkingSteps.indexOf(thinkingLevel ?? "auto"));
  const currentThinkingDescription =
    thinkingLevel &&
    thinkingLevel !== "auto" &&
    thinkingLevelMap?.[thinkingLevel] != null &&
    thinkingLevelMap[thinkingLevel] !== thinkingLevel
      ? t("thinkingMappedDescription", "Provider value: {value}").replace("{value}", thinkingLevelMap[thinkingLevel]!)
      : thinkingDescriptions[thinkingLevel ?? "auto"];

  const toolPresetKey =
    toolPreset === "custom"
      ? "custom"
      : ((Object.entries(TOOL_PRESET_MAP).find(([, value]) => value === (toolPreset ?? "default"))?.[0] as
          "off" | "default" | "full" | undefined) ?? "default");
  const toolPresetLabels: Record<"off" | "default" | "full" | "custom", string> = {
    off: t("permissionReadOnly", "Read only"),
    default: t("permissionStandard", "Standard"),
    full: t("permissionFull", "Full access"),
    custom: t("permissionCustom", "Custom"),
  };
  const toolPresetLabel = toolPresetLabels[toolPresetKey];
  const closeControlDropdowns = useCallback(() => {
    setModelDropdownOpen(false);
    setToolDropdownOpen(false);
  }, []);

  const updateDropdownRect = useCallback(() => {
    const button = toolDropdownOpen ? toolButtonRef.current : modelButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
    };
    setDropdownRect((previous) =>
      previous &&
      previous.top === next.top &&
      previous.bottom === next.bottom &&
      previous.left === next.left &&
      previous.width === next.width &&
      previous.viewportWidth === next.viewportWidth &&
      previous.viewportHeight === next.viewportHeight
        ? previous
        : next,
    );
  }, [toolDropdownOpen]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuPanelRef.current?.contains(target)) return;
      if (!dropdownRef.current?.contains(target)) setModelDropdownOpen(false);
      if (!toolDropdownRef.current?.contains(target)) setToolDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeControlDropdowns]);

  useEffect(() => {
    closeControlDropdowns();
  }, [closeControlDropdowns, isMobile, isStreaming]);

  const modelDropdownWasOpenRef = useRef(false);
  useEffect(() => {
    if (modelDropdownWasOpenRef.current && !modelDropdownOpen && modelRefreshing) onModelsRefreshCancel?.();
    modelDropdownWasOpenRef.current = modelDropdownOpen;
  }, [modelDropdownOpen, modelRefreshing, onModelsRefreshCancel]);

  useLayoutEffect(() => {
    if (!modelDropdownOpen && !toolDropdownOpen) return;
    updateDropdownRect();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updateDropdownRect());
    const button = toolDropdownOpen ? toolButtonRef.current : modelButtonRef.current;
    if (button) observer?.observe(button);
    if (dropdownRef.current?.parentElement) observer?.observe(dropdownRef.current.parentElement);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateDropdownRect);
    window.addEventListener("scroll", updateDropdownRect, true);
    visualViewport?.addEventListener("resize", updateDropdownRect);
    visualViewport?.addEventListener("scroll", updateDropdownRect);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
      visualViewport?.removeEventListener("resize", updateDropdownRect);
      visualViewport?.removeEventListener("scroll", updateDropdownRect);
    };
  }, [modelDropdownOpen, toolDropdownOpen, updateDropdownRect]);

  useEffect(() => {
    if (!modelDropdownOpen && !toolDropdownOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const button = modelDropdownOpen ? modelButtonRef.current : toolButtonRef.current;
      closeControlDropdowns();
      button?.focus();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [closeControlDropdowns, modelDropdownOpen, toolDropdownOpen]);

  const hasDropdownRect = dropdownRect !== null;
  useEffect(() => {
    menuPanelRef.current?.focus();
  }, [modelDropdownOpen, toolDropdownOpen, hasDropdownRect]);

  const viewportWidth = dropdownRect?.viewportWidth ?? 1200;
  const viewportHeight = dropdownRect?.viewportHeight ?? 800;
  const menuWidth = Math.min(modelDropdownOpen ? 320 : toolDropdownOpen ? 304 : 264, viewportWidth - 16);
  const spaceAbove = Math.max(0, (dropdownRect?.top ?? 0) - 16);
  const spaceBelow = Math.max(0, viewportHeight - (dropdownRect?.bottom ?? 0) - 16);
  const openAbove = spaceAbove >= Math.min(viewportHeight * 0.55, 320) || spaceAbove >= spaceBelow;
  const menuStyle: CSSProperties = {
    position: "fixed",
    width: menuWidth,
    left: Math.max(
      8,
      Math.min((dropdownRect?.left ?? 8) + (dropdownRect?.width ?? 0) - menuWidth, viewportWidth - menuWidth - 8),
    ),
    ...(openAbove
      ? { bottom: viewportHeight - (dropdownRect?.top ?? 0) + 8 }
      : { top: (dropdownRect?.bottom ?? 0) + 8 }),
    maxHeight: Math.min(440, openAbove ? spaceAbove : spaceBelow),
    fontSize: scaledChatFont(12),
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches("input[type=range]")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        "button:not(:disabled), input[type=range]:not(:disabled)",
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    const focusedIndex = items.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
    const current = focusedIndex < 0 && event.key === "ArrowUp" ? 0 : focusedIndex;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div className="composer-toolbar">
      <div className="composer-toolbar-primary">
        <button
          className="composer-toolbar-attach"
          onClick={onAttach}
          title={t(
            "attachLocalFilesDescription",
            "Add images or local file references. The agent reads absolute paths on this computer; moved files, remote agents, or sandboxes may not be able to access them.",
          )}
          aria-label={t("attachLocalFiles", "Add images or local file references")}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            padding: 0,
            background: hasAttachments ? "var(--accent-soft)" : "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            color: hasAttachments ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            opacity: 1,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = hasAttachments ? "var(--accent)" : "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = hasAttachments ? "var(--accent-soft)" : "var(--bg-panel)";
            e.currentTarget.style.color = hasAttachments ? "var(--accent)" : "var(--text-muted)";
          }}
        >
          <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {onToolPresetChange && (
          <div ref={toolDropdownRef} style={{ position: "relative" }}>
            <button
              ref={toolButtonRef}
              className="composer-toolbar-control"
              type="button"
              aria-haspopup="menu"
              aria-expanded={toolDropdownOpen}
              onClick={() => {
                if (isStreaming) return;
                setModelDropdownOpen(false);
                setToolDropdownOpen((v) => !v);
              }}
              disabled={isStreaming}
              title={`${t("changePermission", "Change permission settings")}: ${toolPresetLabel}`}
              aria-label={`${t("changePermission", "Change permission settings")}: ${toolPresetLabel}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: isMobile ? 0 : "0 9px",
                minWidth: 32,
                minHeight: 32,
                background: toolDropdownOpen ? "var(--bg-selected)" : "var(--bg-panel)",
                border: `1px solid ${toolPresetKey === "full" ? "rgba(239,68,68,0.35)" : "var(--border)"}`,
                borderRadius: 9,
                color: "var(--text-muted)",
                cursor: isStreaming ? "not-allowed" : "pointer",
                fontSize: scaledChatFont(12),
                opacity: isStreaming ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-selected)" : "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <ShieldCheck size={15} strokeWidth={1.7} aria-hidden="true" />
              {!isMobile && (
                <span style={{ whiteSpace: "nowrap" }}>
                  {t("permissionShort", "Access")}: {toolPresetLabel}
                </span>
              )}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {toolDropdownOpen &&
              dropdownRect &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  className="composer-menu chat-appearance-scope"
                  role="menu"
                  tabIndex={-1}
                  aria-label={t("changePermission", "Change permission settings")}
                  onKeyDown={handleMenuKeyDown}
                  style={menuStyle}
                >
                  <div className="composer-menu-heading">{t("permissionShort", "Access")}</div>
                  {TOOL_PRESETS.map((lvl) => {
                    const preset = TOOL_PRESET_MAP[lvl];
                    const isActive = (toolPreset ?? "default") === preset;
                    const desc =
                      lvl === "off"
                        ? t("permissionReadOnlyDescription", "No tools, read-only")
                        : lvl === "default"
                          ? t("permissionStandardDescription", "4 built-in tools")
                          : t(
                              "permissionFullDescription",
                              "All tools, code orchestration, image generation, classification and search",
                            );
                    return (
                      <button
                        key={lvl}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className="composer-menu-item"
                        onClick={() => {
                          onToolPresetChange(preset);
                          setToolDropdownOpen(false);
                          toolButtonRef.current?.focus();
                        }}
                      >
                        <span className="composer-menu-copy">
                          <span className="composer-menu-label">{toolPresetLabels[lvl]}</span>
                          <span className="composer-menu-description">{desc}</span>
                        </span>
                        <Check size={15} strokeWidth={2} className="composer-menu-check" aria-hidden="true" />
                      </button>
                    );
                  })}
                  {toolSelectionError && (
                    <div role="alert" className="composer-menu-error">
                      {toolSelectionError}
                    </div>
                  )}
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>
      <div className="composer-toolbar-settings">
        {modelStatus}
        {(onThinkingLevelChange || onModelsRefresh || (modelOptions.length > 0 && currentName && onModelChange)) && (
          <div ref={dropdownRef} style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
            <button
              ref={modelButtonRef}
              className="composer-toolbar-model"
              aria-label={`${t("modelAndReasoning", "Model and reasoning")}: ${currentName ?? t("models", "Models")}${onThinkingLevelChange ? ` · ${thinkingDisplayLabel}` : ""}`}
              type="button"
              title={`${currentName ?? t("models", "Models")}${onThinkingLevelChange ? ` · ${thinkingDisplayLabel}` : ""}`}
              aria-haspopup="menu"
              aria-expanded={modelDropdownOpen}
              onClick={() => {
                setToolDropdownOpen(false);
                updateDropdownRect();
                setModelDropdownOpen((v) => !v);
              }}
              disabled={isStreaming}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: isMobile ? "flex-start" : undefined,
                padding: isMobile ? "8px 10px" : "8px 12px",
                minHeight: 32,
                width: isMobile ? "100%" : undefined,
                maxWidth: "100%",
                overflow: "hidden",
                background: modelDropdownOpen ? "var(--bg-selected)" : "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 9,
                color: "var(--text-muted)",
                cursor: isStreaming ? "not-allowed" : "pointer",
                fontSize: scaledChatFont(12),
                opacity: isStreaming ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-selected)" : "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <span className="composer-model-name">{currentName ?? t("models", "Models")}</span>
              {onThinkingLevelChange && (
                <>
                  <span className="composer-model-divider" aria-hidden="true" />
                  <span className="composer-model-effort">{thinkingDisplayLabel}</span>
                </>
              )}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {modelDropdownOpen &&
              dropdownRect &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  className="composer-menu chat-appearance-scope"
                  role="menu"
                  tabIndex={-1}
                  aria-label={t("modelAndReasoning", "Model and reasoning")}
                  onKeyDown={handleMenuKeyDown}
                  style={menuStyle}
                >
                  {onModelsRefresh && (
                    <div className="composer-menu-refresh">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={modelRefreshing}
                        onClick={() => void onModelsRefresh?.()}
                        className="composer-menu-item"
                      >
                        <RefreshCw size={14} strokeWidth={1.7} aria-hidden="true" />
                        {modelRefreshing
                          ? t("refreshingModels", "Refreshing model directory…")
                          : t("refreshModels", "Refresh model directory")}
                      </button>
                      {modelCatalog?.source === "offline" && (
                        <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: scaledChatFont(11) }}>
                          {t("modelsOfflineCache", "Offline: using the cached model directory.")}
                        </div>
                      )}
                      {(modelCatalog?.warnings ?? []).map((warning) => (
                        <div
                          key={`${warning.provider}:${warning.code}`}
                          role="alert"
                          style={{
                            marginTop: 6,
                            color: "var(--warning)",
                            fontSize: scaledChatFont(11),
                            whiteSpace: "normal",
                          }}
                        >
                          {warning.message}
                        </div>
                      ))}
                    </div>
                  )}
                  {modelOptions.length > 0 && (
                    <>
                      <div className="composer-menu-heading">{t("models", "Models")}</div>
                      <div className="composer-model-options" role="group" aria-label={t("models", "Models")}>
                        {modelsByProvider.map((group) => (
                          <div key={group.provider}>
                            {modelsByProvider.length > 1 && <div className="composer-menu-group">{group.provider}</div>}
                            {group.options.map((opt) => {
                              const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                              return (
                                <button
                                  key={`${opt.provider}:${opt.modelId}`}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={isActive}
                                  className="composer-menu-item"
                                  onClick={() => {
                                    setModelDropdownOpen(false);
                                    if (!isActive || isAutoModelSelection) onModelChange?.(opt.provider, opt.modelId);
                                    modelButtonRef.current?.focus();
                                  }}
                                >
                                  <span className="composer-menu-label">{opt.name}</span>
                                  <Check size={15} strokeWidth={2} className="composer-menu-check" aria-hidden="true" />
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {onThinkingLevelChange && (
                    <div className="composer-reasoning-section">
                      <div className="composer-reasoning-heading">
                        <span>{t("reasoningShort", "Reasoning")}</span>
                        <span className="composer-reasoning-value">{thinkingDisplayLabel}</span>
                      </div>
                      <div
                        className="composer-reasoning-slider"
                        style={
                          {
                            "--reasoning-progress": `${(thinkingStep / Math.max(1, thinkingSteps.length - 1)) * 100}%`,
                          } as CSSProperties
                        }
                      >
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, thinkingSteps.length - 1)}
                          step={1}
                          value={thinkingStep}
                          disabled={thinkingSteps.length < 2 || isStreaming}
                          aria-label={t("changeThinkingLevel", "Change reasoning level")}
                          aria-valuetext={thinkingDisplayLabel}
                          title={currentThinkingDescription}
                          onChange={(event) => {
                            const next = thinkingSteps[Number(event.currentTarget.value)];
                            if (next && next !== (thinkingLevel ?? "auto")) onThinkingLevelChange(next);
                          }}
                        />
                        <div className="composer-reasoning-ticks" aria-hidden="true">
                          {thinkingSteps.map((level, index) => (
                            <span key={level} title={thinkingChoiceLabel(level)} data-filled={index <= thinkingStep} />
                          ))}
                        </div>
                        <div className="composer-reasoning-endpoints" aria-hidden="true">
                          <span>{thinkingChoiceLabel(thinkingSteps[0])}</span>
                          <span>{thinkingChoiceLabel(thinkingSteps[thinkingSteps.length - 1])}</span>
                        </div>
                      </div>
                      <p className="composer-reasoning-description">{currentThinkingDescription}</p>
                    </div>
                  )}
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>
      {isStreaming && (
        <button
          type="button"
          onClick={() => {
            closeControlDropdowns();
            onAbort();
          }}
          className="chat-composer-stop"
          aria-label={t("stopAgent", "Stop agent")}
          title={t("stopAgent", "Stop agent")}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
          </svg>
          <span className="sr-only">{t("stop", "Stop")}</span>
        </button>
      )}
    </div>
  );
}

export const ComposerToolbar = memo(ComposerToolbarView, (previous, next) => {
  if (
    previous.isMobile !== next.isMobile ||
    previous.hasAttachments !== next.hasAttachments ||
    previous.onAttach !== next.onAttach
  )
    return false;
  const keys = Object.keys(previous.options) as (keyof ComposerToolbarOptions)[];
  return (
    keys.length === Object.keys(next.options).length &&
    keys.every((key) => Object.is(previous.options[key], next.options[key]))
  );
});
