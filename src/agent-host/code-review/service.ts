import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ReviewCommand,
  ReviewCommandOutput,
  ReviewConfigSnapshot,
  ReviewDiffRequest,
  ReviewHistoryRef,
  ReviewMcpSnapshot,
  ReviewModelSelection,
  ReviewPreview,
  ReviewRequest,
  ReviewRun,
} from "../../contract/code-review";
import {
  configSnapshot,
  projectReviewConfig,
  readReviewSettings,
  reviewEngineStatus,
  updateReviewSettings,
  writeReviewSettings,
  type ReviewSettings,
} from "./config";
import { assertPathAllowed } from "../path-authorization";
import { desktopDataRoot } from "../desktop-data-root";
import { callMain } from "../parent-rpc";
import { issueFromDiagnostics, parsePreview, parseReview, ReviewError } from "./output";
import { resolveReviewModel, withReviewGateway } from "./model-gateway";
import { runOcr } from "./runner";
import { relativePath, prepareScope, reviewOptionArgs, scopeFingerprint, sessionId, workspaceDiff } from "./scope";
import { privateEnvironment, resolveReviewFile, resolveWorkspace } from "./workspace";
import { getCommandSpec } from "./commands";
import { listReviewBranches } from "./branches";
import { prepareReviewMcp, readReviewMcp, writeReviewMcp } from "./mcp";
import { deleteReport, formatReport, MAX_REPORT_BYTES, readReport, reportFromSession, saveReport } from "./export";
import { ReviewActivityLog } from "./activity";
import { NativeReviewActivity } from "./native-activity";
import {
  deleteHistoryBySession,
  historyPage,
  listHistoryArchives,
  readHistoryArchive,
  readHistoryDiff,
  readHistoryEntries,
  ReviewHistoryWriter,
} from "./history-store";
import { legacyHistoryRows, legacyRun } from "./history-legacy";

type PreviewSnapshot = { preview: ReviewPreview; hash: string; request: ReviewRequest };
type Activity = { log: ReviewActivityLog; native?: NativeReviewActivity };
type Task = {
  run: ReviewRun;
  snapshot: PreviewSnapshot;
  controller: AbortController;
  promise: Promise<void>;
  activity: Activity;
};
type Viewer = { controller: AbortController; promise: Promise<void>; ready: Promise<string> };

export class CodeReviewService {
  private readonly closing = new AbortController();
  private readonly previews = new Map<string, PreviewSnapshot>();
  private latest: Task | null = null;
  private starting = false;
  private initialCleanup?: Promise<void>;
  private viewer: Viewer | null = null;
  private latestReport: { runId: string; text: string } | null = null;
  private configWrite = Promise.resolve();
  private savedActivity?: { id: string; value: ReturnType<typeof readHistoryEntries> };
  private legacyActivity?: { key: string; value: ReturnType<CodeReviewService["loadLegacyHistory"]> };

