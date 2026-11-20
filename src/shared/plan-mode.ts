export const PLAN_MODE_EXTENSION = "plan-mode";
export const PLAN_MODE_COMMAND = "plan";
export const PLAN_MODE_STATUS = "plan-mode";
export const PLAN_MODE_READ_ONLY = "Read-only exploration";
export type PlanModeAction = "toggle" | "off";

export const PLAN_REVIEW_TITLE = "Plan ready";
export const PLAN_REFINE_TITLE = "Refine the plan";
export const PLAN_REVIEW_CHOICES = {
  execute: "Exit plan mode and execute",
  stay: "Stay in plan mode",
  refine: "Refine the plan",
} as const;

export function readPlanModeEnabled(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): boolean {
  const state = entries.findLast((entry) => entry.type === "custom" && entry.customType === PLAN_MODE_EXTENSION)?.data;
  return !!state && typeof state === "object" && "enabled" in state && state.enabled === true;
}
