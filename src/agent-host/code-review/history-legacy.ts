import type { ReviewHistoryRow, ReviewRun, ReviewScope, ReviewState } from "../../contract/code-review";
import { parseReview, ReviewError } from "./output";

type NativeRow = {
  session_id: string;
  repo_dir?: string;
  model?: string;
  git_branch?: string;
  review_mode?: string;
  diff_from?: string;
  diff_to?: string;
  diff_commit?: string;
  start_time?: string;
  end_time?: string;
  selected_files?: number;
  total_comments?: number;
  failed_files?: number;
  aborted?: boolean;
  run_manifest?: { terminal_state?: ReviewState; coverage?: { selected?: { path?: string }[] } };
};
type NativeDetail = { summary: NativeRow; items: { file_path?: string; new_path?: string }[] };

export function legacyScope(row: NativeRow, scanPaths?: string[]): ReviewScope {
  if (row.review_mode === "range" && row.diff_from) return { kind: "branch", from: row.diff_from, to: row.diff_to };
  if (row.review_mode === "commit" && row.diff_commit) return { kind: "commit", ref: row.diff_commit };
  if (row.review_mode === "full_scan") return { kind: "scan", paths: scanPaths?.join(",") || undefined };
  return { kind: "workspace" };
}

function state(row: NativeRow): ReviewState {
  const recorded = row.run_manifest?.terminal_state;
  if (recorded && ["complete", "partial", "skipped", "failed", "cancelled"].includes(recorded)) return recorded;
  return row.aborted ? "cancelled" : row.failed_files ? "partial" : "complete";
}

export function legacyHistoryRows(root: string, raw: string): ReviewHistoryRow[] {
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) return [];
  return list.flatMap((row: NativeRow) => {
    if (typeof row?.session_id !== "string") return [];
    return [
      {
        ref: { cwd: root, sessionId: row.session_id },
        root,
        sessionId: row.session_id,
        scope: legacyScope(row),
        state: state(row),
        startedAt: Date.parse(row.start_time ?? "") || 0,
        model: row.model || "OCR",
      },
    ];
  });
}

export function legacyRun(
  root: string,
  id: string,
  detail: string,
  comments: string,
  report: string | null,
  scanPaths?: string[],
): ReviewRun {
  const { summary, items } = JSON.parse(detail) as NativeDetail;
  if (!summary || summary.session_id !== id || !Array.isArray(items)) throw new ReviewError("invalidOutput");
  const recordedState = state(summary);
  const parsed = report
    ? parseReview(report, recordedState === "failed" ? 1 : 0, "", "")
    : parseReview(JSON.stringify({ status: "complete", comments: JSON.parse(comments) }), 0, "", "");
  const paths = new Set<string>();
  for (const item of summary.run_manifest?.coverage?.selected ?? []) if (item.path) paths.add(item.path);
  for (const item of items) {
    const file = item.new_path || item.file_path;
    if (file) paths.add(file);
  }
  for (const finding of parsed.findings) paths.add(finding.path);
  const scope = legacyScope(summary, scanPaths);
  const startedAt = Date.parse(summary.start_time ?? "") || 0;
  return {
    ...parsed,
    id,
    sessionId: id,
    root,
    scope,
    request: { cwd: root, scope },
    model: summary.model || "OCR",
    worktreeBranch: summary.git_branch,
    state: report ? parsed.state : recordedState,
    startedAt,
    finishedAt: Date.parse(summary.end_time ?? "") || startedAt || 1,
    files: [...paths].map((path) => ({ path, status: "", included: true, insertions: 0, deletions: 0 })),
  };
}
