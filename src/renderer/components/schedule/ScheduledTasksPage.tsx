import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ScheduleRule, ScheduleRun, ScheduleSave, ScheduleTask } from "@contract/schedule";
import type { SessionInfo } from "@contract/types";
import { useI18n, type AppLanguage } from "@/i18n";
import { call, subscribe } from "@/lib/api-client";
import { getFileName } from "@/lib/file-paths";
import { formatAbsoluteDateTime, formatNumber } from "@/lib/locale-format";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { isDefaultSessionDirectory } from "@shared/session-workspace";
import { worktreePathsEqual } from "@shared/worktree-path";
import "./ScheduledTasksPage.css";

type Translate = ReturnType<typeof useI18n>["t"];
type TaskFilter = "all" | ScheduleTask["status"];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

function weekdayLabel(day: number, language: AppLanguage): string {
  // January 1, 2024 was a Monday.
  return new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, day));
}

function ruleLabel(rule: ScheduleRule, language: AppLanguage, t: Translate): string {
  switch (rule.kind) {
    case "once":
      return t("scheduleOnce", "Once");
    case "interval":
      return t("scheduleEveryMinutes", "Every {minutes} min").replace(
        "{minutes}",
        formatNumber(rule.minutes, language),
      );
    case "daily":
      return `${t("scheduleDaily", "Daily")} · ${rule.time} · ${rule.timeZone}`;
    case "weekly":
      return `${rule.weekdays.map((day) => weekdayLabel(day, language)).join(" / ")} · ${rule.time} · ${rule.timeZone}`;
  }
}

function runLabel(status: ScheduleRun["status"], t: Translate): string {
  switch (status) {
    case "running":
      return t("scheduleRunning", "Queued or running");
    case "succeeded":
      return t("scheduleSucceeded", "Succeeded");
    case "failed":
      return t("scheduleFailed", "Failed");
    case "interrupted":
      return t("scheduleInterrupted", "Interrupted");
  }
}

