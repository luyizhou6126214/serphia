import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Cable,
  Check,
  CircleAlert,
  FileDiff,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  MessageSquare,
  PanelRight,
  Play,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  UserRound,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  SUPERAGENT_CLIS,
  type SuperAgentCli,
  type SuperAgentCreateRoom,
  type SuperAgentRole,
  type SuperAgentRoom,
  type SuperAgentRoomInfo,
  type SuperAgentRuntime,
} from "@contract/superagent";
import type { SkillRecord } from "@shared/api-types";
import { useI18n } from "@/i18n";
import { call, subscribe } from "@/lib/api-client";
import { MarkdownBody } from "../MarkdownBody";
import { ArtifactDialog, type ArtifactPreview } from "./SuperAgentArtifactDialog";
import { SuperAgentRoomForm, type RoomFormDraft } from "./SuperAgentRoomForm";
import { RuntimeIcon, cliNames } from "./SuperAgentRuntimeIcon";
import { SuperAgentTerminal } from "./SuperAgentTerminal";
import { SuperAgentSelect } from "./SuperAgentSelect";
import { SuperAgentTasksPage } from "./SuperAgentTasksPage";
import { useSuperAgentEntrance } from "./useSuperAgentMotion";
import "./SuperAgentPage.css";
import "./SuperAgentConversation.css";

type Pane = "chat" | "new" | "roles";
type RoleDraft = Omit<SuperAgentRole, "id"> & { id?: string };
const blankRole = (): RoleDraft => ({ name: "", instructions: "", cli: "claude", skillPaths: [] });

