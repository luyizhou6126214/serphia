import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cpu, Settings2 } from "lucide-react";
import type { ReviewModelSelection } from "@contract/code-review";
import type { ModelsListResult } from "@contract/types";
import { thinkingMenuLevels, type ThinkingLevelOption } from "@shared/thinking-levels";
import { useI18n } from "@/i18n";
import { listModels } from "@/lib/api-client";
import { readLastModel, readLastThinkingLevel } from "@/lib/last-session-selection";
import { ReviewSelect } from "./ReviewSelect";
import { useReviewEntrance } from "./useReviewMotion";

export function useReviewModel(cwd: string | null, revision?: number) {
  const [catalog, setCatalog] = useState<ModelsListResult | null>(null);
  const [choice, setChoice] = useState<ReviewModelSelection | null>(null);

  useEffect(() => {
    let alive = true;
    void listModels(cwd ?? undefined)
      .then((value) => {
        if (alive) setCatalog(value);
      })
      .catch(() => {
        if (alive) setCatalog(null);
      });
    return () => {
      alive = false;
    };
  }, [cwd, revision]);

  const items = catalog?.models ?? [];
  const last = readLastModel();
  const candidates = [choice, last, catalog?.defaultModel];
  const match = candidates.find(
    (value) => value && items.some((item) => item.provider === value.provider && item.id === value.modelId),
  );
  const selected = match
    ? { provider: match.provider, modelId: match.modelId }
    : items.length
      ? { provider: items[0].provider, modelId: items[0].id }
      : null;
  const levels = selected ? catalog?.thinkingLevels?.[`${selected.provider}:${selected.modelId}`] : undefined;
  const thinking =
    match === choice && choice ? choice.thinking : match === last && last ? readLastThinkingLevel() : "auto";
  const model = selected && {
    ...selected,
    thinking: thinkingMenuLevels(levels).includes(thinking) ? thinking : ("auto" as const),
  };
  return { items, model, levels, setChoice };
}

export function ReviewModelPicker({
  selection,
  disabled,
  openSettings,
}: {
  selection: ReturnType<typeof useReviewModel>;
  disabled: boolean;
  openSettings: () => void;
}) {
  const { t } = useI18n();
  const { items, model, levels, setChoice } = selection;
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useReviewEntrance(menu, open && !disabled);
  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const entry = items.find((value) => value.id === model?.modelId && value.provider === model.provider);
  const providers = [...new Set(items.map((item) => item.provider))];
  const label: Record<ThinkingLevelOption, string> = {
    auto: t("thinkingAuto", "Auto"),
    off: t("thinkingOff", "Off"),
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
    max: t("thinkingMax", "Maximum"),
  };
  return (
    <div className="cr-model" ref={picker}>
      <button
        type="button"
        className="cr-control cr-model-trigger"
        ref={trigger}
        aria-expanded={open && !disabled}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Cpu size={15} />
        <span>{entry?.name ?? t("reviewSelectModel", "Choose a model")}</span>
        {model && <small>{label[model.thinking]}</small>}
        <ChevronDown size={13} />
      </button>
      {open && !disabled && (
        <div
          className="cr-model-menu"
          ref={menu}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !(
                event.target instanceof HTMLSelectElement &&
                CSS.supports("selector(select:open)") &&
                event.target.matches(":open")
              )
            ) {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {model && (
            <>
              <label>
                {t("reviewProvider", "Provider")}
                <ReviewSelect
                  label={t("reviewProvider", "Provider")}
                  value={model.provider}
                  onChange={(value) => {
                    const next = items.find((item) => item.provider === value);
                    if (next) setChoice({ provider: next.provider, modelId: next.id, thinking: "auto" });
                  }}
                >
                  {providers.map((provider) => (
                    <option key={provider}>{provider}</option>
                  ))}
                </ReviewSelect>
              </label>
              <label>
                {t("reviewModel", "Model")}
                <ReviewSelect
                  label={t("reviewModel", "Model")}
                  value={model.modelId}
                  onChange={(value) => setChoice({ ...model, modelId: value, thinking: "auto" })}
                >
                  {items
                    .filter((item) => item.provider === model.provider)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </ReviewSelect>
              </label>
              <label>
                {t("reviewReasoning", "Reasoning")}
                <ReviewSelect
                  label={t("reviewReasoning", "Reasoning")}
                  value={model.thinking}
                  onChange={(value) => setChoice({ ...model, thinking: value as ThinkingLevelOption })}
                >
                  {thinkingMenuLevels(levels).map((level) => (
                    <option value={level} key={level}>
                      {label[level]}
                    </option>
                  ))}
                </ReviewSelect>
              </label>
            </>
          )}
          <button
            type="button"
            className="cr-control"
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
          >
            <Settings2 size={14} />
            {t("reviewConfiguration", "Model settings")}
          </button>
        </div>
      )}
    </div>
  );
}
