import { PlusOutlined } from "@ant-design/icons/es";
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { Check, Folder, FolderOpen, Home, Plus, Search, Github, X, LoaderCircle } from "lucide-react";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { SessionInfo } from "@/lib/types";
import { getRecentProjects } from "@/hooks/useSidebarWorkspace";
import { abbreviateHomePath } from "@/lib/display-path";
import { PathLabel, AnimatedDropdown, useDeferredFocus } from "./WorkspaceDropdown";

interface Props {
  selectedProject: string | null;
  homeDir: string;
  allSessions: SessionInfo[];
  setSelectedCwd: (cwd: string | null) => void;
}

/** Last path segment, used as the primary project label. */
function projectName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

const PICKER_WIDTH = 240;

interface PickerPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function ProjectPicker({ selectedProject, homeDir, allSessions, setSelectedCwd }: Props) {
  const { t } = useI18n();
  const deferFocus = useDeferredFocus();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<{
    phase: "counting" | "compressing" | "receiving" | "resolving" | "checkout";
    percent: number;
  } | null>(null);
  const cloneRequestRef = useRef<string | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const [cloneError, setCloneError] = useState("");
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const cloneDialogRef = useRef<HTMLDialogElement>(null);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closePicker = useCallback(
    (restoreFocus = false) => {
      setDropdownOpen(false);
      setProjectFilter("");
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      if (restoreFocus) deferFocus(() => triggerRef.current?.focus());
    },
    [deferFocus],
  );

  useEffect(() => {
    const dialog = cloneDialogRef.current;
    if (cloneOpen && dialog && !dialog.open) dialog.showModal();
  }, [cloneOpen]);

  useEffect(() => {
    if (!window.piBridge?.onCloneProgress) return;
    return window.piBridge.onCloneProgress((progress) => {
      if (progress.requestId === cloneRequestRef.current) setCloneProgress(progress);
    });
  }, []);

  useEffect(() => {
    if (!progressFillRef.current || !cloneProgress) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = gsap.to(progressFillRef.current, {
      scaleX: cloneProgress.percent / 100,
      duration: reduceMotion ? 0 : 0.45,
      ease: "power2.out",
      overwrite: "auto",
    });
    return () => {
      tween.kill();
    };
  }, [cloneProgress]);

