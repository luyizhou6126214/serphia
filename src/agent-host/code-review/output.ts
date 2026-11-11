import type { ReviewFile, ReviewFinding, ReviewIssue, ReviewState } from "../../contract/code-review";

export class ReviewError extends Error {
  readonly issue: ReviewIssue;

  constructor(issue: ReviewIssue) {
    super(issue);
    this.issue = issue;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ReviewError("invalidOutput");
  return value as Record<string, unknown>;
}

function readJson(value: string) {
  try {
    return record(JSON.parse(value));
  } catch {
    throw new ReviewError("invalidOutput");
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    /^(?:[\\/]|[a-z]:)|\0/i.test(value) ||
    value.split(/[\\/]/u).some((part) => part === ".." || part.toLowerCase() === ".git")
  ) {
    throw new ReviewError("invalidOutput");
  }
  return value;
}

export function parsePreview(stdout: string): ReviewFile[] {
  const result = readJson(stdout);
  if (!Array.isArray(result.files)) throw new ReviewError("invalidOutput");
  if (result.files.length > 2000) throw new ReviewError("scopeLimit");
  return result.files.map((value) => {
    const file = record(value);
    if (typeof file.will_review !== "boolean" || typeof file.status !== "string") {
      throw new ReviewError("invalidOutput");
    }
    return {
      path: safePath(file.path),
      status: file.status,
      insertions: count(file.insertions),
      deletions: count(file.deletions),
      included: file.will_review,
      reason: typeof file.exclude_reason === "string" ? file.exclude_reason.slice(0, 100) : undefined,
    };
  });
}

export function issueFromDiagnostics(stderr: string): ReviewIssue {
  if (/\b401\b|\b403\b|unauthori[sz]ed|invalid api key/iu.test(stderr)) return "authentication";
  if (/\b429\b|rate.limit/iu.test(stderr)) return "rateLimit";
  if (/timed?\s*out|deadline exceeded/iu.test(stderr)) return "timeout";
  return "failed";
}

export function parseReview(stdout: string, code: number | null, stderr: string, apiKey: string) {
  if (!stdout.trim() && code !== 0) throw new ReviewError(issueFromDiagnostics(stderr));
  const result = readJson(stdout);
  if (!Array.isArray(result.comments)) throw new ReviewError("invalidOutput");
  const redact = (value: string, limit: number) =>
    (apiKey ? value.replaceAll(apiKey, "[redacted]") : value).slice(0, limit);
  const findings: ReviewFinding[] = result.comments.slice(0, 2000).map((value, id) => {
    const comment = record(value);
    if (typeof comment.content !== "string") throw new ReviewError("invalidOutput");
    const severity = typeof comment.severity === "string" ? comment.severity.toLowerCase() : "";
    return {
      id,
      path: safePath(comment.path),
      line: count(comment.start_line) || null,
      endLine: count(comment.end_line) || null,
      severity:
        severity === "critical" || severity === "high" || severity === "medium" || severity === "low"
          ? severity
          : "unknown",
      message: redact(comment.content, 12_000),
      suggestion: typeof comment.suggestion_code === "string" ? redact(comment.suggestion_code, 12_000) : undefined,
      category: typeof comment.category === "string" ? redact(comment.category, 100) : undefined,
    };
  });
  const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
  const partial =
    warningCount > 0 ||
    result.comments.length > findings.length ||
    result.status === "partial" ||
    result.status === "completed_with_warnings" ||
    result.status === "completed_with_errors";
  let state: ReviewState;
  if (result.status === "skipped" && code === 0) state = "skipped";
  else if (result.status === "failed" || (code !== 0 && result.status !== "partial")) {
    state = findings.length > 0 ? "partial" : "failed";
  } else if (partial) state = "partial";
  else if (result.status === "complete" || result.status === "success") state = "complete";
  else throw new ReviewError("invalidOutput");
  const summary = result.summary && typeof result.summary === "object" ? record(result.summary) : undefined;
  const budgetExceeded =
    summary?.budget_exceeded === true ||
    (Array.isArray(result.warnings) && result.warnings.some((warning) => warning?.type === "token_budget_reached"));
  return {
    state,
    findings,
    warningCount,
    sessionId: typeof result.session_id === "string" ? result.session_id : undefined,
    filesReviewed: summary ? count(summary.files_reviewed) : undefined,
    issue:
      budgetExceeded && (state === "failed" || state === "partial")
        ? ("tokenBudget" as const)
        : state === "failed"
          ? issueFromDiagnostics(stderr)
          : undefined,
  };
}
