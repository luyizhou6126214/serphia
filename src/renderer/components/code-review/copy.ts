import type { ReviewFinding, ReviewIssue, ReviewScope, ReviewState } from "@contract/code-review";

type Translate = (key: string, fallback: string) => string;

export function reviewIssueText(issue: ReviewIssue, t: Translate) {
  switch (issue) {
    case "runtime":
      return t("reviewErrorRuntime", "The bundled review engine is unavailable or failed verification.");
    case "gitMissing":
      return t("reviewErrorGitMissing", "No usable Git was found. Configure Git in Toolchains.");
    case "gitOld":
      return t("reviewErrorGitOld", "Open Code Review requires Git 2.41 or newer.");
    case "notRepository":
      return t("reviewErrorRepository", "This worktree or file is no longer available.");
    case "stalePreview":
      return t("reviewErrorStalePreview", "The changes no longer match the preview. Preview again.");
    case "scopeLimit":
      return t("reviewErrorLimit", "The changes or output exceeded the review limit.");
    case "busy":
      return t("reviewErrorBusy", "A review is already running.");
    case "profile":
      return t("reviewErrorProfile", "Choose an available model and a supported reasoning level.");
    case "credentials":
      return t("reviewErrorCredentials", "Could not access the encrypted model settings.");
    case "authentication":
      return t("reviewErrorAuth", "The model provider rejected authentication. Check the API key and endpoint.");
    case "rateLimit":
      return t("reviewErrorRate", "The model provider is rate limiting requests. Try again shortly.");
    case "tokenBudget":
      return t(
        "reviewErrorBudget",
        "OCR reached the total token budget. Raise the budget in Review options and run again.",
      );
    case "timeout":
      return t("reviewErrorTimeout", "The operation timed out. Try again.");
    case "invalidOutput":
      return t("reviewErrorOutput", "The review engine returned an unreadable result.");
    case "configInvalid":
      return t("reviewOcrConfigInvalid", "Check the OCR configuration JSON and field values.");
    case "configChanged":
      return t("reviewOcrConfigChanged", "The OCR configuration changed. Reload before saving.");
    case "mcpConfig":
      return t("reviewMcpInvalid", "Use a JSON object of named MCP servers with valid transport settings.");
    case "mcpChanged":
      return t("reviewMcpChanged", "The MCP configuration changed. Reload before saving.");
    case "mcpSetup":
      return t("reviewMcpSetupFailed", "An OCR MCP setup command failed in the selected worktree.");
    case "containment":
      return t("reviewErrorContainment", "The review process could not start or stop safely.");
    case "failed":
      return t("reviewErrorGeneric", "The review could not finish. Check your worktree and model settings.");
  }
}

export function reviewStateText(state: ReviewState | undefined, t: Translate) {
  switch (state) {
    case "running":
      return t("reviewRunning", "Reviewing changes");
    case "cancelling":
      return t("reviewCancelling", "Stopping review");
    case "complete":
      return t("reviewComplete", "Review complete");
    case "partial":
      return t("reviewPartial", "Review partially complete");
    case "cancelled":
      return t("reviewCancelled", "Review cancelled");
    case "failed":
      return t("reviewFailed", "Review failed");
    case "skipped":
      return t("reviewEmptyScope", "No reviewable changes");
    default:
      return t("reviewIdle", "Idle");
  }
}

export function severityText(severity: ReviewFinding["severity"], t: Translate) {
  switch (severity) {
    case "critical":
      return t("reviewSeverityCritical", "Critical");
    case "high":
      return t("reviewSeverityHigh", "High");
    case "medium":
      return t("reviewSeverityMedium", "Medium");
    case "low":
      return t("reviewSeverityLow", "Low");
    default:
      return t("reviewSeverityUnknown", "Unrated");
  }
}

export function exclusionText(reason: string | undefined, t: Translate) {
  switch (reason) {
    case "user_exclude":
    case "default_path":
    case "provider_directory":
      return t("reviewReasonRule", "Excluded by review rules");
    case "unsupported_ext":
      return t("reviewReasonExtension", "Unsupported file type");
    case "secret_exclude":
      return t("reviewReasonSecret", "Credential file");
    case "deleted":
      return t("reviewReasonDeleted", "Deleted file");
    case "binary":
      return t("reviewReasonBinary", "Binary file");
    case "too_large":
      return t("reviewReasonLarge", "File exceeds the review limit");
    default:
      return t("reviewExcluded", "Excluded");
  }
}

export function reviewScopeText(scope: ReviewScope, t: Translate) {
  switch (scope.kind) {
    case "workspace":
      return t("reviewWorkingChanges", "Uncommitted changes");
    case "branch":
      return `${scope.from} → ${scope.to || "HEAD"}`;
    case "commit":
      return `${t("reviewCommitRef", "Commit ref")} · ${scope.ref}`;
    case "scan":
      return scope.paths || t("reviewScan", "Scan files");
  }
}
