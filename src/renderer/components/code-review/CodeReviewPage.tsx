import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  Files,
  Ellipsis,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  History,
  ListFilter,
  Play,
  Plug,
  RefreshCw,
  Settings2,
  Square,
} from "lucide-react";
import type {
  ReviewFinding,
  ReviewHistoryRef,
  ReviewEngineStatus,
  ReviewOptions,
  ReviewRequest,
  ReviewScope,
} from "@contract/code-review";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { getFileName } from "@/lib/file-paths";
import { useCodeReview } from "@/hooks/useCodeReview";
import { reviewIssueText, reviewScopeText, reviewStateText } from "./copy";
import { ReviewLayout, type ReviewTab } from "./ReviewLayout";
import { ReviewFilesPane } from "./ReviewFilesPane";
import { ReviewHistoryPage } from "./ReviewHistoryPage";
import { ReviewDiffPane } from "./ReviewDiffPane";
import { ReviewModelPicker, useReviewModel } from "./ReviewModelPicker";
import { ReviewOptionsDialog } from "./ReviewOptionsDialog";
import { ReviewToolsDialog } from "./ReviewToolsDialog";
import { ReviewConfigDialog } from "./ReviewConfigDialog";
import { ReviewMcpDialog } from "./ReviewMcpDialog";
import { ReviewExportDialog } from "./ReviewExportDialog";
import { ReviewSelect } from "./ReviewSelect";
import { ReviewBranchPicker } from "./ReviewBranchPicker";
import { ReviewActivityPane } from "./ReviewActivityPane";
import { useReviewWorkspace } from "./useReviewWorkspace";
import { useReviewMotion } from "./useReviewMotion";
import "./CodeReviewPage.css";

type Location = { path: string; root: string; line: number | null; stale: boolean };

