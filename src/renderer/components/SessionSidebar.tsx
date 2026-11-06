import { DeleteOutlined, EditOutlined, EllipsisOutlined, PushpinOutlined, SearchOutlined } from "@ant-design/icons/es";
import { ProjectFolderIcon } from "./ProjectFolderIcon";
import { PROJECT_HOVER_CARD_WIDTH, ProjectHoverCard, type ProjectHoverCardState } from "./ProjectHoverCard";
import { call, subscribeRunning } from "@/lib/api-client";
import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { formatAbsoluteDateTime } from "@/lib/locale-format";
import {
  loadUnreadSessionIds as loadStoredUnreadSessionIds,
  saveUnreadSessionIds as saveStoredUnreadSessionIds,
} from "@/lib/unread-session-storage";
import { resolveInitialSessionRestore } from "@/lib/session-list";
import type { SessionListStore } from "@/lib/session-list-store";
import { worktreePathsEqual } from "@shared/worktree-path";
import { isDefaultSessionDirectory } from "@shared/session-workspace";
import { buildSessionTree, SessionTreeItem } from "./sidebar/SessionTree";
import { ProjectPicker } from "./sidebar/ProjectPicker";
import { SessionSearchDialog } from "./sidebar/SessionSearchDialog";
import { type SidebarWorkspace, getRecentProjects } from "@/hooks/useSidebarWorkspace";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  sessionList: SessionListStore;
  onSessionDeleted?: (sessionId: string) => void;
  workspace: SidebarWorkspace;
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return loadStoredUnreadSessionIds(window.localStorage);
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    saveStoredUnreadSessionIds(window.localStorage, ids);
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

