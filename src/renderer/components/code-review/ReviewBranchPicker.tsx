import { ArrowRight } from "lucide-react";
import type { ReviewBranches } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { ReviewSelect } from "./ReviewSelect";

export function ReviewBranchPicker({
  branches,
  from,
  to,
  disabled,
  onChange,
}: {
  branches: ReviewBranches | null;
  from: string;
  to: string;
  disabled: boolean;
  onChange: (from: string, to: string) => void;
}) {
  const { t } = useI18n();
  const refs = branches?.refs ?? [];
  const groups = [
    { kind: "local", label: t("reviewLocalBranches", "Local branches") },
    { kind: "remote", label: t("reviewRemoteBranches", "Remote-tracking branches") },
    { kind: "pull", label: t("reviewPullRefs", "Fetched pull request refs") },
  ] as const;

  function picker(value: string, other: string, label: string, change: (ref: string) => void) {
    return (
      <ReviewSelect
        label={label}
        caption
        title={value || undefined}
        value={value}
        disabled={disabled || !branches}
        onChange={change}
      >
        <option value="" disabled>
          {label}
        </option>
        {value && !refs.some(({ ref }) => ref === value) && value !== "HEAD" && <option value={value}>{value}</option>}
        <option value="HEAD" disabled={other === "HEAD"}>
          {t("reviewCheckedOutRef", "Checked-out commit (HEAD)")}
        </option>
        {groups.map(({ kind, label }) => {
          const items = refs.filter((entry) => entry.kind === kind);
          return (
            items.length > 0 && (
              <optgroup key={kind} label={label}>
                {items.map(({ ref, label }) => (
                  <option key={ref} value={ref} disabled={other === ref}>
                    {label}
                  </option>
                ))}
              </optgroup>
            )
          );
        })}
      </ReviewSelect>
    );
  }

  return (
    <div className="cr-scope-fields cr-branch-fields">
      {picker(from, to, t("reviewBaseRef", "Base branch"), (value) => onChange(value, to))}
      <ArrowRight size={13} aria-hidden="true" />
      {picker(to, from, t("reviewTargetRef", "PR branch"), (value) => onChange(from, value))}
    </div>
  );
}