export function CodeReviewPage({
  visible = true,
  cwd,
  project,
  projects,
  home,
  onOpenFile,
  onOpenModels,
  modelsRevision,
  workStepDisplay,
}: {
  visible?: boolean;
  cwd: string | null;
  project: string | null;
  projects: string[];
  home: string;
  onOpenFile: (location: Location) => void;
  onOpenModels: () => void;
  modelsRevision?: number;
  workStepDisplay?: WorkStepDisplay;
}) {
  const { t } = useI18n();
  const page = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<ReviewTab>("review");
  const [kind, setKind] = useState<ReviewScope["kind"]>("workspace");
  const [range, setRange] = useState<{ cwd: string | null; from: string; to: string } | null>(null);
  const [commit, setCommit] = useState("HEAD");
  const [scanPaths, setScanPaths] = useState("");
  const [options, setOptions] = useState<ReviewOptions>({});
  const [dialog, setDialog] = useState<"options" | "history" | "rules" | "engine" | "config" | "mcp" | "export" | null>(
    null,
  );
  const [engineStatus, setEngineStatus] = useState<ReviewEngineStatus>({ effort: "low" });
  const [historyRef, setHistoryRef] = useState<ReviewHistoryRef | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [stale, setStale] = useState(false);
  const workspace = useReviewWorkspace({ activeCwd: cwd, activeProject: project, projects, home });
  const selectedCwd = workspace.cwd;
  const effectiveKind = workspace.info?.isGit === false ? "scan" : kind;
  const defaults = workspace.branches;
  const selectedRange = range && range.cwd === selectedCwd ? range : null;
  const from = selectedRange?.from ?? defaults?.base ?? "";
  const to = selectedRange?.to ?? (defaults?.current && defaults.current !== from ? defaults.current : "");
  const request = useMemo<ReviewRequest | null>(() => {
    if (!selectedCwd) return null;
    let scope: ReviewScope;
    switch (effectiveKind) {
      case "workspace":
        scope = { kind: effectiveKind };
        break;
      case "branch":
        if (!from || !to || from === to) return null;
        scope = { kind: effectiveKind, from, to };
        break;
      case "commit":
        if (!commit.trim()) return null;
        scope = { kind: effectiveKind, ref: commit.trim() };
        break;
      case "scan":
        scope = { kind: effectiveKind, ...(scanPaths.trim() ? { paths: scanPaths.trim() } : {}) };
        break;
    }
    return {
      cwd: selectedCwd,
      scope,
      options: effectiveKind === "workspace" ? { ...options, resume: undefined } : options,
    };
  }, [selectedCwd, effectiveKind, from, to, commit, scanPaths, options]);
  const models = useReviewModel(selectedCwd, modelsRevision);
  useEffect(() => {
    let current = true;
    void call("codeReview.config.status")
      .then((result) => {
        if (current && result.ok) setEngineStatus(result.value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const { run, preview, busy, active, issue, setIssue, previewChanges, start, cancel } = useCodeReview(request);

  const runMatches = run && request && JSON.stringify(run.request) === JSON.stringify(request);
  const currentRun = runMatches || active ? run : null;
  const displayRequest = currentRun && !preview ? currentRun.request : request;
  const files = preview?.files ?? currentRun?.files ?? [];
  const findings = preview ? [] : (currentRun?.findings ?? []);
  const diffScope = preview?.diffScope ?? (!preview ? currentRun?.diffScope : undefined);
  const state = active || runMatches ? run?.state : undefined;
  const liveVisible = visible && !historyRef;
  const starting = busy === "start";
  const docked = starting || Boolean(currentRun);
  const captureLaunchPosition = useReviewMotion(
    page,
    liveVisible && active,
    liveVisible && state === "complete",
    liveVisible && docked,
    liveVisible && tab === "review" && !docked,
  );
  const fileCount = files.filter((item) => item.included).length;
  const hasChanges = fileCount > 0;
  const included = files.filter(
    (item) => item.included && (!onlyFindings || findings.some((finding) => finding.path === item.path)),
  );
  const file = included.find((item) => item.path === selectedFile) ?? included[0];
  const shownIssue = workspace.issue ?? issue ?? (runMatches && !preview ? run.issue : undefined);
  const isBusy = Boolean(busy) || active || workspace.directoryBusy;
  const exportable =
    runMatches &&
    run.finishedAt &&
    (run.sessionId || run.state === "complete" || run.state === "partial" || run.state === "skipped");

  useEffect(() => {
    if (!visible || historyRef || !request || runMatches || preview) return;
    const timer = setTimeout(() => void previewChanges(), 350);
    return () => clearTimeout(timer);
  }, [visible, historyRef, request, runMatches, preview, previewChanges]);

  useEffect(() => {
    if (!visible) setDialog(null);
  }, [visible]);

  async function openFinding(finding: ReviewFinding) {
    if (!run) return;
    try {
      const result = await call("codeReview.locateFinding", { id: run.id, findingId: finding.id });
      if (result.ok) {
        if (result.value.stale) setStale(true);
        onOpenFile(result.value);
      } else setIssue(result.issue);
    } catch {
      setIssue("notRepository");
    }
  }

  function selectScope(value: ReviewScope["kind"]) {
    setKind(value);
    clearSelection();
  }

  function clearSelection() {
    setOnlyFindings(false);
    setSelectedFile(null);
    setStale(false);
    setIssue(null);
  }

  const runStatus = workspace.loading
    ? t("reviewLoadingProject", "Loading project…")
    : busy === "preview"
      ? t("reviewPreviewing", "Checking changes…")
      : starting
        ? t("reviewStatusChecking", "Preparing the review…")
        : preview
          ? hasChanges
            ? models.model
              ? t("reviewReady", "Ready for review")
              : t("reviewSelectModel", "Choose a model")
            : t("reviewEmptyScope", "No reviewable changes")
          : reviewStateText(state, t);
  const launchTitle = request
    ? reviewScopeText(request.scope, t)
    : selectedCwd
      ? t("reviewScope", "Review scope")
      : t("reviewWorkspace", "Workspace");

  const notices = (
    <>
      {shownIssue && (
        <div className="cr-live-notice" role="alert">
          {reviewIssueText(shownIssue, t)}
        </div>
      )}
      {runMatches && !preview && run.mcpWarning && (
        <div className="cr-live-notice" role="status">
          {t("reviewMcpUnavailable", "Some OCR MCP tools were unavailable during this review. Check OCR MCP settings.")}
        </div>
      )}
      {runMatches && !preview && (run.stale || stale) && (
        <div className="cr-live-notice" role="status">
          {t("reviewStale", "The worktree changed. Review again to refresh these locations.")}
        </div>
      )}
    </>
  );

  return (
    <>
      <main className="ocr-page cr-live" aria-label={t("codeReview", "Code review")} ref={page} hidden={!liveVisible}>
        <ReviewLayout
          tab={tab}
          onTabChange={setTab}
          sidebar={
            <>
              <div className="cr-setup">
                <div className="cr-context">
                  <div className="cr-project-field">
                    <ReviewSelect
                      label={t("reviewWorkspace", "Workspace")}
                      caption
                      icon={<FolderOpen size={15} />}
                      title={workspace.project}
                      value={workspace.project}
                      disabled={isBusy}
                      onChange={(value) => {
                        workspace.selectProject(value);
                        setRange(null);
                        setOptions({});
                        clearSelection();
                      }}
                    >
                      <option value="" disabled>
                        {t("reviewChooseProject", "Choose a project")}
                      </option>
                      {workspace.projects.map((value) => (
                        <option title={value} key={value} value={value}>
                          {getFileName(value) || value}
                        </option>
                      ))}
                    </ReviewSelect>
                    <button
                      type="button"
                      className="cr-control cr-open-folder"
                      disabled={isBusy}
                      title={t("reviewOpenDirectory", "Open folder…")}
                      aria-label={t("reviewOpenDirectory", "Open folder…")}
                      onClick={() => {
                        void workspace.openDirectory().then((opened) => {
                          if (opened) {
                            setRange(null);
                            setOptions({});
                            clearSelection();
                          }
                        });
                      }}
                    >
                      <FolderPlus size={15} />
                    </button>
                  </div>
                  {workspace.info?.isGit && workspace.worktrees.length > 0 && (
                    <ReviewSelect
                      label={t("reviewWorktree", "Worktree")}
                      caption
                      icon={<GitBranch size={15} />}
                      value={selectedCwd ?? ""}
                      title={selectedCwd ?? undefined}
                      disabled={isBusy}
                      onChange={(value) => {
                        workspace.selectWorktree(value);
                        setRange(null);
                        setOptions((current) => ({ ...current, resume: undefined }));
                        clearSelection();
                      }}
                    >
                      {workspace.worktrees.map(({ path, branch, isMain }) => (
                        <option key={path} value={path} title={path}>
                          {isMain ? t("reviewMainWorktree", "Main worktree") : getFileName(path)}
                          {branch && (isMain || getFileName(path) !== branch) ? ` · ${branch}` : ""}
                        </option>
                      ))}
                    </ReviewSelect>
                  )}
                </div>
                <div className="cr-scope">
                  <ReviewSelect
                    label={t("reviewScope", "Review scope")}
                    caption
                    value={effectiveKind}
                    disabled={isBusy || !workspace.info}
                    onChange={(value) => selectScope(value as ReviewScope["kind"])}
                  >
                    {workspace.info?.isGit !== false && (
                      <>
                        <option value="workspace">{t("reviewWorkingChanges", "Uncommitted changes")}</option>
                        <option value="branch">{t("reviewBranch", "Compare PR branches")}</option>
                        <option value="commit">{t("reviewCommit", "Review a commit")}</option>
                      </>
                    )}
                    <option value="scan">{t("reviewScan", "Scan files")}</option>
                  </ReviewSelect>
                  {effectiveKind === "branch" && (
                    <ReviewBranchPicker
                      branches={defaults}
                      from={from}
                      to={to}
                      disabled={isBusy || !selectedCwd}
                      onChange={(from, to) => {
                        setRange({ cwd: selectedCwd, from, to });
                        clearSelection();
                      }}
                    />
                  )}
                  {effectiveKind === "commit" && (
                    <label className="cr-field">
                      <span className="cr-field-caption">{t("reviewCommitRef", "Commit ref")}</span>
                      <input
                        className="cr-ref"
                        disabled={isBusy}
                        value={commit}
                        placeholder="HEAD"
                        onChange={(e) => setCommit(e.target.value)}
                      />
                    </label>
                  )}
                  {effectiveKind === "scan" && (
                    <label className="cr-field">
                      <span className="cr-field-caption">{t("reviewScanPaths", "Paths to scan")}</span>
                      <input
                        className="cr-ref"
                        disabled={isBusy}
                        value={scanPaths}
                        placeholder={t("reviewAllFiles", "All files")}
                        onChange={(e) => setScanPaths(e.target.value)}
                      />
                    </label>
                  )}
                </div>
              </div>
              <ReviewFilesPane
                files={files}
                findings={findings}
                file={file}
                onlyFindings={onlyFindings}
                setOnlyFindings={(value) => {
                  setOnlyFindings(value);
                  if (value) setTab("diff");
                }}
                onSelect={(path) => {
                  setSelectedFile(path);
                  setTab("diff");
                }}
                actions={
                  <button
                    type="button"
                    className="cr-control cr-icon-button"
                    disabled={isBusy || !workspace.project}
                    title={t("reviewPreview", "Preview changes")}
                    aria-label={t("reviewPreview", "Preview changes")}
                    onClick={() => {
                      workspace.refresh();
                      if (request) void previewChanges();
                    }}
                  >
                    <RefreshCw size={14} />
                  </button>
                }
              />
            </>
          }
          actions={
            <>
              <button type="button" className="cr-control" onClick={() => setDialog("history")}>
                <History size={15} />
                {t("reviewHistory", "History")}
              </button>
              <button type="button" className="cr-control" onClick={() => setDialog("rules")}>
                <ListFilter size={15} />
                {t("reviewRules", "Rules")}
              </button>
              <button type="button" className="cr-control" onClick={() => setDialog("mcp")}>
                <Plug size={15} />
                {t("reviewMcp", "OCR MCP")}
              </button>
              <button type="button" className="cr-control" onClick={() => setDialog("config")}>
                <Settings2 size={15} />
                {t("reviewEngineConfig", "Engine configuration")}
              </button>
              <button
                type="button"
                className="cr-control cr-engine-button"
                onClick={() => setDialog("engine")}
                title={t("reviewEngineTools", "OCR tools")}
                aria-label={t("reviewEngineTools", "OCR tools")}
              >
                <Ellipsis size={17} />
              </button>
            </>
          }
          review={
            <div className="cr-live-run" data-docked={docked || undefined}>
              {docked && (
                <div className="cr-transcript" data-review-transcript>
                  {notices}
                  {starting || !currentRun ? (
                    <p className="cr-activity-waiting" role="status">
                      {t("reviewActivityWaiting", "Waiting for the first model or tool output…")}
                    </p>
                  ) : (
                    <ReviewActivityPane
                      key={currentRun.id}
                      run={currentRun}
                      visible={liveVisible}
                      selected={tab === "review"}
                      workStepDisplay={workStepDisplay}
                    />
                  )}
                </div>
              )}
              <footer className="cr-runbar" data-review-controls>
                {!docked && (
                  <>
                    <div className="cr-launch-light" aria-hidden="true">
                      <i className="cr-light-blue" data-review-halo />
                      <i className="cr-light-violet" data-review-halo />
                    </div>
                    <span className="cr-launch-edge" aria-hidden="true">
                      <i data-review-edge />
                    </span>
                    <div className="cr-launch-hero">
                      <div className="cr-launch-copy" data-review-launch-copy>
                        <div className="cr-launch-status" data-ready={Boolean(preview && hasChanges && models.model)}>
                          <i aria-hidden="true" />
                          <span role="status">{runStatus}</span>
                        </div>
                        <h2 title={launchTitle}>{launchTitle}</h2>
                        {preview && (
                          <div className="cr-launch-files">
                            <Files size={13} aria-hidden="true" />
                            {t("reviewLaunchFiles", "{count} files in scope").replace("{count}", String(fileCount))}
                          </div>
                        )}
                      </div>
                      <div className="cr-launch-art" aria-hidden="true">
                        <div className="cr-launch-orbits">
                          <i className="cr-orbit-ring" />
                          <i className="cr-orbit-ring" />
                          <i className="cr-orbit-ring" />
                          <i className="cr-orbit-satellite" data-review-orbit="inner">
                            <span />
                          </i>
                          <i className="cr-orbit-satellite cr-orbit-satellite-outer" data-review-orbit="outer">
                            <span />
                          </i>
                        </div>
                        <span className="cr-launch-mark" data-review-mark>
                          <GitPullRequest size={30} strokeWidth={1.55} />
                        </span>
                      </div>
                    </div>
                  </>
                )}
                {docked && (
                  <div className="cr-statusbar" role="status">
                    <span className="cr-run-state" data-state={state ?? "idle"}>
                      <i data-review-signal />
                      {runStatus}
                    </span>
                    {state && !preview && run?.model && (
                      <span className="cr-status-caption" title={run.model}>
                        {run.model}
                      </span>
                    )}
                    {run && !preview && state && run.warningCount > 0 && (
                      <span className="cr-status-warning">
                        {t("reviewWarningCount", "{count} review warnings").replace(
                          "{count}",
                          String(run.warningCount),
                        )}
                      </span>
                    )}
                  </div>
                )}
                {!docked && notices}
                <div className="cr-run-controls" data-review-launch-controls>
                  <div className="cr-run-actions">
                    {exportable && (
                      <button type="button" className="cr-control cr-run-export" onClick={() => setDialog("export")}>
                        <Download size={14} />
                        {t("reviewExport", "Export")}
                      </button>
                    )}
                    <button type="button" className="cr-control" disabled={isBusy} onClick={() => setDialog("options")}>
                      <Settings2 size={15} />
                      {t("reviewOptions", "Review options")}
                      {Object.values(options).some((value) => value !== undefined && value !== false) && (
                        <span className="cr-option-dot" />
                      )}
                    </button>
                  </div>
                  <div className="cr-run-launch">
                    <ReviewModelPicker selection={models} disabled={isBusy} openSettings={onOpenModels} />
                    {active ? (
                      <button
                        type="button"
                        className="cr-control cr-stop"
                        disabled={run?.state === "cancelling"}
                        onClick={() => void cancel()}
                      >
                        <Square size={13} />
                        {t("reviewCancel", "Cancel review")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="cr-control cr-primary cr-start-button"
                        disabled={isBusy || (!preview && !runMatches) || !hasChanges || !models.model}
                        onClick={() => {
                          if (!models.model) return;
                          if (!docked) captureLaunchPosition();
                          setStale(false);
                          setOnlyFindings(false);
                          void start(models.model);
                        }}
                      >
                        {docked && <Play size={14} />}
                        {runMatches && !preview ? t("reviewRunAgain", "Review again") : t("reviewStart", "Run review")}
                        {!docked && <ArrowRight size={16} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                </div>
                {active && (
                  <span className="cr-scan" aria-hidden="true">
                    <i data-review-scan />
                  </span>
                )}
              </footer>
            </div>
          }
          diff={
            file && displayRequest ? (
              <ReviewDiffPane
                key={file.path}
                request={{ cwd: displayRequest.cwd, scope: diffScope ?? displayRequest.scope }}
                revision={preview?.id ?? currentRun?.id}
                file={file.path}
                findings={findings
                  .filter((finding) => finding.path === file.path)
                  .map((finding) => (run?.stale || stale ? { ...finding, line: null } : finding))}
                onOpenFinding={(finding) => void openFinding(finding)}
              />
            ) : (
              <div className="cr-empty">
                <span>
                  <GitPullRequest size={24} strokeWidth={1.5} />
                </span>
                <p>
                  {!selectedCwd
                    ? t("reviewSelectProject", "Choose a project or open a folder to start.")
                    : effectiveKind === "branch" && !request
                      ? t("reviewChooseBranches", "Choose a base branch and a PR branch to compare.")
                      : onlyFindings && runMatches && run.state === "complete"
                        ? t("reviewNoFindings", "No findings in the reviewed files.")
                        : preview && !hasChanges
                          ? t("reviewEmptyScope", "No reviewable changes")
                          : t(
                              "reviewAwaitingPreview",
                              "Preview the selected scope to see which files will be reviewed.",
                            )}
                </p>
              </div>
            )
          }
        />
        {liveVisible && dialog === "options" && (
          <ReviewOptionsDialog
            value={options}
            kind={effectiveKind}
            defaultEffort={engineStatus.effort}
            onSave={setOptions}
            onClose={() => setDialog(null)}
          />
        )}
        {liveVisible && dialog === "config" && (
          <ReviewConfigDialog
            busy={isBusy}
            onClose={() => setDialog(null)}
            onSaved={(status) => {
              setEngineStatus(status);
              if (request) void previewChanges();
            }}
          />
        )}
        {liveVisible && dialog === "mcp" && <ReviewMcpDialog onClose={() => setDialog(null)} running={active} />}
        {liveVisible && dialog === "export" && run && selectedCwd && (
          <ReviewExportDialog run={run} cwd={selectedCwd} onClose={() => setDialog(null)} />
        )}
        {liveVisible && (dialog === "history" || dialog === "rules" || dialog === "engine") && (
          <ReviewToolsDialog
            initial={dialog}
            cwd={selectedCwd}
            request={request}
            selectedFile={file?.path ?? null}
            model={models.model}
            lastSessionId={run?.request.cwd === selectedCwd ? run.sessionId : undefined}
            openModels={onOpenModels}
            onOpenHistory={(ref) => {
              setDialog(null);
              setHistoryRef(ref);
            }}
            onClose={() => setDialog(null)}
            onResume={(id, scope) => {
              selectScope(scope.kind);
              if (scope.kind === "branch") {
                setRange({ cwd: selectedCwd, from: scope.from, to: scope.to ?? "HEAD" });
              }
              if (scope.kind === "commit") setCommit(scope.ref);
              if (scope.kind === "scan") setScanPaths(scope.paths ?? "");
              setOptions({ ...options, resume: id });
            }}
          />
        )}
      </main>
      {historyRef && (
        <ReviewHistoryPage
          key={JSON.stringify(historyRef)}
          historyRef={historyRef}
          visible={visible}
          workStepDisplay={workStepDisplay}
          onBack={() => setHistoryRef(null)}
          onHistory={() => {
            setHistoryRef(null);
            setDialog("history");
          }}
        />
      )}
    </>
  );
}