export function SessionSidebar({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  sessionList,
  onSessionDeleted,
  workspace,
}: Props) {
  const { t, language } = useI18n();
  const {
    sessions: allSessions,
    loading,
    error: listError,
    runningSessionIds: fallbackRunningIds,
  } = useSyncExternalStore(sessionList.subscribe, sessionList.getSnapshot, sessionList.getSnapshot);
  const error =
    listError == null
      ? null
      : (listError instanceof Error ? listError.message : String(listError)) ||
        t("sessionListLoadFailed", "Failed to load sessions.");
  const { selectedCwd, setSelectedCwd, selectedProject, homeDir } = workspace;
  const [savedProjects, setSavedProjects] = useState<string[]>(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem("serphia:sidebar-projects") ?? "[]");
      return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string" && !!path) : [];
    } catch {
      return [];
    }
  });
  const [removedProjects, setRemovedProjects] = useState<string[]>(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem("serphia:removed-projects") ?? "[]");
      return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string" && !!path) : [];
    } catch {
      return [];
    }
  });
  const [projectExpansion, setProjectExpansion] = useState<Record<string, boolean>>({});
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem("serphia:pinned-projects") ?? "[]");
      return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [];
    } catch {
      return [];
    }
  });
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const deletingProjectRef = useRef(false);
  const [projectHoverCard, setProjectHoverCard] = useState<ProjectHoverCardState | null>(null);
  const projectHoverTimerRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const hideProjectHoverCard = useCallback(() => {
    if (projectHoverTimerRef.current !== null) {
      window.clearTimeout(projectHoverTimerRef.current);
      projectHoverTimerRef.current = null;
    }
    setProjectHoverCard(null);
  }, []);
  const scheduleProjectHoverCard = useCallback(
    (element: HTMLElement, project: { label: string; path: string; created: string | null }) => {
      if (projectHoverTimerRef.current !== null) window.clearTimeout(projectHoverTimerRef.current);
      projectHoverTimerRef.current = window.setTimeout(() => {
        projectHoverTimerRef.current = null;
        const rect = element.getBoundingClientRect();
        const left = Math.min(rect.right + 12, window.innerWidth - PROJECT_HOVER_CARD_WIDTH - 12);
        const top = Math.max(12, Math.min(rect.top - 12, window.innerHeight - 96));
        const createdLabel = project.created
          ? t("projectCreatedAt", "Created {date}").replace("{date}", formatAbsoluteDateTime(project.created, language))
          : null;
        setProjectHoverCard({ label: project.label, path: project.path, createdLabel, top, left });
      }, 160);
    },
    [language, t],
  );
  useEffect(() => {
    return () => {
      if (projectHoverTimerRef.current !== null) window.clearTimeout(projectHoverTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (!projectHoverCard) return;
    const hide = () => hideProjectHoverCard();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [projectHoverCard, hideProjectHoverCard]);
  const togglePin = (path: string) => {
    setPinnedProjects((previous) => {
      const next = previous.some((item) => worktreePathsEqual(item, path))
        ? previous.filter((item) => !worktreePathsEqual(item, path))
        : [...previous, path];
      try {
        window.localStorage.setItem("serphia:pinned-projects", JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    setProjectExpansion((previous) => ({ ...previous, [path]: true }));
    setProjectMenu(null);
  };
  const addProject = useCallback(
    (path: string | null) => {
      if (!path) return;
      setRemovedProjects((previous) => {
        const next = previous.filter((item) => !worktreePathsEqual(item, path));
        try {
          window.localStorage.setItem("serphia:removed-projects", JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
      setSavedProjects((previous) => {
        if (previous.some((item) => worktreePathsEqual(item, path))) return previous;
        const next = [...previous, path];
        try {
          window.localStorage.setItem("serphia:sidebar-projects", JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
      setSelectedCwd(path);
    },
    [setSelectedCwd],
  );
  const removeProject = (path: string) => {
    const removePath = (items: string[]) => items.filter((item) => !worktreePathsEqual(item, path));
    const saved = removePath(savedProjects);
    const pinned = removePath(pinnedProjects);
    const removed = [...removePath(removedProjects), path];
    setSavedProjects(saved);
    setPinnedProjects(pinned);
    setRemovedProjects(removed);
    setProjectMenu(null);
    try {
      window.localStorage.setItem("serphia:sidebar-projects", JSON.stringify(saved));
      window.localStorage.setItem("serphia:pinned-projects", JSON.stringify(pinned));
      window.localStorage.setItem("serphia:removed-projects", JSON.stringify(removed));
    } catch {
      /* storage unavailable */
    }
  };
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const deleteProject = async (path: string, sessions: SessionInfo[]) => {
    if (deletingProjectRef.current) return;
    setProjectMenu(null);
    if (sessions.some((session) => runningSessionIds.has(session.id))) {
      window.alert(t("deleteRunningSessionBlocked", "This session is still running. Stop it before deleting."));
      return;
    }
    deletingProjectRef.current = true;
    setDeletingProject(path);
    try {
      for (const session of sessions) {
        await call("sessions.delete", { id: session.id });
        sessionList.applyChange({ cwd: null, sessionId: session.id, deleted: true });
      }
      removeProject(path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      window.alert(
        `${t("deleteProjectFailed", "Failed to delete the project and all its sessions. Some sessions may already have been deleted.")} ${reason}`,
      );
    } finally {
      deletingProjectRef.current = false;
      setDeletingProject(null);
    }
  };
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the live stream has delivered a frame it is the source of truth for
  // running state; late session responses must not overwrite it.
  const streamAuthoritativeRef = useRef(false);

  useEffect(() => {
    if (!streamAuthoritativeRef.current) setRunningSessionIds(new Set(fallbackRunningIds));
  }, [fallbackRunningIds]);

  useEffect(() => {
    if (loading || listError !== null) return;
    const existingIds = new Set(allSessions.map((session) => session.id));
    setUnreadSessionIds((previous) => {
      const next = new Set([...previous].filter((id) => existingIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [allSessions, listError, loading]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeRunning((event) => {
      if (disposed) return;
      streamAuthoritativeRef.current = true;
      setRunningSessionIds(new Set(event.sessionIds));
    })
      .then((off) => {
        if (disposed) off();
        else unsubscribe = off;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    return sessionList.subscribeDeleted((id) => {
      setUnreadSessionIds((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      onSessionDeleted?.(id);
    });
  }, [sessionList, onSessionDeleted]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  const restoredRef = useRef(false);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    const restore = resolveInitialSessionRestore(
      allSessions,
      initialSessionId,
      loading,
      error !== null,
      restoredRef.current,
    );
    if (restore.status === "wait") return;
    if (restore.status === "restore") {
      restoredRef.current = true;
      setSelectedCwd(restore.session.cwd);
      onSelectSession(restore.session, true);
      return;
    }
    if (restore.status === "not-found") {
      restoredRef.current = true;
      onInitialRestoreDone?.();
    }
  }, [
    allSessions,
    error,
    initialSessionId,
    loading,
    onInitialRestoreDone,
    onSelectSession,
    selectedCwd,
    setSelectedCwd,
  ]);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback(
    (s: SessionInfo) => {
      setSelectedCwd(s.cwd);
      onSelectSession(s);
    },
    [onSelectSession, setSelectedCwd],
  );

  const handleNewSession = useCallback(
    (cwd: string) => {
      const tempId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      setSelectedCwd(cwd);
      onNewSession?.(tempId, cwd);
    },
    [onNewSession, setSelectedCwd],
  );

  const projects = savedProjects.filter(
    (path) => !isDefaultSessionDirectory(path) && (!homeDir || !worktreePathsEqual(path, homeDir)),
  );
  for (const project of getRecentProjects(allSessions)) {
    if (homeDir && worktreePathsEqual(project, homeDir)) continue;
    if (removedProjects.some((item) => worktreePathsEqual(item, project))) continue;
    if (!projects.some((item) => worktreePathsEqual(item, project))) projects.push(project);
  }
  const groups = projects.map((path) => ({
    path,
    label:
      path
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() || path,
    sessions: allSessions.filter((s) => worktreePathsEqual(s.projectRoot ?? s.cwd, path)),
  }));
  const recentSessions = allSessions
    .filter((session) => !projects.some((path) => worktreePathsEqual(session.projectRoot ?? session.cwd, path)))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const isPinned = (path: string) => pinnedProjects.some((item) => worktreePathsEqual(item, path));
  const renderProject = (group: (typeof groups)[number]) => {
    const expanded =
      projectExpansion[group.path] ?? Boolean(selectedProject && worktreePathsEqual(group.path, selectedProject));
    const hasSelectedSession = group.sessions.some((session) => session.id === selectedSessionId);
    const current = Boolean(selectedProject && worktreePathsEqual(group.path, selectedProject) && !hasSelectedSession);
    const nodes = buildSessionTree(group.sessions);
    const projectCreated = group.sessions.reduce<string | null>(
      (earliest, session) => (!earliest || session.created < earliest ? session.created : earliest),
      null,
    );
    return (
      <section key={group.path} className={`project-sidebar-group${expanded ? " is-expanded" : ""}`}>
        <div
          className="project-sidebar-group-heading"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProjectMenu(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setProjectMenu(null);
          }}
        >
          <button
            type="button"
            className={`project-sidebar-group-toggle${current ? " is-current" : ""}`}
            title={group.path}
            aria-expanded={expanded}
            onClick={() => setProjectExpansion((previous) => ({ ...previous, [group.path]: !expanded }))}
            onMouseEnter={(event) =>
              scheduleProjectHoverCard(event.currentTarget, {
                label: group.label,
                path: group.path,
                created: projectCreated,
              })
            }
            onMouseLeave={hideProjectHoverCard}
          >
            <ProjectFolderIcon size={17} open={expanded} />
            <span className="project-sidebar-group-name">{group.label}</span>
          </button>
          <div className="project-sidebar-group-actions">
            <button
              type="button"
              className="project-sidebar-icon"
              title={t("projectActions", "Project actions")}
              aria-label={`${t("projectActions", "Project actions")}: ${group.label}`}
              aria-expanded={projectMenu === group.path}
              onClick={() => setProjectMenu(projectMenu === group.path ? null : group.path)}
            >
              <EllipsisOutlined />
            </button>
            <button
              type="button"
              className="project-sidebar-icon"
              onClick={() => handleNewSession(group.path)}
              disabled={deletingProject === group.path}
              title={`${t("newSessionIn", "New session in selected project")}: ${group.label}`}
              aria-label={`${t("newSession", "new session")}: ${group.label}`}
            >
              <EditOutlined />
            </button>
          </div>
          {projectMenu === group.path && (
            <div className="project-sidebar-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                aria-label={isPinned(group.path) ? t("unpinProject", "Unpin project") : t("pinProject", "Pin project")}
                onClick={() => togglePin(group.path)}
              >
                <PushpinOutlined />{" "}
                {isPinned(group.path) ? t("unpinProject", "Unpin project") : t("pinProject", "Pin project")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={deletingProject !== null}
                onClick={() => void deleteProject(group.path, group.sessions)}
              >
                <DeleteOutlined /> {t("delete", "Delete")}
              </button>
            </div>
          )}
        </div>
        {expanded && (
          <div role="list" className="project-sidebar-sessions">
            {nodes.map((node) => (
              <SessionTreeItem
                key={node.session.id}
                node={node}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={sessionList.refreshIfDisconnected}
                onSessionDeleted={(id) => sessionList.applyChange({ cwd: null, sessionId: id, deleted: true })}
                depth={0}
              />
            ))}
            {nodes.length === 0 && (
              <button type="button" className="project-sidebar-empty" onClick={() => handleNewSession(group.path)}>
                {t("startProjectSession", "Start a conversation")}
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="project-sidebar">
      <div className="project-sidebar-header">
        <div className="project-sidebar-title">
          <span className="project-sidebar-brand">{"Serphia"}</span>
          <div className="project-sidebar-title-actions">
            <button
              type="button"
              className="project-sidebar-icon"
              aria-expanded={searchOpen}
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
              title={t("searchSessions", "Search sessions")}
              aria-label={t("searchSessions", "Search sessions")}
            >
              <SearchOutlined />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="project-sidebar-new"
          title={t("newUnprojectedHint", "Start a session in its own folder under Documents/Serphia")}
          onClick={() => handleNewSession("")}
        >
          <EditOutlined /> {t("newSession", "new session")}
        </button>
      </div>
      <nav aria-label={t("sessions", "Sessions")} className="project-sidebar-list">
        {loading && <div className="project-sidebar-message">{t("loading", "Loading…")}</div>}
        {error && (
          <div className="project-sidebar-message" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
        {groups.some((group) => isPinned(group.path)) && (
          <div className="project-sidebar-section">
            <div className="project-sidebar-section-heading">{t("pinnedProjects", "Pinned")}</div>
            {groups.filter((group) => isPinned(group.path)).map(renderProject)}
          </div>
        )}
        <div className="project-sidebar-section">
          <div className="project-sidebar-section-heading project-sidebar-projects-heading">
            <span>{t("projects", "Projects")}</span>
            <ProjectPicker
              selectedProject={selectedProject}
              homeDir={homeDir}
              allSessions={allSessions}
              setSelectedCwd={(cwd) => {
                addProject(cwd);
                if (cwd) handleNewSession(cwd);
              }}
            />
          </div>
          {groups.filter((group) => !isPinned(group.path)).map(renderProject)}
        </div>
        {recentSessions.length > 0 && (
          <div className="project-sidebar-section">
            <div className="project-sidebar-section-heading">{t("recentSessions", "Recent")}</div>
            <div role="list" className="project-sidebar-recent-list">
              {recentSessions.slice(0, showAllRecent ? undefined : 12).map((session) => (
                <SessionTreeItem
                  key={session.id}
                  node={{ session, children: [] }}
                  selectedSessionId={selectedSessionId}
                  runningSessionIds={runningSessionIds}
                  unreadSessionIds={unreadSessionIds}
                  onSelectSession={handleSelectSessionFromList}
                  onRenamed={sessionList.refreshIfDisconnected}
                  onSessionDeleted={(id) => sessionList.applyChange({ cwd: null, sessionId: id, deleted: true })}
                  depth={0}
                />
              ))}
            </div>
            {!showAllRecent && recentSessions.length > 12 && (
              <button type="button" className="project-sidebar-show-more" onClick={() => setShowAllRecent(true)}>
                {t("showMoreSessions", "Show more")}
              </button>
            )}
          </div>
        )}
      </nav>
      {searchOpen && (
        <SessionSearchDialog
          sessions={allSessions}
          loading={loading}
          error={error}
          onClose={() => setSearchOpen(false)}
          onSelectSession={handleSelectSessionFromList}
          onNewSession={() => handleNewSession("")}
          onOpenFolder={
            window.piBridge?.selectDirectory
              ? async () => {
                  const directory = await window.piBridge.selectDirectory();
                  if (!directory) return false;
                  const result = await call("system.validateCwd", { path: directory });
                  if (!result.ok) throw new Error(result.error ?? t("invalidDirectory", "Invalid directory"));
                  const cwd = result.path ?? directory;
                  addProject(cwd);
                  handleNewSession(cwd);
                  return true;
                }
              : undefined
          }
        />
      )}
      <ProjectHoverCard card={projectHoverCard} />
    </div>
  );
}
