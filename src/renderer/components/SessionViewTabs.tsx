import { useI18n } from "@/i18n";
import "./SessionViewTabs.css";

export type SessionView = "chat" | "trajectory" | "context";

interface Props {
  value: SessionView;
  onChange: (view: SessionView) => void;
}

/** Chat-area view selector, matching the conversation view ring used by DSH. */
export function SessionViewTabs({ value, onChange }: Props) {
  const { t } = useI18n();
  const tabs: Array<{ id: SessionView; label: string }> = [
    { id: "chat", label: t("sessionViewChat", "Chat") },
    { id: "trajectory", label: t("sessionViewTrajectory", "Trajectory") },
    { id: "context", label: t("sessionViewContext", "Context") },
  ];
  return (
    <div className="session-view-tabs" role="tablist" aria-label={t("sessionViews", "Session views")}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={
            tab.id === "chat"
              ? "session-view-chat"
              : tab.id === "trajectory"
                ? "session-view-trajectory"
                : "session-view-context"
          }
          className="session-view-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
