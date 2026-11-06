/**
 * Work-details presentation choices for the conversation transcript.
 *
 * The four modes are the same four DeepSeek Harness offers, and each maps to
 * the same immutable presentation policy: renderers read single fields of this
 * policy and never compare the mode enum, so adding a mode changes only the
 * table below.
 */
export const WORK_STEP_DISPLAYS = ["compact", "standard", "detailed", "verbose"] as const;
export type WorkStepDisplay = (typeof WORK_STEP_DISPLAYS)[number];

/** Default keeps completed Turns grouped behind their settled header. */
export const DEFAULT_WORK_STEP_DISPLAY: WorkStepDisplay = "standard";

const WORK_STEP_DISPLAY_SET = new Set<string>(WORK_STEP_DISPLAYS);

/** Presentation capabilities that one work-details mode enables. */
export interface WorkStepDisplayPolicy {
  /** Mode this policy was derived from; for diagnostics, never for branching in renderers. */
  readonly mode: WorkStepDisplay;
  /** Whether a normally completed Turn folds its process rows behind the whole-Turn control. */
  readonly foldCompletedTurns: boolean;
  /** Collapsible step-group headers for all Turns, settled Turns only, or no Turns. */
  readonly stepGrouping: "collapsed" | "history" | "none";
  /** Show the running command, path, query, or reasoning detail inside group titles. */
  readonly liveProcessDetail: boolean;
  /** Whether a settled reasoning row previews its first line beside the Think title. */
  readonly settledReasoningPreview: boolean;
}

const POLICIES: Readonly<Record<WorkStepDisplay, WorkStepDisplayPolicy>> = {
  compact: {
    mode: "compact",
    foldCompletedTurns: true,
    stepGrouping: "collapsed",
    liveProcessDetail: false,
    settledReasoningPreview: false,
  },
  standard: {
    mode: "standard",
    foldCompletedTurns: true,
    stepGrouping: "collapsed",
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  detailed: {
    mode: "detailed",
    foldCompletedTurns: true,
    stepGrouping: "history",
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  verbose: {
    mode: "verbose",
    foldCompletedTurns: false,
    stepGrouping: "none",
    liveProcessDetail: false,
    settledReasoningPreview: true,
  },
};

export function isWorkStepDisplay(value: unknown): value is WorkStepDisplay {
  return typeof value === "string" && WORK_STEP_DISPLAY_SET.has(value);
}

/**
 * Resolve the policy constant for one mode. The same mode always yields the
 * same object, so selectors over a policy see stable identities.
 */
export function workStepDisplayPolicy(mode: WorkStepDisplay | undefined): WorkStepDisplayPolicy {
  return POLICIES[mode ?? DEFAULT_WORK_STEP_DISPLAY];
}

/** Whether a Turn with this status exposes a collapsible step-group header. */
export function groupsStepsForTurn(policy: WorkStepDisplayPolicy, settled: boolean): boolean {
  return policy.stepGrouping === "collapsed" || (policy.stepGrouping === "history" && settled);
}
