import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ClipboardList, FileDiff, Plus } from "lucide-react";
import type {
  SuperAgentPermissionMode,
  SuperAgentRoom,
  SuperAgentTask,
  SuperAgentTaskArtifact,
  SuperAgentTaskDraft,
  SuperAgentTaskEventKind,
  SuperAgentTaskInfo,
  SuperAgentTaskRun,
  SuperAgentTaskRunStatus,
  SuperAgentTaskStatus,
} from "@contract/superagent";
import { call, subscribe } from "@/lib/api-client";
import { MarkdownBody } from "../MarkdownBody";
import "./SuperAgentTasksPage.css";

const statusLabels: Record<SuperAgentTaskStatus | SuperAgentTaskRunStatus, [string, string]> = {
  queued: ["Queued", "排队中"],
  running: ["Running", "执行中"],
  waiting: ["Action required", "待处理"],
  approval: ["Waiting for permission", "等待授权"],
  question: ["Waiting for an answer", "等待回复"],
  blocked: ["Blocked", "受阻"],
  failed: ["Failed", "失败"],
  paused: ["Paused", "已暂停"],
  interrupted: ["Interrupted", "已中断"],
  in_review: ["Ready for review", "待验收"],
  succeeded: ["Delivered", "已交付"],
  accepted: ["Accepted", "已验收"],
  cancelled: ["Cancelled", "已取消"],
};

const eventLabels: Record<SuperAgentTaskEventKind, [string, string]> = {
  created: ["Task created", "创建任务"],
  delegated: ["Assigned", "派工"],
  started: ["Run started", "开始执行"],
  settled: ["Run ended", "执行结束"],
  answered: ["Answered", "已回复"],
  approval_requested: ["Permission requested", "请求授权"],
  approval_decided: ["Permission decided", "已处理授权"],
  paused: ["Paused", "暂停"],
  resumed: ["Resumed", "继续"],
  retried: ["New attempt queued", "已安排重试"],
  cancelled: ["Cancelled", "取消"],
  accepted: ["Accepted", "通过验收"],
  returned: ["Returned for changes", "打回修改"],
};

const stageLabels = {
  plan: ["Delegation", "队长派工"],
  work: ["Assignment", "子任务"],
  summary: ["Summary", "队长汇总"],
} satisfies Record<SuperAgentTaskRun["kind"], [string, string]>;

function finished(task: SuperAgentTaskInfo) {
  return task.status === "accepted" || task.status === "cancelled";
}

type Say = (en: string, zh: string) => string;
type RunAction = (action: () => Promise<SuperAgentTask | void>) => Promise<void>;

