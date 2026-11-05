/** Work-details presentation choices for the conversation transcript. */
export const WORK_STEP_DISPLAYS = ["compact", "standard", "detailed", "verbose"] as const;
export type WorkStepDisplay = (typeof WORK_STEP_DISPLAYS)[number];

/** Default matches the existing grouped, previewed process presentation. */
export const DEFAULT_WORK_STEP_DISPLAY: WorkStepDisplay = "standard";

const WORK_STEP_DISPLAY_SET = new Set<string>(WORK_STEP_DISPLAYS);

export interface WorkStepDisplayPolicy {
  /** Fold completed process rows behind the process-details header. */
  groupProcess: boolean;
  /** Open completed process groups before the user clicks them. */
  defaultProcessExpanded: boolean;
  /** Show a one-line command/path/thinking preview while rows are folded. */
  showStepPreview: boolean;
  /** Open tool-call rows before the user clicks them. */
  defaultToolExpanded: boolean;
  /** Open thinking rows before the user clicks them. */
  defaultThinkingExpanded: boolean;
}

const POLICIES: Readonly<Record<WorkStepDisplay, WorkStepDisplayPolicy>> = {
  compact: {
    groupProcess: true,
    defaultProcessExpanded: false,
    showStepPreview: false,
    defaultToolExpanded: false,
    defaultThinkingExpanded: false,
  },
  standard: {
    groupProcess: true,
    defaultProcessExpanded: false,
    showStepPreview: true,
    defaultToolExpanded: false,
    defaultThinkingExpanded: false,
  },
  detailed: {
    groupProcess: true,
    defaultProcessExpanded: true,
    showStepPreview: true,
    defaultToolExpanded: false,
    defaultThinkingExpanded: false,
  },
  verbose: {
    groupProcess: false,
    defaultProcessExpanded: true,
    showStepPreview: true,
    defaultToolExpanded: true,
    defaultThinkingExpanded: true,
  },
};

export function isWorkStepDisplay(value: unknown): value is WorkStepDisplay {
  return typeof value === "string" && WORK_STEP_DISPLAY_SET.has(value);
}

export function workStepDisplayPolicy(mode: WorkStepDisplay | undefined): WorkStepDisplayPolicy {
  return POLICIES[mode ?? DEFAULT_WORK_STEP_DISPLAY];
}
