import { ArrowRight, Check, FolderOpen, GitBranch } from "lucide-react";
import type { FormEvent } from "react";
import type { SuperAgentCreateRoom, SuperAgentRole } from "@contract/superagent";
import { RuntimeIcon, cliNames } from "./SuperAgentRuntimeIcon";
import { SuperAgentSelect } from "./SuperAgentSelect";

export interface RoomFormDraft {
  title: string;
  selected: string[];
  starter: string;
  summarizer: string;
  taskMode: boolean;
  teamInstructions: string;
  responsibilities: Record<string, string>;
}

export function SuperAgentRoomForm({
  zh,
  project,
  roles,
  draft,
  busy,
  onChange,
  onChooseProject,
  onRoles,
  onCreate,
}: {
  zh: boolean;
  project: string;
  roles: SuperAgentRole[];
  draft: RoomFormDraft;
  busy: boolean;
  onChange: (draft: RoomFormDraft) => void;
  onChooseProject: () => void;
  onRoles: () => void;
  onCreate: (draft: SuperAgentCreateRoom) => void;
}) {
  const say = (en: string, cn: string) => (zh ? cn : en);
  const { title, selected, starter, summarizer, taskMode, teamInstructions, responsibilities } = draft;
  const selectedOptions = roles
    .filter((item) => selected.includes(item.id))
    .map((item) => ({
      label: item.name,
      value: item.id,
      icon: <RuntimeIcon cli={item.cli} size={13} />,
      detail: cliNames[item.cli],
    }));

  function toggleMember(id: string) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    onChange({
      ...draft,
      selected: next,
      starter: next.includes(starter) ? starter : (next[0] ?? ""),
      summarizer: next.includes(summarizer) ? summarizer : (next.at(-1) ?? ""),
    });
  }

  function create(event: FormEvent) {
    event.preventDefault();
    const room = { title, project, roleIds: selected };
    if (taskMode) {
      onCreate({
        ...room,
        mode: "tasks",
        team: {
          leaderId: starter,
          instructions: teamInstructions,
          responsibilities: Object.fromEntries(selected.map((id) => [id, responsibilities[id] ?? ""])),
        },
      });
    } else {
      onCreate({ ...room, starterId: starter, summarizerId: summarizer });
    }
  }

  return (
    <div className="sa-form-scroll">
      <div className="sa-form-shell sa-create-shell">
        <header className="sa-page-heading" data-sa-enter>
          <div>
            <h2>{say("New room", "新建群聊")}</h2>
            <p>{say("Choose a project folder and the roles that will work on it", "选择项目目录和参与协作的角色")}</p>
          </div>
        </header>
        <form className="sa-create-form" onSubmit={create}>
          <section className="sa-card" data-sa-enter>
            <div className="sa-card-heading">
              <h3>{say("Project", "项目")}</h3>
            </div>
            <label className="sa-field">
              <span>{say("Room name", "群聊名称")}</span>
              <input
                maxLength={120}
                required
                value={title}
                placeholder={say("e.g. Desktop release review", "例如：桌面版发布评审")}
                onChange={(event) => onChange({ ...draft, title: event.target.value })}
              />
            </label>
            <div className="sa-field">
              <span>{say("Room mode", "协作模式")}</span>
              <SuperAgentSelect
                label={say("Room mode", "协作模式")}
                value={taskMode ? "tasks" : "chat"}
                options={[
                  { value: "chat", label: say("Group chat", "群聊") },
                  { value: "tasks", label: say("Task collaboration", "任务协作") },
                ]}
                onChange={(value) => onChange({ ...draft, taskMode: value === "tasks" })}
              />
            </div>
            <div className="sa-project-field">
              <div className="sa-project-label">
                <FolderOpen size={17} aria-hidden="true" />
                <span title={project}>{project || say("No project selected", "尚未选择项目")}</span>
              </div>
              <button type="button" className="sa-button sa-secondary" onClick={onChooseProject}>
                {say("Choose folder", "选择目录")}
              </button>
            </div>
          </section>
          <section className="sa-card" data-sa-enter>
            <div className="sa-card-heading">
              <h3>{say("Members", "成员")}</h3>
              <span>{selected.length} / 8</span>
            </div>
            {roles.length < 2 && (
              <button type="button" className="sa-button sa-secondary sa-configure-link" onClick={onRoles}>
                {say("Create at least two roles", "先配置至少两个角色")}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
            <div className="sa-member-options">
              {roles.map((item) => (
                <label className="sa-check sa-member-option" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    disabled={selected.length >= 8 && !selected.includes(item.id)}
                    onChange={() => toggleMember(item.id)}
                  />
                  <RuntimeIcon cli={item.cli} size={17} />
                  <span className="sa-member-option-label">
                    <strong>{item.name}</strong>
                    <small>{cliNames[item.cli]}</small>
                  </span>
                  <span className="sa-checkbox" aria-hidden="true">
                    <Check size={12} strokeWidth={2.5} />
                  </span>
                </label>
              ))}
            </div>
            <div className="sa-field-grid">
              <div className="sa-field">
                <span>{taskMode ? say("Team lead", "队长") : say("Starts the task", "首位发言人")}</span>
                <SuperAgentSelect
                  label={taskMode ? say("Team lead", "队长") : say("Starts the task", "首位发言人")}
                  value={starter}
                  options={selectedOptions}
                  onChange={(value) => onChange({ ...draft, starter: value })}
                  placeholder={say("Select a role", "选择角色")}
                />
              </div>
              {!taskMode && (
                <div className="sa-field">
                  <span>{say("Summarizes the task", "总结人")}</span>
                  <SuperAgentSelect
                    label={say("Summarizes the task", "总结人")}
                    value={summarizer}
                    options={selectedOptions}
                    onChange={(value) => onChange({ ...draft, summarizer: value })}
                    placeholder={say("Select a role", "选择角色")}
                  />
                </div>
              )}
            </div>
            {taskMode && (
              <div className="sa-task-stack">
                <label className="sa-field">
                  <span>{say("Team instructions", "小队指令")}</span>
                  <textarea
                    rows={3}
                    maxLength={8000}
                    value={teamInstructions}
                    onChange={(event) => onChange({ ...draft, teamInstructions: event.target.value })}
                  />
                </label>
                {roles
                  .filter((item) => selected.includes(item.id))
                  .map((item) => (
                    <label className="sa-field" key={item.id}>
                      <span>
                        {item.name} · {say("Responsibility", "职责")}
                      </span>
                      <input
                        maxLength={2000}
                        value={responsibilities[item.id] ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            responsibilities: { ...responsibilities, [item.id]: event.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            )}
          </section>
          <div className="sa-form-actions sa-create-footer" data-sa-enter>
            <small>
              <GitBranch size={15} aria-hidden="true" />
              {say(
                "Roles use Git worktrees when a commit exists, or folder copies that skip symbolic links.",
                "已有提交的项目使用 worktree，其余目录使用独立副本并跳过符号链接。",
              )}
            </small>
            <button type="submit" className="sa-button sa-primary" disabled={busy || !project || selected.length < 2}>
              {busy ? say("Creating…", "正在创建…") : say("Create room", "创建群聊")}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
