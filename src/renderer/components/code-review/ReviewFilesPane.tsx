import type { ReactNode } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import type { ReviewFile, ReviewFinding } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { getFileName } from "@/lib/file-paths";
import { exclusionText } from "./copy";

export function ReviewFilesPane({
  files,
  findings,
  file,
  onlyFindings,
  setOnlyFindings,
  onSelect,
  showStats = true,
  actions,
}: {
  files: ReviewFile[];
  findings: ReviewFinding[];
  file?: ReviewFile;
  onlyFindings: boolean;
  setOnlyFindings: (value: boolean) => void;
  onSelect: (path: string) => void;
  showStats?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const totals = files.reduce(
    (summary, item) =>
      item.included
        ? {
            files: summary.files + 1,
            additions: summary.additions + item.insertions,
            deletions: summary.deletions + item.deletions,
          }
        : summary,
    { files: 0, additions: 0, deletions: 0 },
  );
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.path, (counts.get(finding.path) ?? 0) + 1);
  const included = files.filter((file) => file.included && (!onlyFindings || counts.has(file.path)));
  const excluded = files.filter((file) => !file.included);
  return (
    <aside className="cr-files" aria-label={t("reviewChanges", "Changes")}>
      <div className="cr-files-tabs">
        <button
          type="button"
          className="cr-control"
          aria-pressed={!onlyFindings}
          onClick={() => setOnlyFindings(false)}
        >
          {t("reviewChanges", "Changes")} <small>{totals.files}</small>
        </button>
        <button type="button" className="cr-control" aria-pressed={onlyFindings} onClick={() => setOnlyFindings(true)}>
          {t("reviewFindings", "Findings")} <small>{findings.length}</small>
        </button>
        {actions && <div className="cr-file-actions">{actions}</div>}
      </div>
      <div className="cr-files-scroll">
        {included.length > 0 && showStats && (
          <div className="cr-file-totals">
            <span className="cr-added">+{totals.additions}</span>
            <span className="cr-removed">−{totals.deletions}</span>
          </div>
        )}
        <div className="cr-file-items">
          {included.map((item, index) => {
            const name = getFileName(item.path);
            const directory = item.path.slice(0, -name.length).replace(/[\\/]$/u, "");
            return (
              <button
                type="button"
                className="cr-file-row"
                key={`${item.path}:${index}`}
                aria-current={item === file ? "true" : undefined}
                onClick={() => onSelect(item.path)}
                title={item.path}
              >
                <FileCode2 size={15} />
                <span>
                  <strong>{name || item.path}</strong>
                  {directory && <small>{directory}</small>}
                </span>
                {counts.has(item.path) ? (
                  <b className="cr-file-findings">{counts.get(item.path)}</b>
                ) : showStats ? (
                  <small className="cr-file-stat">
                    <i className="cr-added">+{item.insertions}</i>
                    <i className="cr-removed">−{item.deletions}</i>
                  </small>
                ) : null}
              </button>
            );
          })}
        </div>
        {!onlyFindings && excluded.length > 0 && (
          <details className="cr-excluded">
            <summary>
              <ChevronDown size={14} />
              {t("reviewExcludedFiles", "Show excluded files")} <small>{excluded.length}</small>
            </summary>
            {excluded.map((item, index) => (
              <div className="cr-excluded-row" key={`${item.path}:${index}`} title={exclusionText(item.reason, t)}>
                <span>{item.path}</span>
                <small>{exclusionText(item.reason, t)}</small>
              </div>
            ))}
          </details>
        )}
      </div>
    </aside>
  );
}