  const closeClone = () => {
    if (cloning) return;
    cloneDialogRef.current?.close();
    setCloneOpen(false);
    setCloneError("");
    setCloneUrl("");
    setCloneParent("");
    deferFocus(() => triggerRef.current?.focus());
  };

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const result = await call("system.validateCwd", { path: path });
      if (!result.ok) {
        setCustomPathError(result.error ?? t("invalidDirectory", "Invalid directory"));
        return;
      }
      setSelectedCwd(result.path ?? path);
      closePicker();
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, setSelectedCwd, closePicker, t]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const data = await call("system.defaultCwd");
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        closePicker();
      }
    } catch {
      // ignore
    }
  }, [setSelectedCwd, closePicker]);

  /** Desktop-native directory picker (design §6.1). Falls back to path input. */
  const handlePickDirectory = useCallback(async () => {
    try {
      const dir = await window.piBridge?.selectDirectory?.();
      if (!dir) return;
      const result = await call("system.validateCwd", { path: dir });
      if (!result.ok) {
        setCustomPathError(result.error ?? t("invalidDirectory", "Invalid directory"));
        return;
      }
      setSelectedCwd(result.path ?? dir);
      closePicker();
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    }
  }, [setSelectedCwd, closePicker, t]);

  // Close on outside click — the panel lives in a portal, so both surfaces count as inside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closePicker();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closePicker]);

  // Anchor the portaled panel to the trigger and keep it inside the viewport.
  useLayoutEffect(() => {
    if (!dropdownOpen) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PICKER_WIDTH, window.innerWidth - 24);
      const top = rect.bottom + 8;
      setPosition({
        top,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        width,
        maxHeight: Math.max(220, window.innerHeight - top - 12),
      });
    };
    update();
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      update();
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [dropdownOpen]);

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  const chooseProject = (project: string) => {
    setSelectedCwd(project);
    closePicker();
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => {
          if (dropdownOpen) closePicker();
          else setDropdownOpen(true);
        }}
        title={t("addProject", "Add project")}
        className="project-sidebar-icon project-picker-trigger"
        aria-label={t("addProject", "Add project")}
        aria-haspopup="dialog"
        aria-expanded={dropdownOpen}
      >
        <PlusOutlined />
      </button>

      {cloneOpen &&
        createPortal(
          <dialog
            ref={cloneDialogRef}
            className="github-clone-dialog"
            aria-labelledby="clone-dialog-title"
            onCancel={(event) => {
              event.preventDefault();
              closeClone();
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!cloneUrl.trim() || !cloneParent || cloning) return;
                setCloning(true);
                setCloneProgress(null);
                const requestId = crypto.randomUUID();
                cloneRequestRef.current = requestId;
                setCloneError("");
                void window.piBridge
                  .cloneGithub(cloneUrl.trim(), cloneParent, requestId)
                  .then((directory) => {
                    setSelectedCwd(directory);
                    cloneDialogRef.current?.close();
                    setCloneOpen(false);
                    setCloneUrl("");
                    setCloneParent("");
                  })
                  .catch((error: unknown) => setCloneError(error instanceof Error ? error.message : String(error)))
                  .finally(() => {
                    cloneRequestRef.current = null;
                    setCloning(false);
                  });
              }}
            >
              <header className="github-clone-header">
                <div className="github-clone-brand">
                  <Github size={21} aria-hidden="true" />
                </div>
                <div className="github-clone-heading">
                  <h2 id="clone-dialog-title">{t("cloneGithub", "Clone from GitHub")}</h2>
                  <p>{t("cloneDescription", "Clone a repository and open it as your workspace.")}</p>
                </div>
                <button
                  type="button"
                  className="github-clone-close"
                  onClick={closeClone}
                  disabled={cloning}
                  aria-label={t("close", "Close")}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="github-clone-body">
                <div className="github-clone-field">
                  <label htmlFor="clone-url">{t("cloneRepositoryUrl", "Repository URL")}</label>
                  <input
                    id="clone-url"
                    value={cloneUrl}
                    onChange={(e) => {
                      setCloneUrl(e.target.value);
                      setCloneError("");
                    }}
                    placeholder={"https://github.com/owner/repo"}
                    disabled={cloning}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <p>{t("cloneUrlHint", "Supports GitHub HTTPS and SSH repository URLs.")}</p>
                </div>
                <div className="github-clone-field">
                  <label id="clone-directory-label">{t("cloneDestination", "Destination folder")}</label>
                  <div className="github-clone-location" role="group" aria-labelledby="clone-directory-label">
                    <FolderOpen size={17} aria-hidden="true" />
                    <span className={cloneParent ? "" : "is-placeholder"} title={cloneParent}>
                      {cloneParent || t("cloneChooseDirectory", "Choose destination folder…")}
                    </span>
                    <button
                      type="button"
                      disabled={cloning}
                      onClick={() => {
                        void window.piBridge
                          .selectDirectory()
                          .then((directory) => {
                            if (directory) {
                              setCloneParent(directory);
                              setCloneError("");
                            }
                          })
                          .catch((error: unknown) =>
                            setCloneError(error instanceof Error ? error.message : String(error)),
                          );
                      }}
                    >
                      {t("cloneBrowse", "Browse")}
                    </button>
                  </div>
                  <p>{t("cloneDestinationHint", "A repository folder will be created in this location.")}</p>
                </div>
                {cloning && (
                  <div className="github-clone-progress" aria-live="polite">
                    <div className="github-clone-progress-heading">
                      <span className="github-clone-progress-label">
                        <span className="github-clone-progress-dot" />
                        {cloneProgress
                          ? {
                              counting: t("clonePhaseCounting", "Counting objects"),
                              compressing: t("clonePhaseCompressing", "Compressing objects"),
                              receiving: t("clonePhaseReceiving", "Receiving objects"),
                              resolving: t("clonePhaseResolving", "Resolving deltas"),
                              checkout: t("clonePhaseCheckout", "Checking out files"),
                            }[cloneProgress.phase]
                          : t("cloneConnecting", "Connecting to GitHub…")}
                      </span>
                      {cloneProgress && (
                        <span className="github-clone-progress-percent">
                          {cloneProgress.percent}
                          <small>%</small>
                        </span>
                      )}
                    </div>
                    <div
                      className={`github-clone-progress-track${cloneProgress ? "" : " is-indeterminate"}`}
                      role="progressbar"
                      aria-label={t("cloneProgress", "Clone progress")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={cloneProgress?.percent}
                    >
                      <div
                        ref={progressFillRef}
                        key={cloneProgress ? "determinate" : "waiting"}
                        className="github-clone-progress-fill"
                      />
                    </div>
                    <p>
                      {cloneProgress
                        ? t("clonePhaseHint", "Progress for the current stage")
                        : t("cloneConnectingHint", "Preparing the repository, please wait…")}
                    </p>
                  </div>
                )}
                {cloneError && (
                  <div className="github-clone-error" role="alert">
                    {cloneError}
                  </div>
                )}
              </div>
              <footer className="github-clone-footer">
                <button type="button" className="github-clone-cancel" onClick={closeClone} disabled={cloning}>
                  {t("cancel", "Cancel")}
                </button>
                <button
                  type="submit"
                  className="github-clone-submit"
                  disabled={cloning || !cloneUrl.trim() || !cloneParent}
                >
                  {cloning && <LoaderCircle size={15} className="github-clone-spinner" aria-hidden="true" />}
                  {cloning ? t("cloning", "Cloning…") : t("cloneAndOpen", "Clone and open")}
                </button>
              </footer>
            </form>
          </dialog>,
          document.body,
        )}

      {createPortal(
        <AnimatedDropdown
          open={dropdownOpen}
          className="project-picker-menu"
          transformOrigin="top right"
          style={{
            position: "fixed",
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? PICKER_WIDTH,
            maxHeight: position?.maxHeight,
            visibility: position ? "visible" : "hidden",
            zIndex: 1200,
          }}
        >
          <div
            ref={panelRef}
            className="project-picker-panel"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closePicker(true);
            }}
          >
            {showProjectFilter && (
              <div className="project-picker-search">
                <Search size={14} strokeWidth={1.8} aria-hidden="true" />
                <input
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  placeholder={t("filterProjects", "Filter projects…")}
                  aria-label={t("filterProjects", "Filter projects…")}
                  autoFocus
                />
              </div>
            )}

            <div className="project-picker-section-title">{t("recentProjects", "Recent projects")}</div>
            <div className="project-picker-list">
              {visibleProjects.map((project) => {
                const current = project === selectedProject;
                const name = projectName(project);
                return (
                  <button
                    key={project}
                    type="button"
                    className={`project-picker-item${current ? " is-current" : ""}`}
                    onClick={() => chooseProject(project)}
                    title={project}
                    aria-current={current ? "true" : undefined}
                  >
                    <span className="project-picker-item-icon" aria-hidden="true">
                      <Folder size={15} strokeWidth={1.7} />
                    </span>
                    <span className="project-picker-item-copy">
                      <span className="project-picker-item-name">{name}</span>
                      <PathLabel
                        text={abbreviateHomePath(project, homeDir)}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--picker-dim)" }}
                      />
                    </span>
                    {current && (
                      <Check className="project-picker-check" size={15} strokeWidth={2.4} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
              {recentProjects.length === 0 && (
                <div className="project-picker-empty">{t("noRecentProjects", "No recent projects yet")}</div>
              )}
              {recentProjects.length > 0 && visibleProjects.length === 0 && projectFilter.trim() && (
                <div className="project-picker-empty">{t("noMatchingProjects", "No matching projects")}</div>
              )}
            </div>

            <div className="project-picker-divider" />

            {customPathOpen ? (
              <form
                className="project-picker-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitCustomPath();
                }}
              >
                <label className="project-picker-form-title" htmlFor="project-picker-custom-path">
                  {t("customPath", "Custom path…")}
                </label>
                <input
                  id="project-picker-custom-path"
                  ref={customPathInputRef}
                  value={customPathValue}
                  onChange={(e) => {
                    setCustomPathValue(e.target.value);
                    setCustomPathError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                    }
                  }}
                  placeholder="/path/to/project"
                  spellCheck={false}
                  autoComplete="off"
                />
                {customPathError && (
                  <div className="project-picker-form-error" role="alert">
                    {customPathError}
                  </div>
                )}
                <div className="project-picker-form-actions">
                  <button
                    type="button"
                    className="project-picker-secondary"
                    onClick={() => {
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                    }}
                  >
                    {t("cancel", "Cancel")}
                  </button>
                  <button
                    type="submit"
                    className="project-picker-primary"
                    disabled={customPathValidating || !customPathValue.trim()}
                  >
                    {customPathValidating ? t("checking", "Checking…") : t("open", "Open")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="project-picker-actions">
                {window.piBridge && (
                  <button
                    type="button"
                    className="project-picker-action"
                    onClick={() => {
                      closePicker();
                      setCloneOpen(true);
                    }}
                  >
                    <Github size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{t("cloneGithub", "Clone from GitHub")}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="project-picker-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDefaultCwd();
                  }}
                >
                  <Home size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>{t("useDefaultDirectory", "Use default directory")}</span>
                </button>
                {typeof window !== "undefined" && !!window.piBridge && (
                  <button
                    type="button"
                    className="project-picker-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handlePickDirectory();
                    }}
                  >
                    <FolderOpen size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{t("browseFolder", "Browse folder…")}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="project-picker-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomPathOpen(true);
                    setCustomPathError(null);
                    deferFocus(() => customPathInputRef.current?.focus());
                  }}
                >
                  <Plus size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>{t("customPath", "Custom path…")}</span>
                </button>
              </div>
            )}
          </div>
        </AnimatedDropdown>,
        document.body,
      )}
    </div>
  );
}
