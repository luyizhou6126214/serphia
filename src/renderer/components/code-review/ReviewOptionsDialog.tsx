import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleHelp, FileText, ListChecks, SlidersHorizontal, X } from "lucide-react";
import { REVIEW_OPTION_DEFAULTS, type ReviewOptions, type ReviewScope } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { ReviewSelect } from "./ReviewSelect";

function OptionField({
  label,
  tip,
  children,
}: {
  label: string;
  tip: string;
  children: (id: string, tipId: string) => ReactNode;
}) {
  const id = useId();
  const tipId = `${id}-tip`;
  return (
    <div className="cr-option-field">
      <label htmlFor={id}>{label}</label>
      {children(id, tipId)}
      <p id={tipId} className="cr-field-tip">
        {tip}
      </p>
    </div>
  );
}

export function ReviewOptionsDialog({
  value,
  kind,
  defaultEffort,
  onSave,
  onClose,
}: {
  value: ReviewOptions;
  kind: ReviewScope["kind"];
  defaultEffort: "low" | "medium" | "high";
  onSave: (value: ReviewOptions) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const defaults = { ...REVIEW_OPTION_DEFAULTS, effort: defaultEffort };
  const [draft, setDraft] = useState<ReviewOptions>(() => ({ ...defaults, ...value }));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const scan = kind === "scan";
  const auto = t("thinkingAuto", "Auto");
  const set = <K extends keyof ReviewOptions>(key: K, entry: ReviewOptions[K]) =>
    setDraft((prior) => ({ ...prior, [key]: entry }));

  const files = [
    ...(!scan
      ? [
          {
            key: "backgroundFile" as const,
            name: t("reviewBackgroundFile", "Background file"),
            placeholder: "docs/requirements.md",
            tip: t(
              "reviewTipBackgroundFile",
              "A Markdown path relative to the worktree. OCR uses it as review context.",
            ),
          },
        ]
      : []),
    {
      key: "exclude" as const,
      name: t("reviewExcludes", "Exclude patterns"),
      placeholder: "dist/**, *.generated.ts",
      tip: t("reviewTipExclude", "Comma-separated Git ignore patterns. Matching files are skipped."),
    },
    {
      key: "rule" as const,
      name: t("reviewRuleFile", "Rule file"),
      placeholder: ".opencodereview/rule.json",
      tip: t("reviewTipRule", "A JSON path relative to the worktree. It overrides the default rule file."),
    },
    {
      key: "tools" as const,
      name: t("reviewToolsFile", "Tool definitions file"),
      placeholder: "config/review-tools.json",
      tip: t(
        "reviewTipToolsFile",
        "A JSON path relative to the worktree. Its tool definitions replace the built-in definitions.",
      ),
    },
  ];

  const numbers = [
    [
      "concurrency",
      t("reviewConcurrency", "Concurrency"),
      1,
      32,
      String(REVIEW_OPTION_DEFAULTS.concurrency),
      t("reviewTipConcurrency", "Maximum parallel review tasks. Higher values can increase model request rate."),
    ],
    [
      "timeout",
      t("reviewTimeLimit", "Task timeout (minutes)"),
      0,
      60,
      String(REVIEW_OPTION_DEFAULTS.timeout),
      t(
        "reviewTipTimeout",
        "Time allowed for each task, including retries. Set to 0 to remove the per-task time limit.",
      ),
    ],
    [
      "maxTokens",
      t("reviewPromptBudget", "Prompt tokens per task"),
      0,
      2_000_000,
      String(REVIEW_OPTION_DEFAULTS.maxTokens),
      t("reviewTipPromptBudget", "Limits the input context for each task. Set to 0 to use OCR’s configured default."),
    ],
    [
      "maxTokensBudget",
      t("reviewTokenBudget", "Total token budget"),
      0,
      2_000_000,
      String(REVIEW_OPTION_DEFAULTS.maxTokensBudget),
      t(
        "reviewTipTokenBudget",
        "Caps input and output tokens across the run. OCR can return partial results at the cap. Set to 0 for unlimited.",
      ),
    ],
    [
      "maxTools",
      t("reviewToolRounds", "Tool rounds"),
      0,
      500,
      String(REVIEW_OPTION_DEFAULTS.maxTools),
      scan
        ? t("reviewTipScanToolRounds", "Raises the tool call limit per task when set above the scan template default.")
        : t(
            "reviewTipToolRounds",
            "Limits tool call rounds per task. Set to 0 for the default. Values below 50 are raised to 50.",
          ),
    ],
    [
      "maxGitProcs",
      t("reviewGitWorkers", "Git processes"),
      1,
      64,
      auto,
      t("reviewTipGitWorkers", "Maximum Git subprocesses running at once. Lower values reduce local load."),
    ],
  ] as const;
  const toggles = scan
    ? ([
        [
          "noPlan",
          t("reviewSkipPlan", "Skip planning"),
          t("reviewTipSkipPlan", "Start inspecting files without first asking the model to plan what to look for."),
        ],
        [
          "noDedup",
          t("reviewSkipDedup", "Skip deduplication"),
          t("reviewTipSkipDedup", "Keep findings from each scan batch even when they repeat an earlier finding."),
        ],
        [
          "noSummary",
          t("reviewSkipSummary", "Skip the project summary"),
          t("reviewTipSkipSummary", "Keep individual findings and skip the model-generated overview after the scan."),
        ],
      ] as const)
    : ([
        [
          "noFilter",
          t("reviewSkipFilter", "Keep all findings"),
          t("reviewTipSkipFilter", "Skip the model’s final filtering pass and keep lower-confidence findings."),
        ],
      ] as const);
  const modeLabel = scan ? t("reviewBatch", "Scan grouping") : t("reviewEffort", "OCR review passes");

  function submit(event: FormEvent) {
    event.preventDefault();
    const overrides = Object.entries(draft).filter(([key, entry]) => {
      const defaultValue = defaults[key as keyof typeof defaults];
      return entry !== undefined && entry !== defaultValue;
    });
    onSave(Object.fromEntries(overrides));
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="cr-dialog cr-options-dialog"
      aria-labelledby="review-options-title"
      onCancel={onClose}
    >
      <header>
        <div className="cr-dialog-title">
          <SlidersHorizontal size={17} />
          <h2 id="review-options-title">{t("reviewOptions", "Review options")}</h2>
        </div>
        <button type="button" className="cr-control" aria-label={t("reviewClose", "Close")} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <form onSubmit={submit} className="cr-options-form">
        <div className="cr-options-content">
          <fieldset className="cr-option-section">
            <legend>
              <FileText size={14} />
              {t("reviewOptionContext", "Review context")}
            </legend>
            <OptionField
              label={t("reviewInstructions", "Review instructions")}
              tip={t(
                "reviewTipInstructions",
                "Give OCR the intent of the change, areas to focus on, or known exceptions.",
              )}
            >
              {(id, tip) => (
                <textarea
                  id={id}
                  aria-describedby={tip}
                  rows={2}
                  value={draft.background ?? ""}
                  maxLength={8000}
                  onChange={(event) => set("background", event.target.value || undefined)}
                />
              )}
            </OptionField>
            <div className="cr-form-grid">
              {files.map(({ key, name, tip, placeholder }) => (
                <OptionField key={key} label={name} tip={tip}>
                  {(id, tipId) => (
                    <input
                      id={id}
                      aria-describedby={tipId}
                      placeholder={placeholder}
                      value={draft[key] ?? ""}
                      onChange={(event) => set(key, event.target.value || undefined)}
                    />
                  )}
                </OptionField>
              ))}
            </div>
          </fieldset>
          <fieldset className="cr-option-section">
            <legend>
              <SlidersHorizontal size={14} />
              {t("reviewOptionExecution", "Execution and budget")}
            </legend>
            <div className="cr-form-grid">
              <OptionField
                label={modeLabel}
                tip={
                  scan
                    ? t("reviewTipBatch", "Group files by language or folder so OCR can review related files together.")
                    : t(
                        "reviewTipEffort",
                        "Low, medium, and high run one, two, or three review passes. More passes can take longer and use more tokens.",
                      )
                }
              >
                {(id, tip) =>
                  scan ? (
                    <ReviewSelect
                      id={id}
                      label={modeLabel}
                      aria-describedby={tip}
                      value={draft.batch ?? ""}
                      onChange={(value) => set("batch", (value || undefined) as ReviewOptions["batch"])}
                    >
                      <option value="">{auto}</option>
                      <option value="none">{t("reviewNoGrouping", "None")}</option>
                      <option value="by-language">{t("reviewGroupByLanguage", "By language")}</option>
                      <option value="by-directory">{t("reviewGroupByDirectory", "By directory")}</option>
                    </ReviewSelect>
                  ) : (
                    <ReviewSelect
                      id={id}
                      label={modeLabel}
                      aria-describedby={tip}
                      value={draft.effort ?? defaultEffort}
                      onChange={(value) => set("effort", value as ReviewOptions["effort"])}
                    >
                      <option value="auto">{auto}</option>
                      <option value="low">{t("thinkingLow", "Low")}</option>
                      <option value="medium">{t("thinkingMedium", "Medium")}</option>
                      <option value="high">{t("thinkingHigh", "High")}</option>
                    </ReviewSelect>
                  )
                }
              </OptionField>
              {numbers.map(([key, name, min, max, placeholder, tip]) => (
                <OptionField key={key} label={name} tip={tip}>
                  {(id, tipId) => (
                    <input
                      id={id}
                      aria-describedby={tipId}
                      type="number"
                      min={min}
                      max={max}
                      placeholder={placeholder}
                      value={draft[key] ?? ""}
                      onChange={(event) => set(key, event.target.value ? Number(event.target.value) : undefined)}
                    />
                  )}
                </OptionField>
              ))}
              {kind !== "workspace" && (
                <OptionField
                  label={t("reviewResumeId", "Session ID to resume")}
                  tip={t(
                    "reviewTipResume",
                    "Reuse finished work from a compatible session. You can choose a session in History.",
                  )}
                >
                  {(id, tip) => (
                    <input
                      id={id}
                      aria-describedby={tip}
                      value={draft.resume ?? ""}
                      onChange={(event) => set("resume", event.target.value || undefined)}
                    />
                  )}
                </OptionField>
              )}
            </div>
          </fieldset>
          <fieldset className="cr-option-section">
            <legend>
              <ListChecks size={14} />
              {t("reviewOptionFindings", "Result processing")}
            </legend>
            {toggles.map(([key, name, tip]) => (
              <label key={key} className="cr-option-toggle">
                <input
                  type="checkbox"
                  checked={draft[key] ?? false}
                  onChange={(event) => set(key, event.target.checked)}
                />
                <span>
                  <strong>{name}</strong>
                  <small>{tip}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <footer>
          <span className="cr-options-footer-note">
            <CircleHelp size={13} />
            {t("reviewOptionDefaults", "Leave a field blank to use its default.")}
          </span>
          <button type="button" className="cr-control" onClick={() => setDraft(defaults)}>
            {t("reviewResetOptions", "Reset")}
          </button>
          <button type="submit" className="cr-control cr-primary">
            {t("reviewApplyOptions", "Apply options")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