function Status({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span className="sa-status" data-state={state}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

function projectName(path: string) {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function SuperAgentPage({ cwd }: { cwd?: string | null }) {
  const { language } = useI18n();
  const zh = language.startsWith("zh");
  const say = (en: string, cn: string) => (zh ? cn : en);
  const statusLabels = zh
    ? {
        idle: "待开始",
        running: "进行中",
        question: "等待回复",
        approval: "等待授权",
        stopped: "已停止",
        done: "已完成",
        error: "出错",
        missing: "未安装",
        detected: "已检测",
        ready: "连接正常",
      }
    : {
        idle: "Idle",
        running: "Running",
        question: "Waiting for reply",
        approval: "Waiting for approval",
        stopped: "Stopped",
        done: "Done",
        error: "Error",
        missing: "Missing",
        detected: "Detected",
        ready: "Ready",
      };
  const [pane, setPane] = useState<Pane>("chat");
  const [rooms, setRooms] = useState<SuperAgentRoomInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [roles, setRoles] = useState<SuperAgentRole[]>([]);
  const [runtimes, setRuntimes] = useState<SuperAgentRuntime[]>([]);
  const [roomId, setRoomId] = useState<string>();
  const [room, setRoom] = useState<SuperAgentRoom>();
  const [role, setRole] = useState<RoleDraft>(blankRole);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [project, setProject] = useState(cwd ?? "");
  const [roomDraft, setRoomDraft] = useState<RoomFormDraft>({
    title: "",
    selected: [],
    starter: "",
    summarizer: "",
    taskMode: false,
    teamInstructions: "",
    responsibilities: {},
  });
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState<SuperAgentCli>();
  const [error, setError] = useState("");
  const [artifact, setArtifact] = useState<ArtifactPreview>();
  const [terminalPane, setTerminalPane] = useState<string>();
  const [compact, setCompact] = useState(false);
  const [inspectorOverride, setInspectorOverride] = useState<boolean>();
  const [memberToFocus, setMemberToFocus] = useState<string>();
  const showInspector = inspectorOverride ?? !compact;
  const inspectorId = useId();
  const shell = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const latestMessage = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);
  const followTail = useRef(true);

  useLayoutEffect(() => {
    const root = shell.current;
    if (!root) return;
    const measure = () => setCompact(root.clientWidth < 1080);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!showInspector || !memberToFocus) return;
    const member = inspector.current?.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(memberToFocus)}"]`);
    member?.focus({ preventScroll: true });
    member?.scrollIntoView({ block: "nearest", inline: "nearest" });
    setMemberToFocus(undefined);
  }, [memberToFocus, showInspector]);

  const report = useCallback(
    (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    [],
  );
  const refreshLists = useCallback(async () => {
    const [nextRooms, nextRoles] = await Promise.all([call("superagent.rooms.list"), call("superagent.roles.list")]);
    setRooms(nextRooms);
    setRoles(nextRoles);
    setRoomId((id) => id ?? nextRooms[0]?.id);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | undefined;
    const refresh = () => {
      if (alive) void refreshLists().catch(report);
    };
    refresh();
    void call("superagent.runtimes", {}).then((result) => {
      if (alive) setRuntimes(result);
    }, report);
    void subscribe("superagent.changed", "*", refresh).then((off) => {
      if (alive) {
        dispose = off;
        refresh();
      } else off();
    }, report);
    return () => {
      alive = false;
      dispose?.();
    };
  }, [refreshLists, report]);

  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    let sequence = 0;
    let dispose: (() => void) | undefined;
    const refresh = () => {
      const request = ++sequence;
      void call("superagent.rooms.get", { id: roomId }).then(
        (result) => {
          if (alive && request === sequence) setRoom(result);
        },
        (reason) => {
          if (alive && request === sequence) report(reason);
        },
      );
    };
    refresh();
    void subscribe("superagent.changed", "*", (event) => {
      if (event.roomId === roomId) refresh();
    }).then((off) => {
      if (alive) {
        dispose = off;
        refresh();
      } else off();
    }, report);
    return () => {
      alive = false;
      dispose?.();
    };
  }, [roomId, report]);

  useEffect(() => {
    if (pane !== "roles" || !project) return;
    let alive = true;
    void call("skills.list", { cwd: project }).then((result) => {
      if (alive) setSkills(result.skills);
    }, report);
    return () => {
      alive = false;
    };
  }, [pane, project, report]);

  const activeRoom = room?.id === roomId ? room : undefined;
  const lastMessage = activeRoom?.messages.at(-1)?.id;
  useSuperAgentEntrance(main, pane === "chat" ? (activeRoom?.id ?? (loaded ? "empty" : undefined)) : pane, "view");
  useSuperAgentEntrance(latestMessage, pane === "chat" ? lastMessage : undefined, "message");
  useEffect(() => {
    if (messageList.current && followTail.current) messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [lastMessage, pane]);

  function scrollToLatest() {
    followTail.current = true;
    setFollowing(true);
    const messages = messageList.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }

  function selectPane(next: Pane) {
    setError("");
    setArtifact(undefined);
    setTerminalPane(undefined);
    setMemberToFocus(undefined);
    setPane(next);
  }

  function revealMember(id: string) {
    setInspectorOverride(true);
    setMemberToFocus(id);
  }

  async function chooseProject() {
    const directory = await window.piBridge?.selectDirectory();
    if (!directory) return;
    await call("system.allowRoot", { path: directory });
    setProject(directory);
    setSkills([]);
  }

  function create(room: SuperAgentCreateRoom) {
    void act(async () => {
      const next = await call("superagent.rooms.create", room);
      setRoomId(next.id);
      setRoom(next);
      setRoomDraft((draft) => ({ ...draft, title: "", teamInstructions: "", responsibilities: {} }));
      setDraft("");
      setTarget("");
      scrollToLatest();
      setPane("chat");
      await refreshLists();
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!activeRoom || !draft.trim()) return;
    void act(async () => {
      setRoom(
        await call("superagent.rooms.send", {
          id: activeRoom.id,
          text: draft,
          targetId: activeRoom.status === "question" ? undefined : target || undefined,
        }),
      );
      setDraft("");
      scrollToLatest();
    });
  }

  const memberName = (id: string) => activeRoom?.members.find((member) => member.id === id)?.name ?? id;
  const running = activeRoom && ["running", "question", "approval"].includes(activeRoom.status);
  const handedOff = activeRoom?.members.some((member) => member.paneId);

  const memberOptions = (activeRoom?.members ?? []).map((member) => ({
    label: member.name,
    value: member.id,
    icon: <RuntimeIcon cli={member.cli} size={13} />,
    detail: cliNames[member.cli],
  }));
  const skillOptions = [
    ...new Map([
      ...skills.map((skill) => [skill.filePath, skill.name] as const),
      ...role.skillPaths
        .filter((file) => !skills.some((skill) => skill.filePath === file))
        .map((file) => [file, projectName(file.replace(/[\\/]SKILL\.md$/iu, ""))] as const),
    ]),
  ];
  const permission = activeRoom?.approval;
  const permissionMode = activeRoom?.permissionMode ?? "ask";
  const permissionOptions = [
    {
      value: "ask",
      label: say("Ask for approval", "请求批准"),
      detail: say("Ask whenever a CLI requests approval", "收到 CLI 的权限请求时逐次确认"),
      icon: <LockKeyhole size={16} aria-hidden="true" />,
    },
    {
      value: "workspaceEdits",
      label: say("Allow local edits", "允许目录内编辑"),
      detail: say(
        "Approve file edits in each role’s folder for this task",
        "当前任务内，自动批准各角色编辑自己的工作目录",
      ),
      icon: <ShieldCheck size={16} aria-hidden="true" />,
    },
  ];

  return (
    <section className="superagent" ref={shell} aria-label="SuperAgent">
      <aside className="superagent-sidebar">
        <div className="sa-brand">
          <span className="sa-mark">
            <Workflow size={21} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <h1>SuperAgent</h1>
        </div>
        <div className="sa-sidebar-actions">
          <button
            type="button"
            onClick={() => selectPane("new")}
            className="sa-button sa-new-room"
            aria-current={pane === "new" ? "page" : undefined}
          >
            <Plus size={17} aria-hidden="true" />
            {say("New room", "新建群聊")}
          </button>
          <button
            type="button"
            className="sa-button sa-nav-button"
            onClick={() => selectPane("roles")}
            aria-pressed={pane === "roles"}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            {say("Roles and runtimes", "角色与运行环境")}
          </button>
        </div>
        <nav className="sa-room-nav" aria-label={say("Rooms", "群聊列表")}>
          <h2>{say("Rooms", "群聊")}</h2>
          {rooms.map((item) => (
            <button
              type="button"
              key={item.id}
              className="sa-room-link"
              aria-current={item.id === roomId && pane === "chat" ? "page" : undefined}
              onClick={() => {
                if (item.id === roomId && pane === "chat") return;
                if (item.id !== roomId) {
                  setRoomId(item.id);
                  setTarget("");
                  setDraft("");
                  scrollToLatest();
                }
                selectPane("chat");
              }}
            >
              {item.mode === "tasks" ? (
                <Workflow size={16} aria-hidden="true" />
              ) : (
                <MessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />
              )}
              <span className="sa-room-link-copy">
                <strong title={item.title}>{item.title}</strong>
                <small>{projectName(item.project)}</small>
              </span>
              {item.mode !== "tasks" && (
                <i
                  className="sa-status-dot"
                  data-state={item.status}
                  title={statusLabels[item.status]}
                  aria-label={statusLabels[item.status]}
                />
              )}
            </button>
          ))}
          {loaded && !rooms.length && <p className="sa-nav-empty">{say("No rooms yet", "暂无群聊")}</p>}
        </nav>
      </aside>
      <div className="superagent-main" ref={main}>
        {error && (
          <div className="sa-error-strip" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
            <button
              type="button"
              className="sa-icon-button"
              title={say("Dismiss", "关闭提示")}
              aria-label={say("Dismiss", "关闭提示")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {pane === "roles" && (
          <div className="sa-form-scroll">
            <div className="sa-form-shell">
              <header className="sa-page-heading" data-sa-enter>
                <div>
                  <h2>{say("Roles and runtimes", "角色与运行环境")}</h2>
                  <p>{say("Local CLIs, role instructions, and skills", "管理本机 CLI、角色职责与技能")}</p>
                </div>
              </header>
              <section
                className="sa-runtime-grid"
                aria-label={say("Installed runtimes", "已安装的运行环境")}
                data-sa-enter
              >
                {SUPERAGENT_CLIS.map((cli) => {
                  const runtime = runtimes.find((item) => item.cli === cli);
                  return (
                    <div key={cli} className="sa-runtime-card">
                      <div className="sa-runtime-heading">
                        <RuntimeIcon cli={cli} size={21} />
                        <div>
                          <strong>{cliNames[cli]}</strong>
                          <Status state={runtime?.state ?? "idle"}>
                            {runtime ? statusLabels[runtime.state] : say("Detecting…", "正在检测…")}
                          </Status>
                        </div>
                      </div>
                      {runtime?.detail && <small className="sa-runtime-error">{runtime.detail}</small>}
                      <button
                        type="button"
                        className="sa-button sa-runtime-test"
                        disabled={busy || !runtime || runtime.state === "missing"}
                        onClick={() =>
                          void act(async () => {
                            setProbing(cli);
                            try {
                              setRuntimes(await call("superagent.runtimes", { probe: cli }));
                            } finally {
                              setProbing(undefined);
                            }
                          })
                        }
                      >
                        <Cable size={14} aria-hidden="true" />
                        {probing === cli ? say("Testing…", "正在测试…") : say("Test connection", "测试连接")}
                      </button>
                    </div>
                  );
                })}
              </section>
              <div className="sa-role-layout" data-sa-enter>
                <section className="sa-card sa-role-library" aria-label={say("Role templates", "角色模板")}>
                  <div className="sa-card-heading">
                    <h3>{say("Role templates", "角色模板")}</h3>
                    <span>{roles.length}</span>
                  </div>
                  {roles.map((item) => (
                    <button
                      className="sa-template"
                      key={item.id}
                      type="button"
                      aria-pressed={role.id === item.id}
                      onClick={() => setRole(item)}
                    >
                      <RuntimeIcon cli={item.cli} size={15} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{cliNames[item.cli]}</small>
                      </span>
                    </button>
                  ))}
                  <button type="button" className="sa-button sa-new-template" onClick={() => setRole(blankRole())}>
                    <Plus size={15} aria-hidden="true" />
                    {say("New role", "新建角色")}
                  </button>
                </section>
                <form
                  className="sa-card sa-role-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      setRole(await call("superagent.roles.save", role));
                      await refreshLists();
                    });
                  }}
                >
                  <div className="sa-card-heading">
                    <h3>{role.id ? say("Edit role", "编辑角色") : say("New role", "新建角色")}</h3>
                  </div>
                  <div className="sa-field-grid">
                    <label className="sa-field">
                      <span>{say("Role name", "角色名称")}</span>
                      <input
                        required
                        maxLength={80}
                        value={role.name}
                        placeholder={say("e.g. Code reviewer", "例如：代码评审")}
                        onChange={(event) => setRole({ ...role, name: event.target.value })}
                      />
                    </label>
                    <div className="sa-field">
                      <span>{say("Runtime", "运行环境")}</span>
                      <SuperAgentSelect
                        label={say("Runtime", "运行环境")}
                        value={role.cli}
                        options={SUPERAGENT_CLIS.map((cli) => ({
                          label: cliNames[cli],
                          value: cli,
                          icon: <RuntimeIcon cli={cli} size={15} />,
                        }))}
                        onChange={(cli) => setRole({ ...role, cli: cli as SuperAgentCli })}
                      />
                    </div>
                  </div>
                  <label className="sa-field">
                    <span>{say("Responsibilities", "角色职责")}</span>
                    <textarea
                      required
                      rows={4}
                      maxLength={8_000}
                      value={role.instructions}
                      placeholder={say(
                        "Describe what this role should do and how to hand off its work.",
                        "描述这个角色负责什么、如何把结果交给下一位。",
                      )}
                      onChange={(event) => setRole({ ...role, instructions: event.target.value })}
                    />
                  </label>
                  <fieldset className="sa-skill-field">
                    <legend>{say("Skills", "技能")}</legend>
                    <div className="sa-project-field">
                      <div className="sa-project-label">
                        <FolderOpen size={16} aria-hidden="true" />
                        <span title={project}>{project ? projectName(project) : say("Skill source", "技能来源")}</span>
                      </div>
                      <button type="button" className="sa-button sa-quiet" onClick={() => void act(chooseProject)}>
                        {say("Choose project", "选择项目")}
                      </button>
                    </div>
                    {skillOptions.length > 0 ? (
                      <div className="sa-skill-list">
                        {skillOptions.map(([file, name]) => (
                          <label key={file} className="sa-check sa-skill" title={file}>
                            <input
                              type="checkbox"
                              checked={role.skillPaths.includes(file)}
                              disabled={role.skillPaths.length >= 8 && !role.skillPaths.includes(file)}
                              onChange={(event) =>
                                setRole({
                                  ...role,
                                  skillPaths: event.target.checked
                                    ? [...role.skillPaths, file]
                                    : role.skillPaths.filter((item) => item !== file),
                                })
                              }
                            />
                            <span className="sa-checkbox" aria-hidden="true">
                              <Check size={12} strokeWidth={2.5} />
                            </span>
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="sa-field-hint">
                        {project
                          ? say("No skills found in this project.", "当前项目没有可选技能。")
                          : say("Choose a project to load its skills.", "选择项目后加载技能。")}
                      </p>
                    )}
                    {skillOptions.length > 0 && (
                      <p className="sa-field-hint">
                        {say("Only skill instructions are added to the role.", "角色只会载入技能说明。")}
                      </p>
                    )}
                  </fieldset>
                  <div className="sa-form-actions">
                    {role.id && (
                      <button
                        type="button"
                        className="sa-button sa-destructive"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await call("superagent.roles.delete", { id: role.id! });
                            setRole(blankRole());
                            await refreshLists();
                          })
                        }
                      >
                        {say("Delete template", "删除模板")}
                      </button>
                    )}
                    <button type="submit" disabled={busy} className="sa-button sa-primary">
                      <Check size={16} aria-hidden="true" />
                      {say("Save role", "保存角色")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
        {pane === "new" && (
          <SuperAgentRoomForm
            zh={zh}
            draft={roomDraft}
            project={project}
            roles={roles}
            busy={busy}
            onChange={setRoomDraft}
            onChooseProject={() => void act(chooseProject)}
            onRoles={() => selectPane("roles")}
            onCreate={create}
          />
        )}
        {pane === "chat" && !activeRoom && (
          <div className="superagent-empty" data-sa-enter>
            {loaded && !roomId ? (
              <div className="sa-empty-content">
                <span className="sa-empty-mark">
                  <Workflow size={32} strokeWidth={1.55} aria-hidden="true" />
                </span>
                <h2>{say("No rooms yet", "暂无群聊")}</h2>
                <p>
                  {say(
                    "Create a room, choose the roles, and give your team a task.",
                    "创建群聊，选择角色，在同一个项目里分工接力。",
                  )}
                </p>
                <button type="button" className="sa-button sa-primary" onClick={() => selectPane("new")}>
                  <Plus size={16} aria-hidden="true" />
                  {say("New room", "新建群聊")}
                </button>
              </div>
            ) : (
              <p role="status" className="sa-field-hint">
                {say("Loading room…", "正在加载群聊…")}
              </p>
            )}
          </div>
        )}
        {pane === "chat" && activeRoom?.mode === "tasks" && (
          <SuperAgentTasksPage
            key={activeRoom.id}
            room={activeRoom}
            zh={zh}
            onArtifact={(name, data, opener) => setArtifact({ name, data, opener })}
          />
        )}
        {pane === "chat" && activeRoom && activeRoom.mode !== "tasks" && (
          <>
            <header className="superagent-room-header" data-sa-enter>
              <div className="sa-room-title">
                <small title={activeRoom.project}>
                  {activeRoom.base ? (
                    <GitBranch size={13} aria-hidden="true" />
                  ) : (
                    <FolderOpen size={13} aria-hidden="true" />
                  )}
                  {projectName(activeRoom.project)}
                </small>
                <h2 title={activeRoom.title}>{activeRoom.title}</h2>
              </div>
              <div className="superagent-actions sa-room-actions">
                <span role="status" className="sa-room-status">
                  <Status state={activeRoom.status}>{statusLabels[activeRoom.status]}</Status>
                  {!showInspector && activeRoom.activeMemberId && (
                    <small>{memberName(activeRoom.activeMemberId)}</small>
                  )}
                </span>
                {running && (
                  <button
                    type="button"
                    className="sa-button sa-secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => setRoom(await call("superagent.rooms.stop", { id: activeRoom.id })))
                    }
                  >
                    <Square size={13} aria-hidden="true" />
                    {say("Stop", "停止")}
                  </button>
                )}
                {["stopped", "error"].includes(activeRoom.status) && (
                  <button
                    type="button"
                    className="sa-button sa-secondary"
                    disabled={busy || handedOff}
                    onClick={() =>
                      void act(async () => setRoom(await call("superagent.rooms.resume", { id: activeRoom.id })))
                    }
                  >
                    <Play size={14} aria-hidden="true" />
                    {say("Continue", "继续")}
                  </button>
                )}
                <button
                  type="button"
                  ref={inspectorToggle}
                  className="sa-icon-button sa-inspector-toggle"
                  aria-label={say("Members and working folders", "成员与工作目录")}
                  title={say("Members and working folders", "成员与工作目录")}
                  aria-expanded={showInspector}
                  aria-controls={inspectorId}
                  onClick={() => setInspectorOverride(!showInspector)}
                >
                  <PanelRight size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="sa-room-workspace" data-compact={compact || undefined}>
              <div className="sa-room-feed" inert={compact && showInspector}>
                {" "}
                {terminalPane && <SuperAgentTerminal key={terminalPane} paneId={terminalPane} />}
                <div
                  className="superagent-messages"
                  ref={messageList}
                  role="log"
                  aria-label={say("Room messages", "群聊消息")}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    const nearTail = node.scrollHeight - node.clientHeight - node.scrollTop < 88;
                    followTail.current = nearTail;
                    setFollowing(nearTail);
                  }}
                >
                  <div className="sa-message-stream">
                    {activeRoom.messages.length === 0 && (
                      <div className="sa-empty-chat">
                        <MessageSquare size={25} strokeWidth={1.65} aria-hidden="true" />
                        <h3>{say("Start the conversation", "开始群聊")}</h3>
                        <p>{say("Send the team a task to get started.", "发一条任务消息，让角色开始接力。")}</p>
                      </div>
                    )}
                    {activeRoom.messages.map((message) => {
                      const member = activeRoom.members.find((item) => item.id === message.author);
                      const isUser = message.author === "user";
                      const isSystem = message.author === "system";
                      const kind = isUser
                        ? "is-user"
                        : isSystem
                          ? "is-system"
                          : message.summary
                            ? "is-summary"
                            : "is-agent";
                      return (
                        <article
                          key={message.id}
                          className={"superagent-message " + kind}
                          ref={message.id === lastMessage ? latestMessage : undefined}
                        >
                          {member && <RuntimeIcon cli={member.cli} />}
                          {isUser && (
                            <span className="sa-user-icon">
                              <UserRound size={16} strokeWidth={1.5} aria-hidden="true" />
                            </span>
                          )}
                          <div className="sa-message-body">
                            <header>
                              <strong>
                                {isUser
                                  ? say("You", "你")
                                  : isSystem
                                    ? say("System", "系统")
                                    : memberName(message.author)}
                              </strong>
                              {message.summary && <span className="sa-summary-tag">{say("Summary", "总结")}</span>}
                              <time dateTime={new Date(message.at).toISOString()}>
                                {new Date(message.at).toLocaleTimeString(language, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </header>
                            <div className="sa-message-text">
                              <MarkdownBody variant="compact">{message.text}</MarkdownBody>
                            </div>
                            {!!message.to?.length && (
                              <div className="sa-message-recipient">
                                <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
                                <span>{say("Handed to", "交接给")}</span>
                                {message.to.map((id) => (
                                  <button key={id} type="button" onClick={() => revealMember(id)}>
                                    {memberName(id)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                {permission && (
                  <section className="sa-approval" aria-label={say("Permission request", "权限请求")}>
                    <div className="sa-approval-heading">
                      <span>
                        <LockKeyhole size={17} aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{permission.title}</strong>
                        <small>
                          {memberName(permission.memberId)} · {say("Permission request", "权限请求")}
                        </small>
                      </div>
                    </div>
                    {permission.detail && <pre>{permission.detail}</pre>}
                    <div className="superagent-actions">
                      {permission.options.map((option) => (
                        <button
                          type="button"
                          className={
                            "sa-button " +
                            (option.id === "allow" || /allow[_-]?once/i.test(option.id) ? "sa-primary" : "sa-secondary")
                          }
                          key={option.id}
                          disabled={busy}
                          onClick={() =>
                            void act(async () =>
                              setRoom(
                                await call("superagent.rooms.approval", {
                                  id: activeRoom.id,
                                  approvalId: permission.id,
                                  choice: option.id,
                                }),
                              ),
                            )
                          }
                        >
                          {option.id === "allow" || /allow[_-]?once/i.test(option.id)
                            ? say("Allow once", "允许一次")
                            : /^(?:deny|reject(?:[_-]?once)?)$/i.test(option.id)
                              ? say("Deny", "拒绝")
                              : option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <div className="sa-compose-dock">
                  {!following && (
                    <button type="button" className="sa-button sa-jump-latest" onClick={scrollToLatest}>
                      <ArrowDown size={14} aria-hidden="true" />
                      {say("Latest messages", "跳到最新消息")}
                    </button>
                  )}
                  <form className="superagent-composer" onSubmit={send}>
                    <textarea
                      aria-label={say("Message", "群消息")}
                      value={draft}
                      rows={2}
                      maxLength={16_000}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          (event.metaKey || event.ctrlKey) &&
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          if (!busy && draft.trim() && !permission && !handedOff)
                            event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder={
                        activeRoom.status === "question"
                          ? say("Reply to the agent’s question…", "回复角色的问题…")
                          : say("Describe a task or send a follow-up…", "描述一个任务，或继续讨论…")
                      }
                    />
                    <div className="sa-composer-toolbar">
                      <div className="sa-composer-controls">
                        <SuperAgentSelect
                          compact
                          label={say("Recipient", "接话对象")}
                          value={activeRoom.status === "question" ? "" : target}
                          disabled={activeRoom.status === "question"}
                          options={[
                            {
                              value: "",
                              label: say("Entire room", "全体成员"),
                              icon: <UsersRound size={16} aria-hidden="true" />,
                            },
                            ...memberOptions,
                          ]}
                          onChange={setTarget}
                        />
                        <SuperAgentSelect
                          compact
                          menuMinWidth={320}
                          label={say("Task permissions", "任务权限")}
                          value={permissionMode}
                          options={permissionOptions}
                          disabled={busy || handedOff}
                          onChange={(value) => {
                            if (value !== "ask" && value !== "workspaceEdits") return;
                            if (value === permissionMode) return;
                            void act(async () => {
                              setRoom(
                                await call("superagent.rooms.permissionMode", { id: activeRoom.id, mode: value }),
                              );
                            });
                          }}
                        />
                      </div>
                      <div className="superagent-actions">
                        <kbd aria-hidden="true">{/Mac/i.test(navigator.userAgent) ? "⌘" : "Ctrl"} ↵</kbd>
                        <button
                          type="submit"
                          className="sa-button sa-primary sa-send"
                          disabled={busy || !draft.trim() || !!permission || handedOff}
                        >
                          <ArrowUp size={17} strokeWidth={2.1} aria-hidden="true" />
                          {say("Send", "发送")}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
              <aside
                id={inspectorId}
                hidden={!showInspector}
                ref={inspector}
                className="superagent-members"
                aria-label={say("Members and working folders", "成员与工作目录")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setInspectorOverride(false);
                    inspectorToggle.current?.focus();
                  }
                }}
              >
                <header className="sa-inspector-heading">
                  <h3>
                    {say("Members", "成员")} <span>{activeRoom.members.length}</span>
                  </h3>
                  <code title={activeRoom.base ?? undefined}>
                    {activeRoom.base ? (
                      <>
                        <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />
                        {activeRoom.base.slice(0, 7)}
                      </>
                    ) : (
                      <>
                        <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
                        {say("Folder copies", "目录副本")}
                      </>
                    )}
                  </code>
                </header>
                <div className="sa-room-route" aria-label={say("Task routing", "任务接力")}>
                  <div>
                    <span>{say("Starts", "开场")}</span>
                    <button type="button" onClick={() => revealMember(activeRoom.starterId)}>
                      {memberName(activeRoom.starterId)}
                    </button>
                  </div>
                  <div>
                    <span>{say("Summarizes", "总结")}</span>
                    <button type="button" onClick={() => revealMember(activeRoom.summarizerId)}>
                      {memberName(activeRoom.summarizerId)}
                    </button>
                  </div>
                </div>
                <div className="sa-member-list">
                  {activeRoom.members.map((member) => (
                    <article
                      key={member.id}
                      className="superagent-member"
                      data-member-id={member.id}
                      data-active={activeRoom.activeMemberId === member.id || undefined}
                      tabIndex={-1}
                      aria-label={member.name}
                    >
                      <div className="sa-member-heading">
                        <RuntimeIcon cli={member.cli} size={17} />
                        <div className="sa-member-info">
                          <strong>{member.name}</strong>
                          <small>{cliNames[member.cli]}</small>
                        </div>
                        {activeRoom.activeMemberId === member.id && (
                          <span className="sa-current-label">{say("Current", "当前回合")}</span>
                        )}
                      </div>
                      <div className="sa-member-meta">
                        <code title={member.branch ?? member.cwd}>
                          {member.branch ? (
                            <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />
                          ) : (
                            <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
                          )}
                          <span>{member.branch ?? projectName(member.cwd)}</span>
                        </code>
                        {member.skills.length > 0 && (
                          <small>
                            {member.skills
                              .map(
                                (skill) =>
                                  skill.name + (skill.hasResources ? say(" (instructions only)", "（仅说明）") : ""),
                              )
                              .join(" · ")}
                          </small>
                        )}
                      </div>
                      <div className="superagent-actions">
                        <button
                          type="button"
                          className="sa-button sa-quiet"
                          title={member.cwd}
                          onClick={() => void act(() => window.piBridge.showItemInFolder(member.cwd))}
                        >
                          <FolderOpen size={15} aria-hidden="true" />
                          {say("Working folder", "工作目录")}
                        </button>
                        <button
                          type="button"
                          className="sa-button sa-quiet"
                          disabled={busy}
                          onClick={(event) => {
                            const opener = event.currentTarget;
                            void act(async () =>
                              setArtifact({
                                name: member.name,
                                opener,
                                data: await call("superagent.rooms.artifact", {
                                  id: activeRoom.id,
                                  memberId: member.id,
                                }),
                              }),
                            );
                          }}
                        >
                          <FileDiff size={15} aria-hidden="true" />
                          Diff
                        </button>
                        {member.nativeSessionId && member.cli !== "dsh" && !running && (
                          <>
                            <button
                              type="button"
                              className="sa-button sa-quiet"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  const updated = await call("superagent.rooms.handoff", {
                                    id: activeRoom.id,
                                    memberId: member.id,
                                  });
                                  setRoom(updated);
                                  if (compact) setInspectorOverride(false);
                                  setTerminalPane(updated.members.find((item) => item.id === member.id)?.paneId);
                                })
                              }
                            >
                              <Terminal size={15} aria-hidden="true" />
                              {say("Open in Herdr", "在 Herdr 中接管")}
                            </button>
                            {member.paneId && (
                              <button
                                type="button"
                                className="sa-button sa-quiet"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    if (terminalPane === member.paneId) setTerminalPane(undefined);
                                    setRoom(
                                      await call("superagent.rooms.handoff", {
                                        id: activeRoom.id,
                                        memberId: member.id,
                                        close: true,
                                      }),
                                    );
                                  })
                                }
                              >
                                {say("Close handoff", "结束接管")}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </aside>
            </div>
          </>
        )}
        {artifact && <ArtifactDialog artifact={artifact} zh={zh} onClose={() => setArtifact(undefined)} />}
      </div>
    </section>
  );
}