function TaskEditor({
  roomId,
  say,
  busy,
  create,
  cancel,
}: {
  roomId: string;
  say: Say;
  busy: boolean;
  create(draft: SuperAgentTaskDraft): void;
  cancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [permissionMode, setPermissionMode] = useState<SuperAgentPermissionMode>("ask");
  return (
    <form
      className="sa-task-card sa-task-stack"
      onSubmit={(event) => {
        event.preventDefault();
        create({ roomId, title, goal, criteria, permissionMode });
      }}
    >
      <h3>{say("New task", "新建任务")}</h3>
      <label className="sa-field">
        <span>{say("Title", "标题")}</span>
        <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="sa-field">
        <span>{say("Goal", "目标")}</span>
        <textarea required rows={4} maxLength={16000} value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label className="sa-field">
        <span>{say("Acceptance criteria", "验收条件")}</span>
        <textarea
          required
          rows={3}
          maxLength={8000}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
      </label>
      <label className="sa-field">
        <span>{say("Worker tool permissions", "成员工具权限")}</span>
        <select
          value={permissionMode}
          onChange={(event) => setPermissionMode(event.target.value === "workspaceEdits" ? "workspaceEdits" : "ask")}
        >
          <option value="ask">{say("Ask on permission requests", "逐项确认权限请求")}</option>
          <option value="workspaceEdits">
            {say("Allow ordinary edits in the assigned directory", "允许在分配目录内进行普通编辑")}
          </option>
        </select>
      </label>
      <small>
        {say(
          "Git projects start from the selected checkout’s HEAD. Other folders use a snapshot.",
          "Git 项目从所选工作目录的 HEAD 开始，其他目录使用快照。",
        )}
      </small>
      <div className="sa-task-actions">
        <button
          type="submit"
          className="sa-button sa-primary"
          disabled={busy || !title.trim() || !goal.trim() || !criteria.trim()}
        >
          {busy ? say("Starting…", "正在启动…") : say("Start task", "启动任务")}
        </button>
        {cancel && (
          <button type="button" className="sa-button sa-secondary" onClick={cancel} disabled={busy}>
            {say("Back", "返回")}
          </button>
        )}
      </div>
    </form>
  );
}

function RunDetails({
  run,
  id,
  current,
  busy,
  say,
  action,
  showDiff,
}: {
  run: SuperAgentTaskRun;
  id: string;
  current: boolean;
  busy: boolean;
  say: Say;
  action: RunAction;
  showDiff: (opener: HTMLButtonElement) => void;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="sa-task-stack">
      {run.error && <p className="sa-task-error">{run.error}</p>}
      {run.report && <MarkdownBody variant="compact">{run.report}</MarkdownBody>}
      {run.tests && (
        <div className="sa-task-tests">
          <strong>{say("Tests reported by agent", "Agent 报告的测试结果")}</strong>
          <MarkdownBody variant="compact">{run.tests}</MarkdownBody>
        </div>
      )}
      {run.artifact && (
        <div className="sa-task-actions">
          <button
            type="button"
            className="sa-button sa-secondary"
            disabled={busy}
            onClick={(event) => showDiff(event.currentTarget)}
          >
            <FileDiff size={16} aria-hidden="true" />
            {say("View diff", "查看 Diff")} · {run.artifact.paths.length}
          </button>
          {run.artifact.branch && (
            <small>
              <code>{run.artifact.branch}</code>
            </small>
          )}
          <small title={run.artifact.cwd} className="sa-task-path">
            {run.artifact.cwd}
          </small>
        </div>
      )}
      {run.approvals?.map((approval) => (
        <div className="sa-task-callout sa-task-stack" key={approval.id}>
          <strong>{approval.title}</strong>
          {approval.detail && <pre>{approval.detail}</pre>}
          <div className="sa-task-actions">
            {approval.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="sa-button sa-secondary"
                disabled={busy || !current}
                onClick={() =>
                  void action(() =>
                    call("superagent.tasks.approval", {
                      id,
                      runId: run.id,
                      approvalId: approval.id,
                      choice: option.id,
                    }),
                  )
                }
              >
                {option.id === "allow"
                  ? say("Allow once", "允许一次")
                  : option.id === "deny"
                    ? say("Deny", "拒绝")
                    : option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {run.question && <p className="sa-task-callout">{run.question}</p>}
      {run.status === "question" && current && (
        <form
          className="sa-task-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void action(() => call("superagent.tasks.answer", { id, runId: run.id, text: answer }));
          }}
        >
          <label className="sa-field">
            <span>{say("Your answer", "你的回复")}</span>
            <textarea
              rows={2}
              required
              maxLength={8000}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <button type="submit" className="sa-button sa-secondary" disabled={busy || !answer.trim()}>
            {say("Send answer", "发送回复")}
          </button>
        </form>
      )}
      {current && (run.status === "failed" || run.status === "blocked") && (
        <button
          type="button"
          className="sa-button sa-secondary"
          disabled={busy}
          onClick={() => void action(() => call("superagent.tasks.retry", { id, runId: run.id }))}
        >
          {say("Retry this run", "重试此项")}
        </button>
      )}
    </div>
  );
}

function ReviewActions({
  task,
  name,
  busy,
  say,
  action,
}: {
  task: SuperAgentTask;
  name: (id: string) => string;
  busy: boolean;
  say: Say;
  action: RunAction;
}) {
  const [returning, setReturning] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const summaryRunId = task.summaryRunId;
  if (!summaryRunId) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action(() =>
      call("superagent.tasks.review", {
        id: task.id,
        review: { decision: "return", summaryRunId, subtaskIds: selected, note },
      }),
    );
  };
  return (
    <section className="sa-task-card sa-task-stack">
      <h3>{say("Review", "人工验收")}</h3>
      <div className="sa-task-actions">
        <button
          type="button"
          className="sa-button sa-primary"
          disabled={busy}
          onClick={() =>
            void action(() =>
              call("superagent.tasks.review", {
                id: task.id,
                review: { decision: "accept", summaryRunId },
              }),
            )
          }
        >
          {say("Accept task", "通过验收")}
        </button>
        <button
          type="button"
          className="sa-button sa-secondary"
          disabled={busy}
          aria-expanded={returning}
          onClick={() => setReturning(!returning)}
        >
          {say("Return for changes", "打回修改")}
        </button>
      </div>
      {returning && (
        <form className="sa-task-stack" onSubmit={submit}>
          <fieldset className="sa-task-stack">
            <legend>{say("Assignments to return", "打回的子任务")}</legend>
            {task.subtasks.map((item) => (
              <label className="sa-task-check" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
                  }
                />
                {name(item.memberId)} · {item.description}
              </label>
            ))}
          </fieldset>
          <label className="sa-field">
            <span>{say("Reason", "打回原因")}</span>
            <textarea
              rows={3}
              required
              maxLength={8000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button type="submit" className="sa-button sa-secondary" disabled={busy || !selected.length || !note.trim()}>
            {say("Send back to workers", "交回成员修改")}
          </button>
        </form>
      )}
    </section>
  );
}

export function SuperAgentTasksPage({
  room,
  zh,
  onArtifact,
}: {
  room: SuperAgentRoom;
  zh: boolean;
  onArtifact: (name: string, artifact: SuperAgentTaskArtifact, opener: HTMLButtonElement) => void;
}) {
  const say: Say = (en, cn) => (zh ? cn : en);
  const language = zh ? "zh-CN" : "en";
  const label = (status: keyof typeof statusLabels) => say(...statusLabels[status]);
  const name = (id: string) => room.members.find((item) => item.id === id)?.name ?? id;
  const [list, setList] = useState<SuperAgentTaskInfo[]>();
  const [selected, setSelected] = useState<string>();
  const [task, setTask] = useState<SuperAgentTask>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const report = useCallback(
    (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let request = 0;
    const refresh = () => {
      const sequence = ++request;
      void call("superagent.tasks.list", { roomId: room.id })
        .then((items) => {
          if (disposed || sequence !== request) return;
          setList(items);
          setSelected((id) => id ?? items[0]?.id);
        })
        .catch((reason) => {
          if (!disposed) report(reason);
        });
      if (selected) {
        void call("superagent.tasks.get", { id: selected })
          .then((next) => {
            if (!disposed && sequence === request) {
              setTask((current) => (current?.id === next.id && current.revision > next.revision ? current : next));
            }
          })
          .catch((reason) => {
            if (!disposed) report(reason);
          });
      }
    };
    refresh();
    void subscribe("superagent.tasks.changed", "*", (event) => {
      if (event.roomId === room.id) refresh();
    })
      .then((off) => {
        if (disposed) off();
        else {
          unsubscribe = off;
          refresh();
        }
      })
      .catch((reason) => {
        if (!disposed) report(reason);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [report, room.id, selected]);

  const action: RunAction = async (operation) => {
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      if (next) {
        setTask((previous) => (previous?.id === next.id && previous.revision <= next.revision ? next : previous));
      }
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  const current = task?.id === selected ? task : undefined;
  const currentIds = new Set(
    current ? [current.planRunId, current.summaryRunId, ...current.subtasks.map((item) => item.runId)] : [],
  );
  function showDiff(run: SuperAgentTaskRun, opener: HTMLButtonElement) {
    if (!current) return;
    void action(async () => {
      const result = await call("superagent.tasks.artifact", { id: current.id, runId: run.id });
      if (opener.isConnected) onArtifact(name(run.memberId), result, opener);
    });
  }

  return (
    <div className="sa-form-scroll sa-tasks">
      <div className="sa-form-shell sa-task-shell sa-task-stack">
        <header className="sa-page-heading">
          <div>
            <h2>{room.title}</h2>
            <p title={room.project}>{room.project}</p>
          </div>
          <button
            type="button"
            className="sa-button sa-secondary"
            disabled={!list || list.some((item) => !finished(item)) || busy}
            onClick={() => setCreating(true)}
          >
            <Plus size={16} aria-hidden="true" /> {say("New task", "新建任务")}
          </button>
        </header>
        {error && (
          <p role="alert" className="sa-task-error">
            {error}
          </p>
        )}
        <details className="sa-task-card">
          <summary>
            {say("Team", "小队")} · {say("Lead", "队长")} {name(room.team?.leaderId ?? "")}
          </summary>
          <ul className="sa-task-roster">
            {room.members.map((member) => (
              <li key={member.id}>
                <strong>{member.name}</strong>
                {room.team?.responsibilities[member.id] && <span>{room.team.responsibilities[member.id]}</span>}
              </li>
            ))}
          </ul>
          {room.team?.instructions && <p>{room.team.instructions}</p>}
        </details>
        {!!list?.length && (
          <label className="sa-field">
            <span>{say("Tasks", "任务列表")}</span>
            <select
              aria-label={say("Tasks", "任务列表")}
              value={selected ?? ""}
              onChange={(event) => {
                setSelected(event.target.value);
                setCreating(false);
              }}
            >
              {list.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title} · {label(item.status)}
                </option>
              ))}
            </select>
          </label>
        )}
        {list && (creating || !list.length) ? (
          <TaskEditor
            roomId={room.id}
            say={say}
            busy={busy}
            cancel={list.length ? () => setCreating(false) : undefined}
            create={(draft) =>
              void action(async () => {
                const next = await call("superagent.tasks.create", draft);
                setList((items) => (items?.some((item) => item.id === next.id) ? items : [next, ...(items ?? [])]));
                setSelected(next.id);
                setTask(next);
                setCreating(false);
              })
            }
          />
        ) : current ? (
          <>
            <section className="sa-task-card sa-task-stack" data-task-status={current.status}>
              <div className="sa-task-heading">
                <h3>
                  <ClipboardList size={18} aria-hidden="true" /> {current.title}
                </h3>
                <span role="status" className="sa-task-status">
                  {label(current.status)}
                </span>
              </div>
              <p>{current.goal}</p>
              <div>
                <strong>{say("Acceptance criteria", "验收条件")}</strong>
                <p>{current.criteria}</p>
              </div>
              {current.base && (
                <small>
                  Git · <code title={current.base}>{current.base.slice(0, 12)}</code>
                </small>
              )}
              <div className="sa-task-actions">
                {["queued", "running", "waiting"].includes(current.status) && (
                  <button
                    type="button"
                    className="sa-button sa-secondary"
                    disabled={busy}
                    onClick={() => void action(() => call("superagent.tasks.pause", { id: current.id }))}
                  >
                    {say("Pause task", "暂停任务")}
                  </button>
                )}
                {current.status === "paused" && (
                  <button
                    type="button"
                    className="sa-button sa-primary"
                    disabled={busy}
                    onClick={() => void action(() => call("superagent.tasks.resume", { id: current.id }))}
                  >
                    {say("Resume task", "继续任务")}
                  </button>
                )}
                {!finished(current) && (
                  <button
                    type="button"
                    className="sa-button sa-secondary"
                    disabled={busy}
                    onClick={() => void action(() => call("superagent.tasks.cancel", { id: current.id }))}
                  >
                    {say("Cancel task", "取消任务")}
                  </button>
                )}
              </div>
            </section>
            {!!current.overlaps.length && (
              <section className="sa-task-card sa-task-callout">
                <h3>{say("Paths changed by multiple members", "多个成员改动了相同路径")}</h3>
                <ul>
                  {current.overlaps.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {current.runs
              .filter((run) => currentIds.has(run.id))
              .map((run) => {
                const assignment = current.subtasks.find((item) => item.id === run.subtaskId);
                return (
                  <article
                    key={run.id}
                    className="sa-task-card sa-task-stack"
                    data-task-run={run.kind}
                    data-run-status={run.status}
                  >
                    <div className="sa-task-heading">
                      <h3>
                        {say(...stageLabels[run.kind])} · {name(run.memberId)}
                      </h3>
                      <span className="sa-task-status">{label(run.status)}</span>
                    </div>
                    {assignment && (
                      <div className="sa-task-stack">
                        <p>{assignment.description}</p>
                        <small>
                          {say("Acceptance criteria", "验收条件")} · {assignment.criteria}
                        </small>
                      </div>
                    )}
                    <RunDetails
                      run={run}
                      id={current.id}
                      say={say}
                      busy={busy}
                      action={action}
                      current={!finished(current) && current.status !== "paused"}
                      showDiff={(opener) => showDiff(run, opener)}
                    />
                  </article>
                );
              })}
            {current.status === "in_review" && (
              <ReviewActions
                key={current.summaryRunId}
                task={current}
                say={say}
                busy={busy}
                name={name}
                action={action}
              />
            )}
            <details className="sa-task-card">
              <summary>{say("Timeline and previous runs", "时间线与历史运行")}</summary>
              <ol className="sa-task-timeline">
                {current.timeline.map((event, index) => {
                  const run = current.runs.find((item) => item.id === event.runId);
                  return (
                    <li key={index}>
                      <time dateTime={new Date(event.at).toISOString()}>
                        {new Date(event.at).toLocaleTimeString(language)}
                      </time>
                      <span>
                        {say(...eventLabels[event.kind])}
                        {run ? ` · ${name(run.memberId)}` : ""}
                        {event.text
                          ? ` · ${event.kind === "settled" ? label(event.text as SuperAgentTaskRunStatus) : event.text}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {current.runs
                .filter((run) => !currentIds.has(run.id))
                .map((run) => (
                  <details key={run.id} className="sa-task-previous">
                    <summary>
                      {name(run.memberId)} · {say(...stageLabels[run.kind])} · {label(run.status)}
                    </summary>
                    <RunDetails
                      run={run}
                      id={current.id}
                      say={say}
                      busy={busy}
                      action={action}
                      current={false}
                      showDiff={(opener) => showDiff(run, opener)}
                    />
                  </details>
                ))}
            </details>
          </>
        ) : (
          <p role="status">{say("Loading tasks…", "正在加载任务…")}</p>
        )}
      </div>
    </div>
  );
}
