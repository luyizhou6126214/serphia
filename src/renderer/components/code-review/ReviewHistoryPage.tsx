import { useEffect, useState } from "react";
import { ArrowLeft, FileCode2, FolderOpen, GitBranch, History, ListFilter } from "lucide-react";
import type { ReviewHistoryDetail, ReviewHistoryRef } from "@contract/code-review";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { getFileName } from "@/lib/file-paths";
import { reviewIssueText, reviewScopeText, reviewStateText } from "./copy";
import { ReviewActivityPane } from "./ReviewActivityPane";
import { ReviewDiffPane } from "./ReviewDiffPane";
import { ReviewFilesPane } from "./ReviewFilesPane";
import { ReviewLayout, type ReviewTab } from "./ReviewLayout";

export function ReviewHistoryPage({
  historyRef,
  visible,
  workStepDisplay,
  onBack,
  onHistory,
}: {
  historyRef: ReviewHistoryRef;
  visible: boolean;
  workStepDisplay?: WorkStepDisplay;
  onBack: () => void;
  onHistory: () => void;
}) {
  const { t, language } = useI18n();
  const [detail, setDetail] = useState<ReviewHistoryDetail | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [tab, setTab] = useState<ReviewTab>("review");

  useEffect(() => {
    let current = true;
    void call("codeReview.history.open", historyRef)
      .then((reply) => {
        if (!current) return;
        if (reply.ok) setDetail(reply.value);
        else setError(true);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [historyRef]);

  const run = detail?.run;
  const files = run?.files.filter(
    (file) => file.included && (!onlyFindings || run.findings.some((finding) => finding.path === file.path)),
  );
  const file = files?.find((item) => item.path === selected) ?? files?.[0];
  const projectRoot = run?.projectRoot ?? run?.root;
  const worktree = run?.root;
  const worktreeName =
    run?.projectRoot === worktree
      ? t("reviewMainWorktree", "Main worktree")
      : worktree && (getFileName(worktree) || worktree);
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const scope = run ? reviewScopeText(run.scope, t) : "";
  const message = (
    <p className="cr-inline-message" role={error ? "alert" : "status"}>
      {error
        ? t("reviewHistoryLoadError", "Could not load review history.")
        : t("reviewHistoryLoading", "Loading review history…")}
    </p>
  );

  return (
    <main className="ocr-page cr-archive" aria-label={t("reviewHistoryDetail", "Saved review")} hidden={!visible}>
      <ReviewLayout
        tab={tab}
        onTabChange={setTab}
        back={
          <button
            type="button"
            className="cr-control cr-icon-button cr-archive-back"
            onClick={onBack}
            aria-label={t("reviewHistoryBack", "Back to code review")}
            title={t("reviewHistoryBack", "Back to code review")}
          >
            <ArrowLeft size={17} />
          </button>
        }
        actions={
          <>
            {run && (
              <div className="cr-history-run" aria-label={t("reviewHistoryRun", "Review run")}>
                <span className="cr-run-state" data-state={run.state}>
                  {reviewStateText(run.state, t)}
                </span>
                <span className="cr-status-caption" title={run.model}>
                  {run.model}
                </span>
                {run.startedAt > 0 && (
                  <time dateTime={new Date(run.startedAt).toISOString()}>{dates.format(run.startedAt)}</time>
                )}
              </div>
            )}
            <button type="button" className="cr-control" onClick={onHistory}>
              <History size={15} />
              {t("reviewHistory", "History")}
            </button>
          </>
        }
        sidebar={
          run &&
          detail &&
          projectRoot &&
          worktree && (
            <>
              <dl className="cr-setup cr-history-context">
                <div>
                  <dt>{t("reviewWorkspace", "Workspace")}</dt>
                  <dd title={projectRoot}>
                    <FolderOpen size={15} aria-hidden="true" />
                    <span>{getFileName(projectRoot) || projectRoot}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t("reviewWorktree", "Worktree")}</dt>
                  <dd title={worktree}>
                    <GitBranch size={15} aria-hidden="true" />
                    <span>
                      {worktreeName}
                      {run.worktreeBranch && run.worktreeBranch !== worktreeName && ` · ${run.worktreeBranch}`}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{t("reviewScope", "Review scope")}</dt>
                  <dd title={scope}>
                    <ListFilter size={15} aria-hidden="true" />
                    <span>{scope}</span>
                  </dd>
                </div>
              </dl>
              <ReviewFilesPane
                files={run.files}
                findings={run.findings}
                file={file}
                onlyFindings={onlyFindings}
                setOnlyFindings={(value) => {
                  setOnlyFindings(value);
                  if (value) setTab("diff");
                }}
                showStats={!detail.legacy && run.scope.kind !== "scan"}
                onSelect={(path) => {
                  setSelected(path);
                  setTab("diff");
                }}
              />
            </>
          )
        }
        review={
          run ? (
            <div className="cr-transcript">
              {run.issue && (
                <div className="cr-live-notice" role="alert">
                  {reviewIssueText(run.issue, t)}
                </div>
              )}
              <ReviewActivityPane
                run={run}
                visible={visible}
                selected={tab === "review"}
                workStepDisplay={workStepDisplay}
                historyRef={historyRef}
              />
            </div>
          ) : (
            message
          )
        }
        diff={
          run && detail ? (
            <>
              {run.stale && (
                <p className="cr-live-notice cr-diff-notice">
                  {t(
                    "reviewHistoryChangedDuringRun",
                    "The worktree changed during this review. Finding locations may differ from the saved snapshot.",
                  )}
                </p>
              )}
              {detail.snapshot !== "saved" && (
                <p className="cr-live-notice cr-diff-notice">
                  {detail.snapshot === "partial"
                    ? t("reviewHistoryPartialDiff", "Only part of the code snapshot was saved.")
                    : t(
                        "reviewHistoryNoSnapshot",
                        "The code snapshot is unavailable. You can still view the recorded findings and activity.",
                      )}
                </p>
              )}
              {file ? (
                <ReviewDiffPane
                  key={file.path}
                  request={{ cwd: run.root, scope: run.diffScope ?? run.scope }}
                  file={file.path}
                  historyRef={historyRef}
                  findings={run.findings.filter((finding) => finding.path === file.path)}
                />
              ) : (
                <div className="cr-empty">
                  <span>
                    <FileCode2 size={22} />
                  </span>
                  <p>
                    {onlyFindings
                      ? t("reviewNoFindings", "No findings in the reviewed files.")
                      : t("reviewEmptyScope", "No reviewable changes")}
                  </p>
                </div>
              )}
            </>
          ) : (
            message
          )
        }
      />
    </main>
  );
}
