import { THINKING_LEVELS, type ThinkingLevelOption } from "@shared/thinking-levels";

export type SelectedModel = { provider: string; modelId: string };
const MODEL_KEY = "serphia-last-model";
const THINKING_KEY = "serphia-last-thinking-level";

export function readLastModel(): SelectedModel | null {
  try {
    const value = JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null");
    return typeof value?.provider === "string" && value.provider && typeof value.modelId === "string" && value.modelId
      ? { provider: value.provider, modelId: value.modelId }
      : null;
  } catch {
    return null;
  }
}

export function saveLastModel(model: SelectedModel): void {
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  } catch {
    /* Storage may be unavailable. */
  }
}

export function readLastThinkingLevel(): ThinkingLevelOption {
  try {
    const value = localStorage.getItem(THINKING_KEY);
    return value === "auto" || THINKING_LEVELS.some((level) => level === value)
      ? (value as ThinkingLevelOption)
      : "auto";
  } catch {
    return "auto";
  }
}

export function saveLastThinkingLevel(level: ThinkingLevelOption): void {
  try {
    localStorage.setItem(THINKING_KEY, level);
  } catch {
    /* Storage may be unavailable. */
  }
}
