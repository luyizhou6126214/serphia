import { Brain, CircleAlert, Feather, Hand, Lightbulb, Plus, ShieldHalf } from "lucide-react";
import { type ReactNode, memo, useEffect, useId, useState } from "react";
import { DeepAgentMenuScope } from "./DeepAgentMenuScope";
import type { ModelCatalogStatus } from "@contract/types";
import { useI18n } from "@/i18n";
import type { ToolPreset } from "@shared/tool-presets";
import {
  resolveReasoningLevel,
  thinkingMenuLevels,
  type ReasoningLevel,
  type ThinkingLevelOption,
} from "@shared/thinking-levels";

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
  onModelChange?: (provider: string, modelId: string) => void;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  toolSelectionError?: string;
  thinkingLevel?: ThinkingLevelOption;
  onThinkingLevelChange?: (level: ReasoningLevel) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
}

const TOOL_PRESETS = ["none", "default", "full"] as const;
const PERMISSION_ICONS = { none: Hand, default: ShieldHalf, full: CircleAlert };
const THINKING_ICONS = {
  minimal: Feather,
  low: Feather,
  medium: Lightbulb,
  high: Brain,
  xhigh: Brain,
  max: Brain,
};
const modelKey = (model: Pick<ModelOption, "provider" | "modelId">) => JSON.stringify([model.provider, model.modelId]);
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (
    MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
    MODEL_OPTION_COLLATOR.compare(a.provider, b.provider) ||
    MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId)
  );
}

/** Connect the model directory, thinking levels, and tool presets to the composer menus. */
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
    onModelChange,
    toolPreset,
    onToolPresetChange,
    toolSelectionError,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
  } = options;
  const permissionLayoutId = useId();
  const [activeMenu, setActiveMenu] = useState<"model" | "permission" | null>(null);
  const currentMenu = isStreaming ? null : activeMenu;

  useEffect(() => setActiveMenu(null), [isMobile, isStreaming]);

  const setMenuOpen = (menu: "model" | "permission", open: boolean) => {
    setActiveMenu((previous) => (open ? menu : previous === menu ? null : previous));
  };

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

  const modelsByProvider = new Map<string, ModelOption[]>();
  for (const option of modelOptions) {
    const group = modelsByProvider.get(option.provider);
    if (group) group.push(option);
    else modelsByProvider.set(option.provider, [option]);
  }
  const modelsByKey = new Map([...modelsByProvider.values()].flat().map((option) => [modelKey(option), option]));
  const selectedModelKey = model ? modelKey(model) : undefined;
  const currentModelName = selectedModelKey ? (modelsByKey.get(selectedModelKey)?.name ?? model?.modelId) : undefined;
  const multipleProviders = modelsByProvider.size > 1;

  const thinkingLabels: Record<ReasoningLevel, string> = {
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
    max: t("thinkingMax", "Maximum"),
  };
  const thinkingChoiceLabel = (level: ReasoningLevel): string => {
    const mapped = thinkingLevelMap?.[level];
    return mapped != null && mapped !== level ? `${thinkingLabels[level]} → ${mapped}` : thinkingLabels[level];
  };
  const thinkingSteps = thinkingMenuLevels(availableThinkingLevels);
  const currentThinking = resolveReasoningLevel(thinkingSteps, thinkingLevel);
  const thinkingOptions = thinkingSteps.map((id) => ({ id, label: thinkingChoiceLabel(id), icon: THINKING_ICONS[id] }));
  const labels: Record<ToolPreset, string> = {
    none: t("permissionReadOnly", "Read only"),
    default: t("permissionStandard", "Standard"),
    full: t("permissionFull", "Full access"),
  };
  const descriptions: Record<ToolPreset, string> = {
    none: t("permissionReadOnlyDescription", "No tools, read-only"),
    default: t("permissionStandardDescription", "4 built-in tools"),
    full: t("permissionFullDescription", "All tools, code orchestration, image generation, classification and search"),
  };
  const permissionOptions = TOOL_PRESETS.map((id) => ({
    id,
    label: labels[id],
    desc: descriptions[id],
    icon: PERMISSION_ICONS[id],
  }));
  const modelCatalogStatus = (modelCatalog?.source === "offline" || Boolean(modelCatalog?.warnings.length)) && (
    <div className="pt-1">
      {modelCatalog?.source === "offline" && (
        <div className="px-2 py-1 text-[11px] text-text-secondary">
          {t("modelsOfflineCache", "Offline: using the cached model directory.")}
        </div>
      )}
      {modelCatalog?.warnings?.map((warning) => (
        <div key={warning.provider + ":" + warning.code} role="alert" className="px-2 py-1 text-[11px]">
          {warning.message}
        </div>
      ))}
    </div>
  );

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
          <DeepAgentMenuScope>
            {({ ApprovalMenu }) => (
              <ApprovalMenu
                open={currentMenu === "permission"}
                onOpenChange={(open) => setMenuOpen("permission", open)}
                layoutId={permissionLayoutId}
                menuLabel={t("changePermission", "Change permission settings")}
                disabled={isStreaming}
                compact={isMobile}
                visibleOptions={permissionOptions}
                selectedApproval={permissionOptions[TOOL_PRESETS.indexOf(toolPreset ?? "default")]}
                chooseApproval={({ id }) => {
                  onToolPresetChange(id);
                  setMenuOpen("permission", false);
                }}
                error={toolSelectionError}
              />
            )}
          </DeepAgentMenuScope>
        )}
      </div>
      <div className="composer-toolbar-settings">
        {modelStatus}
        {(onThinkingLevelChange || onModelChange) && (
          <DeepAgentMenuScope>
            {({ ModelThinkingSelector }) => (
              <ModelThinkingSelector
                open={currentMenu === "model"}
                onOpenChange={(open) => setMenuOpen("model", open)}
                menuLabel={t("modelAndReasoning", "Model and reasoning")}
                selectModelLabel={t("models", "Models")}
                modelsLabel={t("models", "Models")}
                noModelsLabel={t("composerNoModels", "No models available")}
                reasoningLabel={t("composerEffortTitle", "Reasoning effort")}
                disabled={isStreaming}
                showThinking={Boolean(onThinkingLevelChange && currentThinking)}
                thinkingDisabled={isStreaming}
                models={[...modelsByKey.keys()]}
                selectedModel={selectedModelKey}
                getModelLabel={(id) => modelsByKey.get(id)?.name ?? currentModelName ?? id}
                getModelGroup={multipleProviders ? (id) => modelsByKey.get(id)?.provider : undefined}
                selectedThinking={currentThinking}
                thinkingOptions={thinkingOptions}
                modelStatus={modelCatalogStatus}
                onChooseModel={(id) => {
                  const option = modelsByKey.get(id);
                  if (option && (id !== selectedModelKey || isAutoModelSelection)) {
                    onModelChange?.(option.provider, option.modelId);
                  }
                }}
                onChooseThinking={(next) => {
                  if (next !== currentThinking && thinkingSteps.includes(next)) onThinkingLevelChange?.(next);
                }}
              />
            )}
          </DeepAgentMenuScope>
        )}
      </div>
      {isStreaming && (
        <button
          type="button"
          onClick={() => {
            setActiveMenu(null);
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