function localDateInput(instant: number): string {
  const date = new Date(instant);
  return new Date(instant - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SessionSelect({
  sessions,
  value,
  onChange,
}: {
  sessions: readonly SessionInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [projectView, setProjectView] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = sessions.find((session) => session.id === value);
  const selectedTitle = selected
    ? getSessionDisplayTitle(selected, 72)
    : value
      ? t("scheduleSessionUnavailable", "Session unavailable")
      : "";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalSessions = sessions
    .filter((session) => isDefaultSessionDirectory(session.cwd))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const projects: { path: string; sessions: SessionInfo[]; modified: string }[] = [];
  for (const session of sessions) {
    if (isDefaultSessionDirectory(session.cwd)) continue;
    const path = session.projectRoot || session.cwd;
    if (!path) continue;
    const project = projects.find((item) => worktreePathsEqual(item.path, path));
    if (project) {
      project.sessions.push(session);
      if (session.modified > project.modified) project.modified = session.modified;
    } else {
      projects.push({ path, sessions: [session], modified: session.modified });
    }
  }
  projects.sort((a, b) => b.modified.localeCompare(a.modified));
  const currentProject = projectView
    ? projects.find((project) => worktreePathsEqual(project.path, projectView))
    : undefined;
  const matchesSession = (session: SessionInfo) =>
    !normalizedQuery ||
    `${getSessionDisplayTitle(session, 72)} ${session.id} ${session.cwd}`.toLocaleLowerCase().includes(normalizedQuery);
  const visibleNormalSessions = normalSessions.filter(matchesSession);
  const visibleProjects = projects.filter(
    (project) =>
      !normalizedQuery ||
      `${project.path} ${getFileName(project.path)} ${project.sessions.map((session) => getSessionDisplayTitle(session, 72)).join(" ")}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );
  const visibleProjectSessions = currentProject?.sessions.filter(matchesSession) ?? [];
  const entries: ({ kind: "session"; session: SessionInfo } | { kind: "project"; path: string })[] = projectView
    ? visibleProjectSessions.map((session) => ({ kind: "session", session }))
    : [
        ...visibleNormalSessions.map((session) => ({ kind: "session" as const, session })),
        ...visibleProjects.map((project) => ({ kind: "project" as const, path: project.path })),
      ];
  const activeEntry = entries[activeIndex];

  const openProject = (path: string) => {
    const project = projects.find((item) => worktreePathsEqual(item.path, path));
    if (!project?.sessions.some(matchesSession)) setQuery("");
    setProjectView(path);
    setActiveIndex(0);
  };

  const choose = (id: string) => {
    onChange(id);
    setQuery("");
    setOpen(false);
    setProjectView(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (entries.length) {
        setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length);
      }
      return;
    }
    if (event.key === "Enter" && open && activeEntry) {
      event.preventDefault();
      if (activeEntry.kind === "session") choose(activeEntry.session.id);
      else openProject(activeEntry.path);
    }
  };

  return (
    <div
      className="schedule-session-select"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <button
        type="button"
        className={`schedule-session-trigger${open ? " is-open" : ""}${value ? " has-value" : ""}`}
        aria-expanded={open}
        aria-controls={listId}
        aria-required="true"
        aria-label={t("scheduleSession", "Run in session")}
        onClick={() => {
          if (open) {
            setOpen(false);
            setQuery("");
            return;
          }
          setOpen(true);
          setQuery("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <span className="schedule-session-trigger-copy">
          <span className="schedule-session-trigger-title">
            {selectedTitle || t("scheduleSelectSession", "Select a session")}
          </span>
          {selected?.cwd && (
            <span className="schedule-session-trigger-meta">{getFileName(selected.cwd) || selected.cwd}</span>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="schedule-session-popover">
          {projectView && (
            <div className="schedule-session-popover-heading">
              <button
                type="button"
                className="schedule-session-back"
                aria-label={t("back", "Back")}
                onClick={() => {
                  setProjectView(null);
                  setQuery("");
                  setActiveIndex(0);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
              </button>
              <Folder size={16} aria-hidden="true" />
              <span title={projectView}>{getFileName(projectView) || projectView}</span>
            </div>
          )}
          <div className="schedule-session-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                activeEntry
                  ? `${listId}-${activeEntry.kind}-${encodeURIComponent(
                      activeEntry.kind === "session" ? activeEntry.session.id : activeEntry.path,
                    )}`
                  : undefined
              }
              aria-label={t("searchSessions", "Search sessions")}
              placeholder={t("searchSessions", "Search sessions")}
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
            />
          </div>
          <div
            className="schedule-session-options"
            id={listId}
            role="listbox"
            aria-label={t("scheduleSession", "Run in session")}
          >
            {projectView ? (
              visibleProjectSessions.length ? (
                visibleProjectSessions.map((session, index) => (
                  <button
                    key={session.id}
                    id={`${listId}-session-${encodeURIComponent(session.id)}`}
                    type="button"
                    role="option"
                    aria-selected={session.id === value}
                    className={`schedule-session-option${index === activeIndex ? " is-active" : ""}${session.id === value ? " is-current" : ""}`}
                    title={session.cwd || undefined}
                    onMouseMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(session.id)}
                  >
                    <span className="schedule-session-option-icon">
                      <MessageCircle size={15} aria-hidden="true" />
                    </span>
                    <span className="schedule-session-option-copy">
                      <span className="schedule-session-option-title">{getSessionDisplayTitle(session, 72)}</span>
                      <span className="schedule-session-option-meta">
                        {session.worktreeBranch || getFileName(session.cwd) || session.cwd}
                      </span>
                    </span>
                    {session.id === value && (
                      <Check size={16} className="schedule-session-option-check" aria-hidden="true" />
                    )}
                  </button>
                ))
              ) : (
                <div className="schedule-session-empty">{t("noMatchingSessions", "No matching sessions")}</div>
              )
            ) : (
              <>
                {visibleNormalSessions.length > 0 && (
                  <div
                    className="schedule-session-group"
                    role="group"
                    aria-label={t("scheduleRegularSessions", "Regular sessions")}
                  >
                    <div className="schedule-session-group-label">
                      <MessageCircle size={13} aria-hidden="true" />
                      {t("scheduleRegularSessions", "Regular sessions")}
                    </div>
                    {visibleNormalSessions.map((session, index) => (
                      <button
                        key={session.id}
                        id={`${listId}-session-${encodeURIComponent(session.id)}`}
                        type="button"
                        role="option"
                        aria-selected={session.id === value}
                        className={`schedule-session-option${index === activeIndex ? " is-active" : ""}${session.id === value ? " is-current" : ""}`}
                        onMouseMove={() => setActiveIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(session.id)}
                      >
                        <span className="schedule-session-option-icon is-regular">
                          <MessageCircle size={15} aria-hidden="true" />
                        </span>
                        <span className="schedule-session-option-copy">
                          <span className="schedule-session-option-title">{getSessionDisplayTitle(session, 72)}</span>
                          <span className="schedule-session-option-meta">
                            {t("scheduleRegularSession", "Regular session")}
                          </span>
                        </span>
                        {session.id === value && (
                          <Check size={16} className="schedule-session-option-check" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {visibleProjects.length > 0 && (
                  <div className="schedule-session-group" role="group" aria-label={t("scheduleProjects", "Projects")}>
                    <div className="schedule-session-group-label">
                      <Folder size={13} aria-hidden="true" />
                      {t("scheduleProjects", "Projects")}
                    </div>
                    {visibleProjects.map((project, index) => {
                      const entryIndex = visibleNormalSessions.length + index;
                      return (
                        <button
                          key={project.path}
                          id={`${listId}-project-${encodeURIComponent(project.path)}`}
                          type="button"
                          role="option"
                          aria-selected="false"
                          className={`schedule-session-option schedule-session-project${entryIndex === activeIndex ? " is-active" : ""}`}
                          title={project.path}
                          onMouseMove={() => setActiveIndex(entryIndex)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openProject(project.path)}
                        >
                          <span className="schedule-session-option-icon is-project">
                            <Folder size={15} aria-hidden="true" />
                          </span>
                          <span className="schedule-session-option-copy">
                            <span className="schedule-session-option-title">
                              {getFileName(project.path) || project.path}
                            </span>
                            <span className="schedule-session-option-meta">
                              {project.path} · {project.sessions.length}
                            </span>
                          </span>
                          <ChevronRight size={15} className="schedule-session-project-chevron" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                )}
                {visibleNormalSessions.length === 0 && visibleProjects.length === 0 && (
                  <div className="schedule-session-empty">{t("noMatchingSessions", "No matching sessions")}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleEditor({
  task,
  sessions,
  preferredSessionId,
  onClose,
  onSave,
}: {
  task: ScheduleTask | null;
  sessions: readonly SessionInfo[];
  preferredSessionId?: string;
  onClose: () => void;
  onSave: (request: ScheduleSave) => Promise<void>;
}) {
  const { t, language } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [sessionId, setSessionId] = useState(task?.sessionId ?? preferredSessionId ?? "");
  const original = task?.rule;
  const [kind, setKind] = useState<ScheduleRule["kind"]>(original?.kind ?? "daily");
  const [once, setOnce] = useState(() =>
    localDateInput(original?.kind === "once" ? original.at : Date.now() + 3600_000),
  );
  const [minutes, setMinutes] = useState(original?.kind === "interval" ? String(original.minutes) : "60");
  const calendar = original?.kind === "daily" || original?.kind === "weekly" ? original : undefined;
  const [time, setTime] = useState(calendar?.time ?? "09:00");
  const [timeZone, setTimeZone] = useState(calendar?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [weekdays, setWeekdays] = useState(original?.kind === "weekly" ? original.weekdays : [1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedSession = sessions.find((session) => session.id === sessionId);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !name.trim() || !prompt.trim()) return;
    if (!sessionId) {
      setError(t("scheduleSelectSession", "Select a session"));
      return;
    }
    setError("");
    let rule: ScheduleRule;
    if (kind === "once") {
      const unchanged = original?.kind === "once" && once === localDateInput(original.at);
      const at = unchanged ? original.at : new Date(once).getTime();
      if (!unchanged && (!Number.isFinite(at) || localDateInput(at) !== once || at <= Date.now())) {
        setError(t("scheduleInvalidDate", "Choose a valid date and time in the future."));
        return;
      }
      rule = { kind, at };
    } else if (kind === "interval") {
      rule = { kind, minutes: Number(minutes) };
    } else {
      rule = kind === "weekly" ? { kind, time, timeZone, weekdays } : { kind, time, timeZone };
    }

    setBusy(true);
    try {
      await onSave({ ...(task ? { id: task.id, revision: task.revision } : {}), name, prompt, sessionId, rule });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="schedule-editor"
      aria-labelledby="schedule-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="schedule-editor-title">
          {task ? t("scheduleEdit", "Edit scheduled task") : t("scheduleNew", "New task")}
        </h2>
        <label>
          {t("scheduleName", "Task name")}
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="schedule-session-field">
          <span>{t("scheduleSession", "Run in session")}</span>
          <SessionSelect sessions={sessions} value={sessionId} onChange={setSessionId} />
        </div>
        {sessions.length === 0 && (
          <p className="schedule-hint">{t("scheduleNoSessions", "Start a conversation before scheduling a task.")}</p>
        )}
        <label>
          {t("schedulePrompt", "Instructions")}
          <textarea
            required
            rows={4}
            maxLength={16_000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="schedule-form-grid">
          <label>
            {t("scheduleRepeat", "Repeat")}
            <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleRule["kind"])}>
              <option value="daily">{t("scheduleDaily", "Daily")}</option>
              <option value="weekly">{t("scheduleWeekly", "Weekly")}</option>
              <option value="interval">{t("scheduleInterval", "Fixed interval")}</option>
              <option value="once">{t("scheduleOnce", "Once")}</option>
            </select>
          </label>
          {kind === "once" ? (
            <label>
              {t("scheduleLocalDateTime", "Date and time (local)")}
              <input type="datetime-local" required value={once} onChange={(event) => setOnce(event.target.value)} />
            </label>
          ) : kind === "interval" ? (
            <label>
              {t("scheduleMinutes", "Interval in minutes")}
              <input
                type="number"
                min={1}
                max={525600}
                required
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                {t("scheduleTime", "Time")}
                <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
              <label>
                {t("scheduleTimeZone", "Time zone (IANA)")}
                <input
                  required
                  maxLength={100}
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {kind === "weekly" && (
          <fieldset>
            <legend>{t("scheduleDays", "Days of the week")}</legend>
            <div className="schedule-weekdays">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={weekdays.includes(day)}
                  onClick={() =>
                    setWeekdays((current) =>
                      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
                    )
                  }
                >
                  {weekdayLabel(day, language)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p className="schedule-error" role="alert">
            {error}
          </p>
        )}
        <footer className="schedule-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t("cancel", "Cancel")}
          </button>
          <button
            type="submit"
            className="schedule-primary"
            disabled={
              busy || !selectedSession || !name.trim() || !prompt.trim() || (kind === "weekly" && weekdays.length === 0)
            }
          >
            {t("save", "Save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function ScheduledTasksPage({
  sessions,
  selectedSessionId,
  onOpenSession,
}: {
  sessions: readonly SessionInfo[];
  selectedSessionId?: string;
  onOpenSession: (session: SessionInfo) => void;
}) {
  const { t, language } = useI18n();
  const [tasks, setTasks] = useState<ScheduleTask[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ task: ScheduleTask | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const requests = useRef({ latest: 0 });
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  const refresh = useCallback(async () => {
    const state = requests.current;
    const id = ++state.latest;
    try {
      const list = await call("schedule.list");
      if (id !== state.latest) return;
      setTasks(list);
      setLoadError("");
    } catch (error) {
      if (id === state.latest) setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const state = requests.current;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void subscribe("schedule.changed", "*", () => {
      if (!disposed) void refresh();
    })
      .then((off) => {
        if (disposed) off();
        else {
          unsubscribe = off;
          void refresh();
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      state.latest++;
      unsubscribe?.();
    };
  }, [refresh]);

  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      await refresh();
      setBusy(false);
    }
  };
  const labels: Record<TaskFilter, string> = {
    all: t("scheduleAll", "All tasks"),
    active: t("scheduleActive", "Active"),
    paused: t("schedulePaused", "Paused"),
    completed: t("scheduleCompleted", "Completed"),
  };
  const visible = tasks?.filter((task) => filter === "all" || filter === task.status);
  const openSession = (sessionId: string) => {
    const session = sessionsById.get(sessionId);
    if (session) onOpenSession(session);
  };

  return (
    <main className="scheduled-page">
      <div className="scheduled-page-content">
        <header className="schedule-page-header">
          <div>
            <h1>{t("scheduledTasks", "Scheduled tasks")}</h1>
            <p>{t("scheduleSubtitle", "Run saved instructions in a session while Serphia is open.")}</p>
          </div>
          <button type="button" className="schedule-primary" onClick={() => setEditor({ task: null })}>
            <Plus size={16} aria-hidden="true" />
            {t("scheduleNew", "New task")}
          </button>
        </header>

        <div className="schedule-filters" role="group" aria-label={t("scheduleFilter", "Filter by status")}>
          {(Object.keys(labels) as TaskFilter[]).map((value) => (
            <button key={value} type="button" aria-pressed={value === filter} onClick={() => setFilter(value)}>
              {labels[value]}
            </button>
          ))}
        </div>
        {loadError && (
          <div className="schedule-error schedule-actions" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void refresh()}>
              {t("retryUpdate", "Retry")}
            </button>
          </div>
        )}
        {actionError && (
          <p className="schedule-error" role="alert">
            {actionError}
          </p>
        )}
        {!tasks && !loadError && <p role="status">{t("scheduleLoading", "Loading scheduled tasks…")}</p>}

        {visible?.length === 0 && (
          <div className="schedule-empty">
            <CalendarClock size={22} aria-hidden="true" />
            <h2>{t("scheduleEmpty", "No scheduled tasks")}</h2>
            <p>
              {filter === "all"
                ? t("scheduleEmptyHint", "Create a task to revisit a conversation on a schedule.")
                : t("scheduleEmptyFilter", "There are no tasks with this status.")}
            </p>
          </div>
        )}

        {visible?.map((task) => {
          const session = sessionsById.get(task.sessionId);
          const lastRun = task.runs[0];
          const running = lastRun?.status === "running";
          const open = expanded === task.id;
          const identity = { id: task.id, revision: task.revision };
          return (
            <article className="schedule-task" key={task.id}>
              <button
                type="button"
                className="schedule-task-summary"
                aria-expanded={open}
                aria-controls={`schedule-detail-${task.id}`}
                onClick={() => setExpanded(open ? null : task.id)}
              >
                <span className="schedule-task-icon">
                  <Clock size={17} aria-hidden="true" />
                </span>
                <span className="schedule-task-copy">
                  <strong>{task.name}</strong>
                  <span>{ruleLabel(task.rule, language, t)}</span>
                </span>
                <span className={`schedule-badge schedule-${running ? "running" : task.status}`}>
                  {running ? runLabel("running", t) : labels[task.status]}
                </span>
                <ChevronDown className="schedule-chevron" size={16} aria-hidden="true" />
              </button>
              <div className="schedule-task-detail" hidden={!open} id={`schedule-detail-${task.id}`}>
                <dl className="schedule-metadata">
                  <div>
                    <dt>{t("scheduleSession", "Run in session")}</dt>
                    <dd>
                      {session
                        ? getSessionDisplayTitle(session)
                        : t("scheduleSessionUnavailable", "Session unavailable")}
                    </dd>
                  </div>
                  {task.nextAt !== null && (
                    <div>
                      <dt>{t("scheduleNextRun", "Next run (local time)")}</dt>
                      <dd>{formatAbsoluteDateTime(task.nextAt, language)}</dd>
                    </div>
                  )}
                </dl>
                <p className="schedule-task-prompt">{task.prompt}</p>
                <div className="schedule-actions">
                  <button
                    type="button"
                    disabled={busy || running || !session}
                    onClick={() => void mutate(() => call("schedule.run", identity))}
                  >
                    <Play size={14} aria-hidden="true" /> {t("scheduleRunNow", "Run now")}
                  </button>
                  {task.status !== "completed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(() => call("schedule.pause", { ...identity, paused: task.status === "active" }))
                      }
                    >
                      {task.status === "active" ? (
                        <Pause size={14} aria-hidden="true" />
                      ) : (
                        <Play size={14} aria-hidden="true" />
                      )}
                      {task.status === "active" ? t("schedulePause", "Pause") : t("scheduleResume", "Resume")}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => setEditor({ task })}>
                    <Pencil size={14} aria-hidden="true" /> {t("scheduleEditShort", "Edit")}
                  </button>
                  {session && (
                    <button type="button" onClick={() => openSession(session.id)}>
                      {t("scheduleOpenSession", "Open session")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="schedule-delete"
                    disabled={busy || running}
                    onClick={() => {
                      if (window.confirm(t("scheduleConfirmDelete", "Delete this task and its run history?"))) {
                        void mutate(() => call("schedule.remove", { id: task.id }));
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" /> {t("delete", "Delete")}
                  </button>
                </div>

                <div className="schedule-history">
                  <h3>{t("scheduleHistory", "Recent runs")}</h3>
                  {task.runs.length === 0 ? (
                    <p>{t("scheduleNoRuns", "This task has not run yet.")}</p>
                  ) : (
                    <ul>
                      {task.runs.map((run) => (
                        <li key={run.id}>
                          <div>
                            <span>{formatAbsoluteDateTime(run.scheduledAt, language)}</span>
                            {run.trigger === "manual" && <small>{t("scheduleManual", "Manual")}</small>}
                            {run.sessionId !== task.sessionId && sessionsById.has(run.sessionId) && (
                              <button type="button" onClick={() => openSession(run.sessionId)}>
                                {t("scheduleOpenSession", "Open session")}
                              </button>
                            )}
                            <span className={`schedule-badge schedule-${run.status}`}>{runLabel(run.status, t)}</span>
                          </div>
                          {run.error && <p className="schedule-run-error">{run.error}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {editor && (
        <ScheduleEditor
          task={editor.task}
          sessions={sessions}
          preferredSessionId={selectedSessionId}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            const task = await call("schedule.save", input);
            setEditor(null);
            setFilter("all");
            setExpanded(task.id);
            await refresh();
          }}
        />
      )}
    </main>
  );
}
