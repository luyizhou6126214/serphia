import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, History, Play, X } from "lucide-react";
import type {
  ReviewCommand,
  ReviewCommandOutput,
  ReviewExportFormat,
  ReviewHistoryRef,
  ReviewHistoryRow,
  ReviewModelSelection,
  ReviewRequest,
  ReviewScope,
} from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { getFileName } from "@/lib/file-paths";
import { reviewIssueText, reviewScopeText, reviewStateText } from "./copy";
import { ReviewExportFormats, saveReviewOutput } from "./ReviewExportDialog";
import { ReviewSelect } from "./ReviewSelect";

const HISTORY_PAGE_SIZE = 40;

type Panel = "history" | "rules" | "engine";
type Action = ReviewCommand["kind"] | "browseHistory" | "testModel" | "openModels";

export function ReviewToolsDialog({
  initial,
  cwd,
  request,
  selectedFile,
  model,
  nativeModel,
  lastSessionId,
  openModels,
  onResume,
  onOpenHistory,
  onClose,
}: {
  initial: Panel;
  cwd: string | null;
  request: ReviewRequest | null;
  selectedFile: string | null;
  model: ReviewModelSelection | null;
  nativeModel: boolean;
  lastSessionId?: string;
  openModels: () => void;
  onResume: (id: string, scope: ReviewScope) => void;
  onOpenHistory: (ref: ReviewHistoryRef) => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = initial;
  const [action, setAction] = useState<Action>(
    initial === "history" ? "browseHistory" : initial === "rules" ? "ruleCheck" : "version",
  );
  const [id, setId] = useState(lastSessionId ?? "");
  const [otherId, setOtherId] = useState("");
  const [file, setFile] = useState(selectedFile ?? "");
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");
  const [shell, setShell] = useState<"bash" | "zsh" | "fish" | "powershell">("zsh");
  const [help, setHelp] = useState<Extract<ReviewCommand, { kind: "help" }>["command"]>("review");
  const [limit, setLimit] = useState(20);
  const [format, setFormat] = useState<ReviewExportFormat>("html");
  const [commandFormat, setCommandFormat] = useState<"text" | "json">("json");
  const [output, setOutput] = useState<ReviewCommandOutput | null>(null);
  const [history, setHistory] = useState<ReviewHistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyPaging, setHistoryPaging] = useState<{ cwd: string | null; offset: number; attempt: number }>();
  const historyOffset = historyPaging && historyPaging.cwd === cwd ? historyPaging.offset : 0;
  const historyAttempt = historyPaging && historyPaging.cwd === cwd ? historyPaging.attempt : 0;
  const [historyMore, setHistoryMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = history?.find((row) => row.sessionId === id && row.root === cwd)?.scope ?? request?.scope;
  const nextScope = scope?.kind === "workspace" ? undefined : scope;
  const browse = action === "browseHistory";
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (panel !== "history") return;
    let current = true;
    setHistoryError(false);
    setHistoryLoading(true);
    void call("codeReview.history.list", { cwd: cwd ?? undefined, limit: HISTORY_PAGE_SIZE, offset: historyOffset })
      .then((reply) => {
        if (!current) return;
        if (reply.ok) {
          setHistory((previous) => {
            if (!historyOffset || !previous) return reply.value;
            const known = new Set(previous.map((row) => JSON.stringify(row.ref)));
            return [...previous, ...reply.value.filter((row) => !known.has(JSON.stringify(row.ref)))];
          });
          setHistoryMore(reply.value.length === HISTORY_PAGE_SIZE);
        } else setHistoryError(true);
      })
      .catch(() => {
        if (current) setHistoryError(true);
      })
      .finally(() => {
        if (current) setHistoryLoading(false);
      });
    return () => {
      current = false;
    };
  }, [panel, cwd, historyOffset, historyAttempt]);

  const title =
    panel === "history"
      ? t("reviewHistory", "History")
      : panel === "rules"
        ? t("reviewRules", "Rules")
        : t("reviewEngineTools", "OCR tools");
  const historyActions: [Action, string][] = [
    ["browseHistory", t("reviewHistoryBrowse", "Browse reviews")],
    ["sessions", t("reviewListSessions", "List sessions")],
    ["sessionShow", t("reviewSessionDetail", "Session details")],
    ["sessionComments", t("reviewSessionFindings", "Session findings")],
    ["sessionCompare", t("reviewCompareSessions", "Compare sessions")],
    ["sessionExport", t("reviewExportSession", "Export session")],
    ["sessionDelete", t("reviewDeleteSession", "Delete session")],
    ["viewer", t("reviewOpenViewer", "Open session viewer")],
    ["viewerStop", t("reviewStopViewer", "Stop session viewer")],
  ];
  const rulesActions: [Action, string][] = [
    ["ruleCheck", t("reviewCheckRule", "Check rules for a file")],
    ["delegatePreview", t("reviewDelegatePreview", "Preview delegated scope")],
    ["delegateRule", t("reviewDelegateRules", "Get delegated rules")],
  ];
  const engineActions: [Action, string][] = [
    ["version", t("reviewEngineVersion", "Engine version")],
    ["providers", t("reviewEngineProviders", "Built-in OCR providers")],
    ["testModel", t("reviewTestModel", "Test selected model")],
    ["openModels", t("reviewManageModels", "Manage models and authentication")],
    ["completion", t("reviewCompletion", "Shell completions")],
    ["help", t("reviewCommandHelp", "Command help")],
  ];
  const needsId =
    action === "sessionShow" ||
    action === "sessionComments" ||
    action === "sessionCompare" ||
    action === "sessionExport" ||
    action === "sessionDelete";
  const selectableFormat =
    action === "sessions" ||
    action === "sessionShow" ||
    action === "sessionComments" ||
    action === "sessionCompare" ||
    action === "delegatePreview" ||
    action === "delegateRule";

  function command(): ReviewCommand | null {
    switch (action) {
      case "sessions":
        return cwd ? { kind: "sessions", cwd, limit, format: commandFormat } : null;
      case "sessionShow":
        return cwd && id ? { kind: action, cwd, id, format: commandFormat } : null;
      case "sessionDelete":
        return cwd && id ? { kind: action, cwd, id } : null;
      case "sessionComments":
        return cwd && id ? { kind: action, cwd, id, severity: filter, category, format: commandFormat } : null;
      case "sessionCompare":
        return cwd && id && otherId ? { kind: action, cwd, before: id, after: otherId, format: commandFormat } : null;
      case "sessionExport":
        return cwd ? { kind: action, cwd, id: id || undefined, format } : null;
      case "ruleCheck":
        return cwd && file ? { kind: action, cwd, file, rule: request?.options?.rule } : null;
      case "delegatePreview":
        return request && request.scope.kind !== "scan" ? { kind: action, request, format: commandFormat } : null;
      case "delegateRule":
        return request && file && request.scope.kind !== "scan"
          ? { kind: action, request, files: file, format: commandFormat }
          : null;
      case "completion":
        return { kind: action, shell };
      case "help":
        return { kind: action, command: help };
      case "version":
      case "providers":
      case "viewer":
      case "viewerStop":
        return { kind: action };
      default:
        return null;
    }
  }

  async function execute() {
    if (busy) return;
    if (action === "openModels") {
      onClose();
      openModels();
      return;
    }
    const next = command();
    if (!next && action !== "testModel") return;
    if (
      next?.kind === "sessionDelete" &&
      !window.confirm(t("reviewConfirmDelete", "Delete this saved review session?"))
    )
      return;
    setBusy(true);
    setOutput(null);
    setStatus("");
    try {
      if (action === "testModel" && cwd && (model || nativeModel)) {
        const reply = await call("codeReview.testModel", { cwd, model });
        setStatus(reply.ok ? t("reviewTestPassed", "Connection verified") : reviewIssueText(reply.issue, t));
      } else if (next) {
        const reply = await call("codeReview.command", next);
        if (!reply.ok) setStatus(reviewIssueText(reply.issue, t));
        else {
          if (next.kind === "sessionDelete") {
            setHistory((prior) => prior?.filter((item) => item.sessionId !== id || item.root !== cwd) ?? null);
            setHistoryPaging(undefined);
            setId("");
          }
          if (reply.value.viewerUrl) await window.piBridge.openExternal(reply.value.viewerUrl);
          setOutput(reply.value);
          setStatus(t("reviewCommandDone", "Command completed"));
        }
      }
    } catch {
      setStatus(t("reviewErrorGeneric", "The review could not finish. Check your worktree and model settings."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!output?.filename) return;
    try {
      await saveReviewOutput(output);
    } catch {
      setStatus(t("reviewErrorOutput", "The review engine returned an unreadable result."));
    }
  }

  return (
    <dialog className="cr-dialog cr-tool-dialog" ref={dialog} onCancel={onClose} aria-labelledby="review-tools-title">
      <header>
        <h2 id="review-tools-title">{title}</h2>
        <button type="button" className="cr-control" onClick={onClose} aria-label={t("reviewClose", "Close")}>
          <X size={17} />
        </button>
      </header>
      <form
        className="cr-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void execute();
        }}
      >
        <label>
          {t("reviewAction", "Action")}
          <ReviewSelect
            label={t("reviewAction", "Action")}
            value={action}
            onChange={(value) => {
              setAction(value as Action);
              setOutput(null);
              setStatus("");
            }}
          >
            {(panel === "history" ? historyActions : panel === "rules" ? rulesActions : engineActions).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </ReviewSelect>
        </label>
        {panel === "history" && (browse || needsId) && (
          <div className="cr-history" data-browse={browse || undefined}>
            {historyError && !history ? (
              <p className="cr-inline-message" role="alert">
                {t("reviewHistoryLoadError", "Could not load review history.")}
              </p>
            ) : !history ? (
              <p className="cr-inline-message" role="status">
                {t("reviewHistoryLoading", "Loading review history…")}
              </p>
            ) : browse && history.length === 0 ? (
              <p className="cr-inline-message">{t("reviewHistoryEmpty", "Saved reviews will appear here.")}</p>
            ) : (
              history
                .filter((item) => browse || (item.root === cwd && item.sessionId))
                .map((item) => (
                  <button
                    type="button"
                    className="cr-history-row"
                    aria-pressed={browse ? undefined : item.sessionId === id}
                    key={JSON.stringify(item.ref)}
                    onClick={() => (browse ? onOpenHistory(item.ref) : setId(item.sessionId ?? ""))}
                    title={item.root}
                  >
                    <History size={16} aria-hidden="true" />
                    <span className="cr-history-row-title">
                      <strong>{getFileName(item.projectRoot ?? item.root) || item.root}</strong>
                      <small>{reviewScopeText(item.scope, t)}</small>
                    </span>
                    <span className="cr-history-row-meta">
                      <strong>{item.startedAt ? dates.format(item.startedAt) : reviewStateText(item.state, t)}</strong>
                      <small>
                        {item.model} · {reviewStateText(item.state, t)}
                      </small>
                    </span>
                    {browse && <ChevronRight size={15} aria-hidden="true" />}
                  </button>
                ))
            )}
            {browse && historyError && history && (
              <p className="cr-inline-message" role="alert">
                {t("reviewHistoryLoadError", "Could not load review history.")}
              </p>
            )}
            {browse && historyMore && (
              <button
                type="button"
                className="cr-control cr-history-more"
                disabled={historyLoading}
                onClick={() =>
                  setHistoryPaging({
                    cwd,
                    offset: historyError ? historyOffset : historyOffset + HISTORY_PAGE_SIZE,
                    attempt: historyAttempt + 1,
                  })
                }
              >
                {t("reviewHistoryMore", "Show older reviews")}
              </button>
            )}
          </div>
        )}
        {action === "sessions" && (
          <label>
            {t("reviewSessionLimit", "Maximum sessions")}
            <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </label>
        )}
        {needsId && (
          <label>
            {t("reviewSessionId", "Session ID")}
            <input value={id} onChange={(e) => setId(e.target.value)} />
          </label>
        )}
        {action === "sessionExport" && <ReviewExportFormats value={format} onChange={setFormat} />}
        {selectableFormat && (
          <ReviewExportFormats
            value={commandFormat}
            html={false}
            sarif={false}
            onChange={(value) => {
              if (value === "json" || value === "text") setCommandFormat(value);
            }}
          />
        )}
        {action === "sessionCompare" && (
          <label>
            {t("reviewAfterSession", "After session")}
            <input value={otherId} onChange={(e) => setOtherId(e.target.value)} />
          </label>
        )}
        {action === "sessionComments" && (
          <div className="cr-form-grid">
            <label>
              {t("reviewSeverityFilter", "Severity filter")}
              <input value={filter} placeholder="high,critical" onChange={(e) => setFilter(e.target.value)} />
            </label>
            <label>
              {t("reviewCategoryFilter", "Category filter")}
              <input value={category} placeholder="bug,security" onChange={(e) => setCategory(e.target.value)} />
            </label>
          </div>
        )}
        {(action === "ruleCheck" || action === "delegateRule") && (
          <label>
            {t("reviewRelativeFiles", "Repository-relative files")}
            <input value={file} onChange={(e) => setFile(e.target.value)} />
          </label>
        )}
        {action === "completion" && (
          <label>
            {t("reviewCompletionShell", "Shell")}
            <ReviewSelect
              label={t("reviewCompletionShell", "Shell")}
              value={shell}
              onChange={(value) => setShell(value as typeof shell)}
            >
              {["bash", "zsh", "fish", "powershell"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </ReviewSelect>
          </label>
        )}
        {action === "help" && (
          <label>
            {t("reviewHelpTopic", "Command")}
            <ReviewSelect
              label={t("reviewHelpTopic", "Command")}
              value={help}
              onChange={(value) => setHelp(value as typeof help)}
            >
              {["review", "scan", "session", "rules", "delegate", "config", "auth", "llm", "viewer", "completion"].map(
                (name) => (
                  <option key={name}>{name}</option>
                ),
              )}
            </ReviewSelect>
          </label>
        )}
        {status && (
          <p className="cr-inline-message" role="status">
            {status}
          </p>
        )}
        {output?.text && action !== "sessionExport" && action !== "completion" && (
          <pre className="cr-tool-output">{output.text}</pre>
        )}
        {!browse && (
          <footer>
            {output?.filename && (
              <button type="button" className="cr-control" onClick={() => void save()}>
                <Download size={14} />
                {t("reviewSaveOutput", "Save output")}
              </button>
            )}
            {panel === "history" && id && nextScope && (
              <button
                type="button"
                className="cr-control"
                onClick={() => {
                  onResume(id, nextScope);
                  onClose();
                }}
              >
                {t("reviewUseResume", "Use for resume")}
              </button>
            )}
            <button
              type="submit"
              className="cr-control cr-primary"
              disabled={
                busy ||
                (!command() && action !== "openModels" && !(action === "testModel" && cwd && (model || nativeModel)))
              }
            >
              <Play size={14} />
              {busy ? t("reviewCommandRunning", "Running…") : t("reviewRunCommand", "Run command")}
            </button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
