import { useEffect, useState } from "react";
import type { ApiResult } from "@contract/api";
import type { ReviewBranches, ReviewIssue } from "@contract/code-review";
import { normalizeWorktreePathForComparison, worktreePathsEqual } from "@shared/worktree-path";
import { isDefaultSessionDirectory } from "@shared/session-workspace";
import { call } from "@/lib/api-client";

const REVIEW_PROJECTS = "serphia:review-projects";
const REVIEW_SELECTION = "serphia:review-project";

function readPaths(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item));
  } catch {
    // Storage may be unavailable.
  }
  return [];
}

function storePaths(key: string, paths: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    /* Keep the current selection in memory. */
  }
}

function isProject(directory: string, home: string) {
  return (
    !isDefaultSessionDirectory(directory) &&
    (!home || !worktreePathsEqual(directory, home)) &&
    !/(?:^|[\\/])channel-workspaces[\\/]/iu.test(directory)
  );
}

type ProjectInfo = ApiResult<"worktrees.list">;

export function useReviewWorkspace({
  activeCwd,
  activeProject,
  projects,
  home,
}: {
  activeCwd: string | null;
  activeProject: string | null;
  projects: string[];
  home: string;
}) {
  const [manual, setManual] = useState(() => readPaths(REVIEW_PROJECTS));
  const [projectChoice, setProjectChoice] = useState(() => readPaths(REVIEW_SELECTION)[0] ?? "");
  const [worktreeChoice, setWorktreeChoice] = useState<{ project: string; path: string } | null>(null);
  const [projectData, setProjectData] = useState<{ project: string; data: ProjectInfo } | null>(null);
  const [branchData, setBranchData] = useState<{ cwd: string; data: ReviewBranches } | null>(null);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [issue, setIssue] = useState<ReviewIssue | null>(null);
  const [revision, setRevision] = useState(0);
  const removed = readPaths("serphia:removed-projects");
  const choices: string[] = [];
  for (const item of [
    ...manual,
    ...readPaths("serphia:sidebar-projects"),
    ...projects,
    ...(projectChoice ? [projectChoice] : []),
    ...(activeProject ? [activeProject] : []),
  ]) {
    const explicitlyOpened = manual.some((entry) => worktreePathsEqual(entry, item));
    if (!explicitlyOpened && (!isProject(item, home) || removed.some((entry) => worktreePathsEqual(entry, item)))) {
      continue;
    }
    if (!choices.some((entry) => worktreePathsEqual(entry, item))) choices.push(item);
  }
  const project =
    choices.find((item) => worktreePathsEqual(item, projectChoice)) ??
    choices.find((item) => activeProject && worktreePathsEqual(item, activeProject)) ??
    "";
  const info = projectData?.project === project ? projectData.data : null;
  const worktrees = info?.worktrees ?? [];
  const picked = worktreeChoice?.project === project ? worktreeChoice.path : activeCwd;
  const pickedKey = picked ? normalizeWorktreePathForComparison(picked) : "";
  const cwd = info
    ? (worktrees.find(({ path }) => worktreePathsEqual(path, pickedKey))?.path ??
      worktrees.find(({ path }) => pickedKey.startsWith(normalizeWorktreePathForComparison(path) + "/"))?.path ??
      worktrees.find(({ isMain }) => isMain)?.path ??
      worktrees[0]?.path ??
      project)
    : null;
  const branches = branchData?.cwd === cwd ? branchData.data : null;

  useEffect(() => {
    if (!project || !cwd) return;
    if (!projectChoice) setProjectChoice(project);
    if (!worktreeChoice || worktreeChoice.project !== project) setWorktreeChoice({ project, path: cwd });
  }, [project, cwd, projectChoice, worktreeChoice]);

  useEffect(() => {
    if (!project) return;
    let current = true;
    setIssue(null);
    async function load() {
      const validation = await call("system.validateCwd", { path: project });
      if (!validation.ok) throw new Error();
      const data = await call("worktrees.list", { projectRoot: project });
      if (current) setProjectData({ project, data });
    }
    void load().catch(() => {
      if (current) setIssue("notRepository");
    });
    return () => {
      current = false;
    };
  }, [project, revision]);

  useEffect(() => {
    if (!cwd || !info?.isGit) return;
    let current = true;
    void call("codeReview.branches", { cwd })
      .then((reply) => {
        if (!current) return;
        if (reply.ok) setBranchData({ cwd, data: reply.value });
        else setIssue(reply.issue);
      })
      .catch(() => {
        if (current) setIssue("failed");
      });
    return () => {
      current = false;
    };
  }, [cwd, info?.isGit, revision]);

  function selectProject(path: string) {
    setProjectChoice(path);
    setWorktreeChoice(null);
    setIssue(null);
    storePaths(REVIEW_SELECTION, [path]);
  }

  async function openDirectory() {
    setDirectoryBusy(true);
    setIssue(null);
    try {
      const directory = await window.piBridge.selectDirectory();
      if (!directory) return;
      const valid = await call("system.validateCwd", { path: directory });
      const selected = valid.path ?? directory;
      if (!valid.ok) throw new Error();
      const data = await call("worktrees.list", { projectRoot: selected });
      const root = data.isGit ? data.projectRoot : selected;
      const recent = [root, ...manual.filter((item) => !worktreePathsEqual(item, root))].slice(0, 24);
      setManual(recent);
      storePaths(REVIEW_PROJECTS, recent);
      selectProject(root);
      setWorktreeChoice({ project: root, path: selected });
      setProjectData({ project: root, data });
      return true;
    } catch {
      setIssue("notRepository");
    } finally {
      setDirectoryBusy(false);
    }
  }

  return {
    project,
    projects: choices,
    cwd,
    info,
    worktrees,
    branches,
    issue,
    directoryBusy,
    loading: Boolean(project && !info && !issue),
    openDirectory,
    selectProject,
    selectWorktree: (path: string) => {
      setWorktreeChoice({ project, path });
      setIssue(null);
    },
    refresh: () => setRevision((prior) => prior + 1),
  };
}
