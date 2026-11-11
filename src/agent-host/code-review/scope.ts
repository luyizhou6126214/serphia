import { readFile, stat } from "node:fs/promises";
import {
  REVIEW_OPTION_DEFAULTS,
  type ReviewFile,
  type ReviewOptions,
  type ReviewScope,
} from "../../contract/code-review";
import { ReviewError } from "./output";
import { fingerprint, resolveReviewFile, resolveWorkspace } from "./workspace";

export type Workspace = Awaited<ReturnType<typeof resolveWorkspace>>;
export type PreparedScope = {
  scope: ReviewScope;
  diffScope?: ReviewScope;
  args: string[];
  base?: string;
  head?: string;
};

function input(value: unknown, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\0\r\n]/u.test(value)) {
    throw new ReviewError("failed");
  }
  return value;
}

export function relativePath(value: unknown) {
  const candidate = input(value);
  if (
    /^(?:[\\/]|[a-z]:|-)/iu.test(candidate) ||
    candidate.split(/[\\/]/u).some((part) => part === ".." || part.toLowerCase() === ".git")
  ) {
    throw new ReviewError("notRepository");
  }
  return candidate;
}

export function sessionId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,126}$/iu.test(value)) throw new ReviewError("failed");
  return value;
}

async function resolveRef(workspace: Workspace, value: unknown) {
  const ref = input(value, 256);
  const sha = (await workspace.git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
    .toString("utf8")
    .trim();
  if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw new ReviewError("failed");
  return sha;
}

export async function prepareScope(workspace: Workspace, scope: ReviewScope): Promise<PreparedScope> {
  switch (scope?.kind) {
    case "workspace":
      return { scope, args: ["review"] };
    case "branch": {
      const from = await resolveRef(workspace, scope.from);
      const to = await resolveRef(workspace, scope.to || "HEAD");
      const base = (await workspace.git(["merge-base", from, to])).toString("utf8").trim();
      if (!/^[a-f0-9]{40,64}$/u.test(base)) throw new ReviewError("failed");
      return {
        scope: { ...scope, to: scope.to || "HEAD" },
        diffScope: { kind: "branch", from, to },
        args: ["review", "--from", from, "--to", to],
        base,
        head: to,
      };
    }
    case "commit": {
      const sha = await resolveRef(workspace, scope.ref);
      return { scope, diffScope: { kind: "commit", ref: sha }, args: ["review", "--commit", sha], head: sha };
    }
    case "scan": {
      const paths = scope.paths === undefined ? undefined : input(scope.paths).trim();
      if (!paths) return { scope: { kind: "scan" }, args: ["scan"] };
      if (paths.length > 4096) throw new ReviewError("scopeLimit");
      return {
        scope,
        args: [
          "scan",
          "--path",
          paths
            .split(",")
            .map((file) => relativePath(file.trim()))
            .join(","),
        ],
      };
    }
    default:
      throw new ReviewError("failed");
  }
}

export async function reviewOptionArgs(
  workspace: Workspace,
  prepared: PreparedScope,
  options: ReviewOptions | undefined,
) {
  const preview: string[] = [];
  const execution: string[] = [];
  const delegate: string[] = [];
  const scan = prepared.scope.kind === "scan";
  if (options?.background) {
    if (typeof options.background !== "string" || options.background.length > 8000 || options.background.includes("\0"))
      throw new ReviewError("scopeLimit");
    // The Windows process helper disallows newlines in arguments.
    preview.push("--background", options.background.replace(/[\r\n]+/gu, " "));
  }
  if (options?.exclude) preview.push("--exclude", input(options.exclude));
  if (options?.rule) preview.push("--rule", await resolveReviewFile(workspace.root, relativePath(options.rule)));
  if (options?.backgroundFile && !scan)
    preview.push("--background-file", await resolveReviewFile(workspace.root, relativePath(options.backgroundFile)));
  delegate.push(...preview);
  if (options?.tools) execution.push("--tools", await resolveReviewFile(workspace.root, relativePath(options.tools)));
  const maxTokens = options?.maxTokens ?? REVIEW_OPTION_DEFAULTS.maxTokens;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens > 2_000_000) throw new ReviewError("scopeLimit");
  preview.push("--max-tokens", String(maxTokens));
  for (const [key, value, maximum] of [
    ["concurrency", options?.concurrency ?? REVIEW_OPTION_DEFAULTS.concurrency, 32],
    ["max-git-procs", options?.maxGitProcs, 64],
    ["timeout", options?.timeout ?? REVIEW_OPTION_DEFAULTS.timeout, 60],
    ["max-tools", options?.maxTools ?? REVIEW_OPTION_DEFAULTS.maxTools, 500],
    ["max-tokens-budget", options?.maxTokensBudget ?? REVIEW_OPTION_DEFAULTS.maxTokensBudget, 2_000_000],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new ReviewError("scopeLimit");
    if (key === "max-git-procs") {
      preview.push(`--${key}`, String(value));
      delegate.push(`--${key}`, String(value));
    } else execution.push(`--${key}`, String(value));
  }
  if (options?.resume) {
    if (prepared.scope.kind === "workspace") throw new ReviewError("failed");
    execution.push("--resume", sessionId(options.resume));
  }
  const effort = options?.effort;
  if (!scan && effort && effort !== "auto") {
    if (!["low", "medium", "high"].includes(effort)) throw new ReviewError("failed");
    execution.push("--effort", effort);
  }
  if (scan && options?.batch) {
    if (!["none", "by-language", "by-directory"].includes(options.batch)) throw new ReviewError("failed");
    execution.push("--batch", options.batch);
  }
  if (scan && options?.noPlan === true) execution.push("--no-plan");
  if (scan && options?.noDedup === true) execution.push("--no-dedup");
  if (scan && options?.noSummary === true) execution.push("--no-summary");
  if (!scan && options?.noFilter === true) execution.push("--no-filter");
  return { preview, execution, delegate };
}

export function scopeFingerprint(
  workspace: Workspace,
  prepared: PreparedScope,
  files: ReviewFile[],
  signal: AbortSignal,
) {
  return prepared.head
    ? Promise.resolve(JSON.stringify(prepared.args))
    : fingerprint(workspace, files, signal, prepared.scope.kind !== "scan");
}

export async function workspaceDiff(workspace: Workspace, prepared: PreparedScope, value: string) {
  const file = relativePath(value);
  const cap = 256 * 1024;
  const flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"];
  let buffer: Buffer;
  if (prepared.scope.kind === "scan") {
    const target = await resolveReviewFile(workspace.root, file);
    if ((await stat(target)).size > cap) return { path: file, text: "", truncated: true };
    buffer = await readFile(target);
  } else if (prepared.scope.kind === "commit") {
    buffer = await workspace.git([
      "--literal-pathspecs",
      "show",
      "--format=",
      ...flags,
      "--diff-merges=first-parent",
      prepared.head!,
      "--",
      file,
    ]);
  } else if (prepared.scope.kind === "branch") {
    buffer = await workspace.git(["--literal-pathspecs", "diff", ...flags, prepared.base!, prepared.head!, "--", file]);
  } else {
    const head = await workspace.git(["rev-parse", "--verify", "HEAD"]).then(
      () => ["HEAD"],
      () => ["--staged"],
    );
    buffer = await workspace.git(["--literal-pathspecs", "diff", ...flags, ...head, "--", file]);
    if (!buffer.length && head[0] === "--staged") {
      buffer = await workspace.git(["--literal-pathspecs", "diff", ...flags, "--", file]);
    }
    if (
      !buffer.length &&
      (await workspace.git(["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", file]))
        .length
    ) {
      const target = await resolveReviewFile(workspace.root, file);
      if ((await stat(target)).size > cap) return { path: file, text: "", truncated: true };
      const content = await readFile(target, "utf8");
      const lines = content.replace(/\n$/u, "").split("\n");
      buffer = Buffer.from(`@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => "+" + line).join("\n")}\n`);
    }
  }
  return { path: file, text: buffer.subarray(0, cap).toString("utf8"), truncated: buffer.length > cap };
}
