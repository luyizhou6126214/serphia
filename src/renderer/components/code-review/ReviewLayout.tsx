import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Activity, FileDiff } from "lucide-react";
import { useI18n } from "@/i18n";

const TABS = ["review", "diff"] as const;
export type ReviewTab = (typeof TABS)[number];

export function ReviewLayout({
  tab,
  onTabChange,
  sidebar,
  review,
  diff,
  actions,
  back,
}: {
  tab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  sidebar: ReactNode;
  review: ReactNode;
  diff: ReactNode;
  actions: ReactNode;
  back?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const buttons = useRef<Partial<Record<ReviewTab, HTMLButtonElement>>>({});

  function selectByKey(event: KeyboardEvent<HTMLButtonElement>) {
    let next: ReviewTab;
    switch (event.key) {
      case "Home":
        next = "review";
        break;
      case "End":
        next = "diff";
        break;
      case "ArrowLeft":
      case "ArrowRight":
        next = tab === "review" ? "diff" : "review";
        break;
      default:
        return;
    }
    event.preventDefault();
    onTabChange(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="cr-review-layout">
      <section className="cr-review-sidebar" aria-label={t("reviewWorkspace", "Workspace")}>
        {sidebar}
      </section>
      <section className="cr-review-content">
        <header className="cr-review-header">
          {back}
          <div className="cr-review-tabs" role="tablist" aria-label={t("codeReview", "Code review")}>
            {TABS.map((value) => (
              <button
                key={value}
                ref={(element) => {
                  if (element) buttons.current[value] = element;
                  else delete buttons.current[value];
                }}
                type="button"
                className="cr-control cr-review-tab"
                id={`${id}-tab-${value}`}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`${id}-panel-${value}`}
                tabIndex={tab === value ? 0 : -1}
                onClick={() => onTabChange(value)}
                onKeyDown={selectByKey}
              >
                {value === "review" ? <Activity size={15} /> : <FileDiff size={15} />}
                {value === "review" ? t("reviewTab", "Review") : "Diff"}
              </button>
            ))}
          </div>
          <div className="cr-title-actions">{actions}</div>
        </header>
        <section
          className="cr-review-panel"
          id={`${id}-panel-review`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-review`}
          hidden={tab !== "review"}
          tabIndex={0}
        >
          {review}
        </section>
        <section
          className="cr-review-panel cr-diff"
          id={`${id}-panel-diff`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-diff`}
          hidden={tab !== "diff"}
          tabIndex={0}
        >
          {diff}
        </section>
      </section>
    </div>
  );
}