  private async storage() {
    const root = path.join(desktopDataRoot(), "code-review");
    const home = path.join(root, "engine");
    await (this.initialCleanup ??= (async () => {
      await mkdir(home, { recursive: true, mode: 0o700 });
      await projectReviewConfig(home, await readReviewSettings(home));
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^run-[a-z0-9]{6}$/iu.test(entry.name)) {
          await rm(path.join(root, entry.name), { recursive: true, force: true });
        }
      }
    })());
    return { home, root };
  }

  private async withReport<T>(operation: (file: string) => Promise<T>) {
    const { root } = await this.storage();
    const directory = await mkdtemp(path.join(root, "run-"));
    try {
      return await operation(path.join(directory, "report.json"));
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  private async runtime() {
    try {
      return await callMain<{ executable: string; version: string }>("ocr.runtime");
    } catch {
      throw new ReviewError("runtime");
    }
  }

  private withConfigWrite<T>(operation: () => Promise<T>) {
    const write = this.configWrite.then(operation);
    this.configWrite = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  async branches(cwd: string) {
    const { home } = await this.storage();
    return listReviewBranches(await resolveWorkspace(cwd, home, this.closing.signal));
  }

  async getConfig() {
    return configSnapshot(await readReviewSettings((await this.storage()).home));
  }

  async engineStatus() {
    return reviewEngineStatus(await readReviewSettings((await this.storage()).home));
  }

  async saveConfig(input: ReviewConfigSnapshot) {
    if (this.running) throw new ReviewError("busy");
    return this.withConfigWrite(async () => {
      if (this.running) throw new ReviewError("busy");
      const { home } = await this.storage();
      const settings = updateReviewSettings(await readReviewSettings(home), input);
      await this.commitConfig(home, settings);
      return { ...configSnapshot(settings), status: reviewEngineStatus(settings) };
    });
  }

  private async commitConfig(home: string, settings: ReviewSettings) {
    await projectReviewConfig(home, settings);
    try {
      await writeReviewSettings(home, settings);
    } catch (error) {
      await projectReviewConfig(home, await readReviewSettings(home));
      throw error;
    }
    this.previews.clear();
  }

  async getMcp() {
    return readReviewMcp((await this.storage()).home);
  }

  private get running() {
    return this.starting || this.latest?.run.state === "running" || this.latest?.run.state === "cancelling";
  }

  async saveMcp(input: ReviewMcpSnapshot) {
    if (this.running) throw new ReviewError("busy");
    return this.withConfigWrite(async () => {
      if (this.running) throw new ReviewError("busy");
      const { home } = await this.storage();
      const result = await writeReviewMcp(home, input);
      await projectReviewConfig(home, await readReviewSettings(home));
      return result;
    });
  }

  private async prepare(request: ReviewRequest, signal: AbortSignal) {
    const { home } = await this.storage();
    const workspace = await resolveWorkspace(request?.cwd, home, signal, request?.scope?.kind !== "scan");
    const scope = await prepareScope(workspace, request.scope);
    const options = await reviewOptionArgs(workspace, scope, request.options);
    return { workspace, scope, options };
  }

  private async loadPreview(
    executable: string,
    prepared: Awaited<ReturnType<CodeReviewService["prepare"]>>,
    signal: AbortSignal,
  ) {
    const { workspace, scope, options } = prepared;
    const result = await runOcr({
      executable,
      cwd: workspace.root,
      env: workspace.env,
      signal,
      args: [
        ...scope.args,
        ...options.preview,
        "--repo",
        workspace.root,
        "--preview",
        "--format",
        "json",
        "--audience",
        "agent",
      ],
    });
    if (result.code !== 0) throw new ReviewError(issueFromDiagnostics(result.stderr));
    return parsePreview(result.stdout);
  }

  async preview(request: ReviewRequest) {
    const { executable, version } = await this.runtime();
    const signal = this.closing.signal;
    const prepared = await this.prepare(request, signal);
    const files = await this.loadPreview(executable, prepared, signal);
    const hash = await scopeFingerprint(prepared.workspace, prepared.scope, files, signal);
    const preview: ReviewPreview = {
      id: randomUUID(),
      root: prepared.workspace.root,
      version,
      scope: prepared.scope.scope,
      diffScope: prepared.scope.diffScope,
      files,
    };
    for (const [id, existing] of this.previews) {
      if (existing.request.cwd === request.cwd || this.previews.size >= 12) this.previews.delete(id);
    }
    this.previews.set(preview.id, { preview, hash, request });
    return preview;
  }

  async diff(request: ReviewDiffRequest) {
    const { workspace, scope } = await this.prepare(request, this.closing.signal);
    return workspaceDiff(workspace, scope, request.path);
  }

  async testModel(cwd: string, selection: ReviewModelSelection) {
    await assertPathAllowed(cwd);
    return this.withConfigWrite(async () => {
      if (this.running) throw new ReviewError("busy");
      const { executable } = await this.runtime();
      const { home } = await this.storage();
      const signal = this.closing.signal;
      const provider = await resolveReviewModel(cwd, selection);
      await projectReviewConfig(home, await readReviewSettings(home));
      return withReviewGateway(provider, signal, async (gateway) => {
        const result = await runOcr({
          executable,
          args: ["llm", "test"],
          cwd: home,
          env: { ...privateEnvironment(home), ...gateway.env },
          signal,
        });
        if (result.code !== 0) throw new ReviewError(issueFromDiagnostics(result.stderr + result.stdout));
        return null;
      });
    });
  }

  async start(previewId: string, selection: ReviewModelSelection) {
    if (this.running) {
      throw new ReviewError("busy");
    }
    const snapshot = this.previews.get(previewId);
    if (!snapshot) throw new ReviewError("stalePreview");
    this.starting = true;
    try {
      await this.configWrite;
      if (!this.previews.has(previewId)) throw new ReviewError("stalePreview");
      const provider = await resolveReviewModel(snapshot.request.cwd, selection);
      const { executable } = await this.runtime();
      const signal = this.closing.signal;
      const prepared = await this.prepare(snapshot.request, signal);
      const hash = await scopeFingerprint(prepared.workspace, prepared.scope, snapshot.preview.files, signal);
      if (prepared.workspace.root !== snapshot.preview.root || hash !== snapshot.hash)
        throw new ReviewError("stalePreview");
      const [projectRoot, worktreeBranch] = await Promise.all([
        prepared.workspace.git(["worktree", "list", "--porcelain", "-z"]).then(
          (out) => /^worktree ([^\0]+)\0/u.exec(out.toString("utf8"))?.[1],
          () => undefined,
        ),
        prepared.workspace.git(["branch", "--show-current"]).then(
          (out) => out.toString("utf8").trim() || undefined,
          () => undefined,
        ),
      ]);
      signal.throwIfAborted();
      const run: ReviewRun = {
        id: randomUUID(),
        root: snapshot.preview.root,
        projectRoot,
        request: snapshot.request,
        scope: snapshot.preview.scope,
        diffScope: snapshot.preview.diffScope,
        files: snapshot.preview.files,
        state: "running",
        startedAt: Date.now(),
        model: provider.model.name,
        contextWindow: provider.model.contextWindow > 0 ? provider.model.contextWindow : undefined,
        worktreeBranch,
        findings: [],
        warningCount: 0,
      };
      const controller = new AbortController();
      this.previews.delete(previewId);
      this.latestReport = null;
      const activity = { log: new ReviewActivityLog() };
      const promise = this.execute(run, snapshot, executable, provider, controller.signal, activity);
      this.latest = { run, snapshot, controller, promise, activity };
      return structuredClone(run);
    } finally {
      this.starting = false;
    }
  }

  private async execute(
    run: ReviewRun,
    snapshot: PreviewSnapshot,
    executable: string,
    provider: Awaited<ReturnType<typeof resolveReviewModel>>,
    signal: AbortSignal,
    activity: Activity,
  ) {
    let archive: ReviewHistoryWriter | undefined;
    let outcome: Partial<ReviewRun> = {};
    try {
      const { home } = await this.storage();
      archive = await ReviewHistoryWriter.create(home, run).catch(() => undefined);
      if (archive) activity.log.onSettled = (entry) => archive?.record(entry);
      const report = await this.withReport(async (file) => {
        const prepared = await this.prepare(snapshot.request, signal);
        const { workspace, scope, options } = prepared;
        if (
          workspace.root !== run.root ||
          (await scopeFingerprint(workspace, scope, run.files, signal)) !== snapshot.hash ||
          JSON.stringify(await this.loadPreview(executable, prepared, signal)) !== JSON.stringify(run.files)
        ) {
          throw new ReviewError("stalePreview");
        }
        const savedSnapshot = archive
          ? await archive.capture(workspace, scope, run.files, signal).then(
              () => true,
              () => false,
            )
          : false;
        signal.throwIfAborted();
        if (
          archive &&
          savedSnapshot &&
          (await scopeFingerprint(workspace, scope, run.files, signal)) !== snapshot.hash
        ) {
          await archive.invalidateSnapshot();
          throw new ReviewError("stalePreview");
        }
        const mcp =
          scope.scope.kind === "scan"
            ? { env: workspace.env, ranSetup: false }
            : await this.withConfigWrite(() => prepareReviewMcp(home, workspace, signal));
        if (mcp.ranSetup && (await scopeFingerprint(workspace, scope, run.files, signal)) !== snapshot.hash) {
          await archive?.invalidateSnapshot();
          throw new ReviewError("stalePreview");
        }
        await projectReviewConfig(home, await readReviewSettings(home));
        activity.native = await NativeReviewActivity.start(home, workspace.root, activity.log);
        return withReviewGateway(
          provider,
          signal,
          async (gateway) => {
            const stderr = activity.log.stderr();
            const result = await runOcr({
              executable,
              cwd: workspace.root,
              env: { ...mcp.env, ...gateway.env },
              signal,
              onStderr: stderr.write,
              args: [
                ...scope.args,
                ...options.preview,
                ...options.execution,
                "--repo",
                workspace.root,
                "--format",
                "json",
                "--audience",
                "human",
                "--output",
                file,
                "--color",
                "never",
              ],
            }).finally(stderr.flush);
            const output = await stat(file).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
            if (output && output.size > MAX_REPORT_BYTES) throw new ReviewError("scopeLimit");
            const raw = output ? await readFile(file, "utf8") : "";
            const text = activity.log.redactReport(raw);
            activity.log.reportWarnings(text);
            const parsed = parseReview(text, result.code, result.stderr, "");
            const stale = await scopeFingerprint(workspace, scope, run.files, signal).then(
              (hash) => hash !== snapshot.hash,
              () => true,
            );
            const mcpWarning = /^\[ocr\] WARNING: .*MCP server/mu.test(result.stderr);
            return { parsed: { ...parsed, stale, mcpWarning }, text, home };
          },
          activity.log,
        );
      });
      signal.throwIfAborted();
      this.latestReport = { runId: run.id, text: report.text };
      if (report.parsed.sessionId) {
        // The native session remains exportable if recording the full JSON fails.
        await saveReport(report.home, run.root, report.parsed.sessionId, report.text).catch(() => undefined);
      }
      signal.throwIfAborted();
      outcome = report.parsed;
    } catch (error) {
      outcome = signal.aborted
        ? { state: "cancelled" }
        : { state: "failed", issue: error instanceof ReviewError ? error.issue : "failed" };
    } finally {
      const completed = { ...run, ...outcome, finishedAt: Date.now() };
      do {
        await activity.native?.read(completed.sessionId);
      } while (activity.native?.more);
      completed.activityStats = activity.log.stats();
      if (archive) {
        activity.log.onSettled = undefined;
        await archive.finish(completed, activity.log.pendingEntries()).catch(() => {
          activity.log.warning("Serphia could not save the complete review history.");
        });
      } else activity.log.warning("Serphia could not save this review to history.");
      Object.assign(run, completed);
    }
  }

  getRun(id?: string) {
    const run = this.latest?.run;
    return run && (id === undefined || run.id === id) ? structuredClone(run) : null;
  }

  async activity(id: string, after = 0) {
    const task = this.latest;
    if (!task || task.run.id !== id || !Number.isSafeInteger(after) || after < 0) return null;
    await task.activity.native?.read(task.run.sessionId);
    const page = task.activity.log.page(after);
    return { ...page, more: page.more || Boolean(task.activity.native?.more) };
  }

  async listHistory(cwd?: string, limit = 40, offset = 0) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0)
      throw new ReviewError("scopeLimit");
    const { home } = await this.storage();
    const active = this.latest?.run.finishedAt ? undefined : this.latest?.run.id;
    const rows = await listHistoryArchives(home, active);
    if (cwd) {
      const signal = this.closing.signal;
      const workspace = await resolveWorkspace(cwd, home, signal, false).catch(() => null);
      if (workspace) {
        const native = await this.runtime()
          .then(({ executable }) =>
            runOcr({
              executable,
              cwd: workspace.root,
              env: workspace.env,
              signal,
              args: ["session", "list", "--json", "--limit", "0", "--repo", workspace.root, "--color", "never"],
            }),
          )
          .catch(() => null);
        if (native?.code === 0) {
          const seen = new Set(rows.filter((row) => row.root === workspace.root).map((row) => row.sessionId));
          if (this.latest?.run.id === active) seen.add(this.latest?.activity.native?.sessionId);
          rows.push(...legacyHistoryRows(workspace.root, native.stdout).filter((row) => !seen.has(row.sessionId)));
        }
      }
    }
    return rows
      .sort((a, b) => b.startedAt - a.startedAt || JSON.stringify(a.ref).localeCompare(JSON.stringify(b.ref)))
      .slice(offset, offset + limit);
  }

  private async loadLegacyHistory(ref: Extract<ReviewHistoryRef, { sessionId: string }>) {
    const { home } = await this.storage();
    const { root } = await resolveWorkspace(ref.cwd, home, this.closing.signal, false);
    const id = sessionId(ref.sessionId);
    const [detail, comments, report] = await Promise.all([
      this.command({ kind: "sessionShow", cwd: root, id }),
      this.command({ kind: "sessionComments", cwd: root, id }),
      readReport(home, root, id),
    ]);
    const log = new ReviewActivityLog();
    const scanPaths = await NativeReviewActivity.history(home, root, id, log);
    if (report) log.reportWarnings(report);
    const entries = [];
    let after = 0;
    for (;;) {
      const page = log.page(after);
      entries.push(...page.entries);
      if (!page.more) break;
      after = page.cursor;
    }
    return {
      run: legacyRun(root, id, detail.text, comments.text, report, scanPaths),
      entries,
      truncated: log.truncated,
      stats: log.stats(),
    };
  }

  private getLegacyHistory(ref: Extract<ReviewHistoryRef, { sessionId: string }>) {
    const key = JSON.stringify([ref.cwd, ref.sessionId]);
    if (this.legacyActivity?.key === key) return this.legacyActivity.value;
    const value = this.loadLegacyHistory(ref).catch((error) => {
      if (this.legacyActivity?.key === key) this.legacyActivity = undefined;
      throw error;
    });
    this.legacyActivity = { key, value };
    return value;
  }

  async openHistory(ref: ReviewHistoryRef) {
    if ("archiveId" in ref) {
      const { home } = await this.storage();
      const { run, snapshot } = await readHistoryArchive(home, ref.archiveId);
      if (!run.finishedAt) {
        this.assertArchived(run.id);
        run.state = "cancelled";
        run.finishedAt = run.startedAt;
      }
      return { ref, run, snapshot, legacy: false };
    }
    const { run } = await this.getLegacyHistory(ref);
    return { ref, run, snapshot: "unavailable" as const, legacy: true };
  }

  async historyDiff(ref: ReviewHistoryRef, file: string) {
    if (!("archiveId" in ref)) return null;
    this.assertArchived(ref.archiveId);
    return readHistoryDiff((await this.storage()).home, ref.archiveId, file);
  }

  private assertArchived(id: string) {
    if (this.latest?.run.id === id && !this.latest.run.finishedAt) throw new ReviewError("busy");
  }

  async historyActivity(ref: ReviewHistoryRef, after = 0) {
    if (!("archiveId" in ref)) {
      const { entries, truncated, stats } = await this.getLegacyHistory(ref);
      return historyPage(entries, after, truncated, stats);
    }
    this.assertArchived(ref.archiveId);
    const { home } = await this.storage();
    if (this.savedActivity?.id !== ref.archiveId) {
      const id = ref.archiveId;
      const value = readHistoryEntries(home, id).catch((error) => {
        if (this.savedActivity?.id === id) this.savedActivity = undefined;
        throw error;
      });
      this.savedActivity = { id, value };
    }
    const { entries, truncated, stats } = await this.savedActivity.value;
    return historyPage(entries, after, truncated, stats);
  }

  cancel(id: string) {
    if (this.latest?.run.id === id && this.latest.run.state === "running") {
      this.latest.run.state = "cancelling";
      this.latest.controller.abort();
    }
    return this.getRun(id);
  }

  async locateFinding(id: string, findingId: number) {
    const task = this.latest;
    const finding = task?.run.id === id && task.run.findings.find((entry) => entry.id === findingId);
    if (!task || !finding || !task.run.files.some((file) => file.included && file.path === finding.path)) {
      throw new ReviewError("notRepository");
    }
    const file = await resolveReviewFile(task.run.root, finding.path);
    await assertPathAllowed(file);
    const signal = this.closing.signal;
    task.run.stale ||= await this.prepare(task.snapshot.request, signal)
      .then(
        async ({ workspace, scope }) =>
          workspace.root !== task.run.root ||
          (await scopeFingerprint(workspace, scope, task.run.files, signal)) !== task.snapshot.hash,
      )
      .catch(() => true);
    const historical = task.run.scope.kind === "branch" || task.run.scope.kind === "commit";
    return {
      path: file,
      root: task.run.root,
      line: task.run.stale || historical ? null : finding.line,
      stale: !!task.run.stale,
    };
  }

  async command(command: ReviewCommand): Promise<ReviewCommandOutput> {
    if (command?.kind === "viewerStop") {
      this.viewer?.controller.abort();
      await this.viewer?.promise;
      return { text: "" };
    }
    if (command?.kind === "engineConfig") {
      if (this.running) throw new ReviewError("busy");
      getCommandSpec(command);
      return this.withConfigWrite(async () => {
        if (this.running) throw new ReviewError("busy");
        const { home } = await this.storage();
        const settings = await readReviewSettings(home);
        const snapshot = configSnapshot(settings);
        const config = JSON.parse(snapshot.text);
        const { key, value } = command;
        if (value === undefined) delete config[key];
        else config[key] = key === "max_tokens" ? Number(value) : value;
        await this.commitConfig(home, updateReviewSettings(settings, { ...snapshot, text: JSON.stringify(config) }));
        return { text: key };
      });
    }
    const { executable, version } = await this.runtime();
    const { home } = await this.storage();
    if (command?.kind === "viewer") return { text: "", viewerUrl: await this.openViewer(executable, home) };

    const signal = this.closing.signal;
    if (command?.kind === "sessionExport" && command.format && command.format !== "html") {
      if (!["text", "json", "sarif"].includes(command.format)) throw new ReviewError("failed");
      const workspace = await resolveWorkspace(command.cwd, home, signal, false);
      let raw: string | null = null;
      if (
        command.runId &&
        this.latest?.run.id === command.runId &&
        this.latest.run.finishedAt &&
        this.latest.run.root === workspace.root &&
        this.latestReport?.runId === command.runId
      ) {
        raw = this.latestReport.text;
      } else if (command.runId && !command.id) {
        throw new ReviewError("invalidOutput");
      }
      if (!raw) {
        const run = async (args: string[]) => {
          const result = await runOcr({
            executable,
            args: [...args, "--repo", workspace.root, "--color", "never"],
            cwd: workspace.root,
            env: workspace.env,
            signal,
          });
          if (result.code !== 0) throw new ReviewError(issueFromDiagnostics(result.stderr));
          return result.stdout;
        };
        const id = sessionId(
          command.id ?? JSON.parse(await run(["session", "list", "--json", "--limit", "1"]))?.[0]?.session_id,
        );
        raw = await readReport(home, workspace.root, id);
        if (!raw) {
          const detail = await run(["session", "show", "--json", id]);
          raw = reportFromSession(detail, await run(["session", "comments", "--json", id]));
        }
      }
      return formatReport(raw, command.format, version);
    }
    if (command?.kind === "delegatePreview" || command?.kind === "delegateRule") {
      const { workspace, scope, options } = await this.prepare(command.request, signal);
      if (scope.scope.kind === "scan") throw new ReviewError("failed");
      const format = command.format ?? "json";
      if (format !== "json" && format !== "text") throw new ReviewError("failed");
      const args = [
        "delegate",
        command.kind === "delegatePreview" ? "preview" : "rule",
        ...scope.args.slice(1),
        ...options.delegate,
        "--repo",
        workspace.root,
        "--format",
        format,
      ];
      if (command.kind === "delegateRule") {
        if (typeof command.files !== "string" || command.files.length > 4096) throw new ReviewError("scopeLimit");
        args.push("--", ...command.files.split(",").map((file) => relativePath(file.trim())));
      }
      const result = await runOcr({
        executable,
        args,
        cwd: workspace.root,
        env: workspace.env,
        signal,
      });
      if (result.code !== 0) throw new ReviewError(issueFromDiagnostics(result.stderr));
      return {
        text: result.stdout,
        filename: `ocr-${command.kind === "delegatePreview" ? "preview" : "rules"}.${format === "json" ? "json" : "txt"}`,
      };
    }

    const spec = getCommandSpec(command);
    const workspace = "cwd" in spec ? await resolveWorkspace(spec.cwd, home, signal, false) : null;
    if (spec.rule && workspace) {
      spec.args.push("--rule", await resolveReviewFile(workspace.root, relativePath(spec.rule)));
    }
    if (workspace) spec.args.push("--repo", workspace.root);
    spec.args.push("--color", "never");
    if (spec.file) spec.args.push("--", relativePath(spec.file));
    const invoke = () =>
      runOcr({
        executable,
        args: spec.args,
        cwd: workspace?.root ?? home,
        env: workspace?.env ?? privateEnvironment(home),
        signal,
      });
    const result = await invoke();
    if (result.code !== 0) throw new ReviewError(issueFromDiagnostics(result.stderr));
    if (command.kind === "sessionDelete" && workspace) {
      await deleteReport(home, workspace.root, command.id);
      await deleteHistoryBySession(home, workspace.root, command.id);
      this.savedActivity = undefined;
      this.legacyActivity = undefined;
    }
    return { text: result.stdout, filename: spec.filename };
  }

  private openViewer(executable: string, home: string) {
    if (this.viewer) return this.viewer.ready;
    const controller = new AbortController();
    const signal = AbortSignal.any([this.closing.signal, controller.signal]);
    let resolve!: (url: string) => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<string>((onReady, onError) => {
      resolve = onReady;
      reject = onError;
    });
    let stdout = "";
    const promise = runOcr({
      executable,
      args: ["viewer", "--addr", "127.0.0.1:0", "--open", "never"],
      cwd: home,
      env: privateEnvironment(home),
      signal,
      onStdout: (chunk) => {
        stdout = (stdout + chunk.toString("utf8")).slice(-4096);
        const url = /Viewer ready: (http:\/\/127\.0\.0\.1:\d{1,5})(?:\s|$)/u.exec(stdout)?.[1];
        if (url) resolve(url);
      },
    })
      .then(
        () => reject(new ReviewError("failed")),
        () => reject(new ReviewError("failed")),
      )
      .finally(() => {
        this.viewer = null;
      });
    this.viewer = { controller, promise, ready };
    return ready;
  }

  async shutdown() {
    this.closing.abort();
    this.latest?.controller.abort();
    await Promise.allSettled([this.latest?.promise, this.viewer?.promise]);
  }
}
