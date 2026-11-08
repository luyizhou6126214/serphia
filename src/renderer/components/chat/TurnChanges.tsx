import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, FileCode } from "lucide-react";
import { getFileIcon } from "@/components/FileIcons";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { TurnChangedFile } from "@/lib/turn-changes";
import { getFileName } from "@shared/file-paths";

/** File rows shown before the list folds, matching the DSH changed-files card. */
const COLLAPSED_ROWS = 4;

/** One file's diff, with its own path row and optional open action. */
function DiffBlock({ file, onOpenFile }: { file: TurnChangedFile; onOpenFile?: (filePath: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="turn-changes-diff">
      <div className="turn-changes-diff-head">
        <span className="turn-changes-diff-path" title={file.path}>
          {file.display}
        </span>
        {onOpenFile !== undefined && (
          <button type="button" className="turn-changes-open" onClick={() => onOpenFile(file.path)}>
            {t("turnChangesOpenFile", "Open file")}
            <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </div>
      {file.approximate && (
        <p className="turn-changes-note">
          {t("turnChangesApproximate", "The previous content is unavailable; this shows the written result.")}
        </p>
      )}
      <div className="turn-changes-diff-body">
        {file.diff.map((line, index) => {
          if (line.kind === "meta") {
            return line.text === "" ? <div key={index} className="turn-changes-gap" aria-hidden="true" /> : null;
          }
          const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : line.kind === "hunk" ? "" : " ";
          return (
            <div key={index} className={`turn-changes-line is-${line.kind}`}>
              {prefix}
              {line.text}
            </div>
          );
        })}
      </div>
      {file.truncated && <p className="turn-changes-note">{t("turnChangesTruncated", "Diff truncated")}</p>}
    </div>
  );
}

/**
 * The files one assistant turn changed, following DeepSeek Harness's closing
 * card: a filled header with the turn's add/delete counts, file rows with their
 * own counts, a fold for long lists, and an inline diff per file.
 */
export function TurnChanges({
  files,
  onOpenFile,
}: {
  files: readonly TurnChangedFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (files.length === 0) return null;
  const single = files.length === 1 ? files[0] : undefined;
  const added = files.reduce((total, file) => total + file.added, 0);
  const deleted = files.reduce((total, file) => total + file.deleted, 0);
  const foldable = files.length > COLLAPSED_ROWS;
  const rows = foldable && !showAll ? files.slice(0, COLLAPSED_ROWS) : files;
  const toggle = (path: string) => {
    setExpanded((current) => (current === path ? null : path));
  };
  const stat = (
    <span className="turn-changes-stat">
      <span className="turn-changes-added">+{formatNumber(added, language)}</span>
      <span className="turn-changes-deleted">−{formatNumber(deleted, language)}</span>
    </span>
  );

  return (
    <div className="turn-changes" data-turn-changes>
      {single === undefined ? (
        <div className="turn-changes-header">
          <span className="turn-changes-tile" aria-hidden="true">
            <FileCode size={20} strokeWidth={1.5} />
          </span>
          <span className="turn-changes-titles">
            <span className="turn-changes-title">
              {t("turnChangesTitle", "{count} files changed").replace("{count}", formatNumber(files.length, language))}
            </span>
            {stat}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="turn-changes-header turn-changes-header-button"
          aria-expanded={expanded === single.path}
          onClick={() => toggle(single.path)}
        >
          <span className="turn-changes-tile" aria-hidden="true">
            {getFileIcon(getFileName(single.display), 20)}
          </span>
          <span className="turn-changes-titles">
            <span className="turn-changes-title">{getFileName(single.display)}</span>
            {stat}
          </span>
          <span className="turn-changes-chevron" aria-hidden="true">
            {expanded === single.path ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
      )}
      {single !== undefined && expanded === single.path && <DiffBlock file={single} onOpenFile={onOpenFile} />}
      {single === undefined && (
        <ul className="turn-changes-list">
          {rows.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="turn-changes-row"
                aria-expanded={expanded === file.path}
                onClick={() => toggle(file.path)}
              >
                <span className="turn-changes-path" title={file.display}>
                  {file.display}
                </span>
                <span className="turn-changes-row-counts">
                  <span className="turn-changes-added">+{formatNumber(file.added, language)}</span>
                  <span className="turn-changes-deleted">−{formatNumber(file.deleted, language)}</span>
                </span>
              </button>
              {expanded === file.path && <DiffBlock file={file} onOpenFile={onOpenFile} />}
            </li>
          ))}
        </ul>
      )}
      {foldable && (
        <button
          type="button"
          className="turn-changes-toggle"
          aria-expanded={showAll}
          onClick={() => {
            setShowAll((value) => !value);
          }}
        >
          <span>
            {showAll
              ? t("turnChangesCollapseList", "Collapse file list")
              : t("turnChangesShowAll", "Show all {count} files").replace("{count}", String(files.length))}
          </span>
          {showAll ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
