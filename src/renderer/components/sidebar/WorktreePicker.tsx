import { useState, useRef, useCallback, useEffect, useLayoutEffect, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Folder, GitBranch, LoaderCircle, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import type { WorktreeState } from "@/hooks/useSidebarWorkspace";
import { abbreviateHomePath } from "@/lib/display-path";
import { worktreePathsEqual } from "@shared/worktree-path";
import { call } from "@/lib/api-client";
import { useDeferredFocus } from "./WorkspaceDropdown";

interface Props {
  selectedCwd: string | null;
  selectedProject: string | null;
  homeDir: string;
  worktreeState: WorktreeState | null;
  worktreeLoadingCwd: string | null;
  setSelectedCwd: (cwd: string) => void;
  onCreated: (path: string, branch: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
}

/** Git context belongs to the composer: changing checkout starts a draft in that directory. */
export function WorktreePicker({
  selectedCwd,
  selectedProject,
  homeDir,
  worktreeState,
  worktreeLoadingCwd,
  setSelectedCwd,
  onCreated,
  onRefresh,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const deferFocus = useDeferredFocus();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ path: string; dirty: boolean } | null>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const branchRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const close = useCallback(
    (restoreFocus = false) => {
      setOpen(false);
      setCreating(false);
      setBranch("");
      setQuery("");
      setError(null);
      setConfirmRemove(null);
      if (restoreFocus) deferFocus(() => buttonRef.current?.focus());
    },
    [deferFocus],
  );

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node))
        close();
    };
    document.addEventListener("mousedown", outside);
    deferFocus(() => searchRef.current?.focus());
    return () => document.removeEventListener("mousedown", outside);
  }, [open, close, deferFocus]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        bottom: window.innerHeight - rect.top + 8,
        width,
        maxHeight: Math.max(100, rect.top - 20),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const current = worktreeState?.worktrees.find((item) => selectedCwd && worktreePathsEqual(item.path, selectedCwd));
  const validState = Boolean(
    worktreeState && selectedCwd && (worktreePathsEqual(worktreeState.forCwd, selectedCwd) || current),
  );
  const canManage = Boolean(
    validState &&
    worktreeState?.isGit &&
    worktreeState.isTopLevel &&
    selectedProject &&
    worktreePathsEqual(selectedProject, worktreeState.projectRoot),
  );
  const loading = worktreeLoadingCwd === selectedCwd && !validState;
  const cwdLabel =
    selectedCwd
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || selectedCwd;

  const createWorktree = async () => {
    if (!branch.trim() || busyRef.current || disabled || !canManage || !worktreeState) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { worktree } = await call("worktrees.create", {
        projectRoot: worktreeState.projectRoot,
        cwd: worktreeState.projectRoot,
        branch: branch.trim(),
      });
      if (!mountedRef.current) {
        onRefresh();
        return;
      }
      close();
      onCreated(worktree.path, branch.trim());
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const removeWorktree = async () => {
    if (!confirmRemove || !worktreeState || busyRef.current || disabled) return;
    const { path, dirty } = confirmRemove;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await call("worktrees.remove", { cwd: worktreeState.projectRoot, path, force: dirty });
      onRefresh();
      if (!mountedRef.current) return;
      setConfirmRemove(null);
      if (selectedCwd && worktreePathsEqual(selectedCwd, path)) setSelectedCwd(worktreeState.projectRoot);
    } catch (cause) {
      if (!mountedRef.current) return;
      if (!dirty && (cause as { detail?: { dirty?: boolean } }).detail?.dirty) setConfirmRemove({ path, dirty: true });
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    if (event.key !== "Tab") return;
    const elements = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    if (!elements?.length) return;
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!selectedCwd) return null;
  const entries =
    worktreeState?.worktrees.filter((item) =>
      `${item.branch ?? ""} ${item.path}`.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];

  return (
    <div className="composer-workspace-context">
      <span className="composer-workspace-directory" title={abbreviateHomePath(selectedCwd, homeDir)}>
        <Folder size={13} strokeWidth={1.6} aria-hidden="true" />
        <span>{cwdLabel}</span>
      </span>
      {canManage ? (
        <>
          <span className="composer-workspace-divider" aria-hidden="true" />
          <button
            ref={buttonRef}
            type="button"
            className={`composer-workspace-trigger${open ? " is-open" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${t("workspaceBranches", "Branches & workspaces")}: ${current?.branch ?? t("detachedHead", "Detached HEAD")}`}
            title={
              disabled
                ? t("workspaceBusyHint", "Available after the current task finishes")
                : t("workspaceBranches", "Branches & workspaces")
            }
            disabled={disabled}
            onClick={() => {
              if (open) close();
              else {
                setOpen(true);
                onRefresh();
              }
            }}
          >
            <GitBranch size={13} strokeWidth={1.6} aria-hidden="true" />
            <span>{current?.branch ?? t("detachedHead", "Detached HEAD")}</span>
            {!current?.isMain && <span className="composer-workspace-dot" aria-hidden="true" />}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </>
      ) : loading ? (
        <LoaderCircle
          size={12}
          className="workspace-spinner"
          aria-label={t("worktreeChecking", "Checking worktrees for this directory.")}
        />
      ) : null}
      {open &&
        canManage &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            className="workspace-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("workspaceBranches", "Branches & workspaces")}
            onKeyDown={handleKeyDown}
            style={{ position: "fixed", ...position }}
          >
            <div className="workspace-panel-header">
              <span>{t("workspaceBranches", "Branches & workspaces")}</span>
              <button
                type="button"
                className="workspace-icon-button"
                onClick={onRefresh}
                disabled={busy || worktreeLoadingCwd === selectedCwd}
                aria-label={t("refresh", "Refresh")}
              >
                <RefreshCw size={13} className={worktreeLoadingCwd === selectedCwd ? "workspace-spinner" : ""} />
              </button>
              <button
                type="button"
                className="workspace-icon-button"
                onClick={() => close(true)}
                aria-label={t("close", "Close")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="workspace-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchWorkspaces", "Search branches or workspaces")}
                aria-label={t("searchWorkspaces", "Search branches or workspaces")}
              />
            </div>
            <div className="workspace-entries" role="list">
              {entries.map((entry) => {
                const active = worktreePathsEqual(entry.path, selectedCwd);
                return (
                  <div key={entry.path} className={`workspace-entry${active ? " is-current" : ""}`} role="listitem">
                    <button
                      type="button"
                      className="workspace-entry-select"
                      disabled={busy}
                      title={entry.path}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        close(true);
                        if (!active) setSelectedCwd(entry.path);
                      }}
                    >
                      <span className="workspace-entry-icon">
                        <GitBranch size={15} strokeWidth={1.6} />
                      </span>
                      <span className="workspace-entry-copy">
                        <span className="workspace-entry-name">
                          {entry.branch ?? t("detachedHead", "Detached HEAD")}
                        </span>
                        <span className="workspace-entry-path">
                          {entry.isMain ? t("mainBranch", "main") : abbreviateHomePath(entry.path, homeDir)}
                        </span>
                      </span>
                      {active && <Check size={14} className="workspace-entry-check" aria-hidden="true" />}
                    </button>
                    {!entry.isMain && (
                      <button
                        type="button"
                        className="workspace-icon-button workspace-remove"
                        disabled={busy}
                        onClick={() => {
                          setConfirmRemove({ path: entry.path, dirty: false });
                          setCreating(false);
                          setError(null);
                        }}
                        aria-label={t(
                          "removeWorktreeHint",
                          "Remove worktree checkout {path}; the branch is kept",
                        ).replace("{path}", entry.path)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
              {entries.length === 0 && (
                <div className="workspace-empty">{t("noMatchingWorkspaces", "No matching workspaces")}</div>
              )}
            </div>
            <div className="workspace-panel-footer">
              {confirmRemove ? (
                <div className="workspace-form">
                  <div className="workspace-form-title">{t("removeWorkspace", "Remove workspace")}</div>
                  <div className="workspace-confirm-path">{abbreviateHomePath(confirmRemove.path, homeDir)}</div>
                  <p>
                    {confirmRemove.dirty
                      ? t("worktreeForceRemoveConfirm", "Uncommitted changes. Force remove checkout?")
                      : t("removeWorkspaceConfirm", "Remove this checkout? The Git branch will be kept.")}
                  </p>
                  <div className="workspace-form-actions">
                    <button
                      type="button"
                      className="workspace-secondary"
                      disabled={busy}
                      onClick={() => {
                        setConfirmRemove(null);
                        setError(null);
                      }}
                    >
                      {t("cancel", "Cancel")}
                    </button>
                    <button
                      type="button"
                      className="workspace-danger"
                      disabled={busy}
                      onClick={() => void removeWorktree()}
                    >
                      {busy ? <LoaderCircle size={13} className="workspace-spinner" /> : null}
                      {confirmRemove.dirty ? t("force", "Force") : t("remove", "Remove")}
                    </button>
                  </div>
                </div>
              ) : creating ? (
                <form
                  className="workspace-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createWorktree();
                  }}
                >
                  <label htmlFor="workspace-branch-name" className="workspace-form-title">
                    {t("newWorkspaceBranch", "New branch & workspace")}
                  </label>
                  <input
                    id="workspace-branch-name"
                    ref={branchRef}
                    value={branch}
                    disabled={busy}
                    onChange={(event) => {
                      setBranch(event.target.value);
                      setError(null);
                    }}
                    placeholder={t("branchName", "branch name")}
                  />
                  <p>{t("workspaceCreateDescription", "Start a new conversation in an isolated checkout.")}</p>
                  <div className="workspace-form-actions">
                    <button
                      type="button"
                      className="workspace-secondary"
                      disabled={busy}
                      onClick={() => {
                        setCreating(false);
                        setError(null);
                        deferFocus(() => searchRef.current?.focus());
                      }}
                    >
                      {t("cancel", "Cancel")}
                    </button>
                    <button type="submit" className="workspace-primary" disabled={busy || !branch.trim()}>
                      {busy ? <LoaderCircle size={13} className="workspace-spinner" /> : <Plus size={13} />}
                      {busy ? t("creating", "Creating…") : t("create", "Create")}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="workspace-create"
                    disabled={busy}
                    onClick={() => {
                      setCreating(true);
                      setError(null);
                      deferFocus(() => branchRef.current?.focus());
                    }}
                  >
                    <Plus size={15} />
                    {t("newWorkspaceBranch", "New branch & workspace")}
                  </button>
                  <p className="workspace-switch-hint">
                    {t("workspaceSwitchDescription", "Switching workspaces starts a new conversation.")}
                  </p>
                </>
              )}
              {error && (
                <div className="workspace-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
