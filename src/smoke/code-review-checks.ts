import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { devNull } from "node:os";
import path from "node:path";
import type { ApiMethod, ApiParams, ApiResult } from "../contract/api";
import type { ReviewHistoryRef, ReviewModelSelection, ReviewReply, ReviewRequest } from "../contract/code-review";
import type { HostManager } from "../main/host-manager";

const unwrap = <T>(result: ReviewReply<T>) => {
  if (!result.ok) throw new Error(`Review smoke failed: ${result.issue}`);
  return result.value;
};

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 18_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 65));
  }
  throw new Error("Timed out waiting for the review smoke state");
}

export async function runCodeReviewChecks(
  manager: HostManager,
  userData: string,
  expectHostCrash: (expected: boolean) => void,
) {
  const call = <M extends ApiMethod>(method: M, params?: ApiParams<M>) =>
    manager.call<ApiResult<M>>(method, params, 35_000);
  await waitFor(
    async () => manager.getToolchainAckRevision(),
    (revision) => revision >= 0,
  );
  if (process.platform === "win32") {
    await waitFor(async () => manager.getManagedProcessOwnerState().ready, Boolean);
  }
  const root = path.join(userData, "Code Review 项目");
  await mkdir(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull },
      windowsHide: true,
    });
  git("init", "-q");
  const file = path.join(root, "math.ts");
  await writeFile(file, "export const value = 1;\n");
  git("add", "math.ts");
  git(
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "user.name=Fixture",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "base",
  );
  await writeFile(file, "export const value = 2;\n");
  await writeFile(path.join(root, ".env"), "NOT_A_REAL_SECRET=fixture\n");
  assert.equal((await call("system.validateCwd", { path: root })).ok, true);
  const workspace: ReviewRequest = { cwd: root, scope: { kind: "workspace" } };
  const preview = async (request = workspace) => unwrap(await call("codeReview.preview", request));
  const engineConfigDir = path.join(userData, "code-review", "engine", ".opencodereview");
  await mkdir(engineConfigDir, { recursive: true });
  const legacyConfig = {
    provider: "fixture.provider",
    model: "old-model",
    custom_providers: { "fixture.provider": { api_key: "old-fixture-key" } },
    LLM: { auth_token: "old-fixture-token" },
    telemetry: { enabled: false },
  };
  const settingsFile = path.join(engineConfigDir, "serphia-config.json");
  const runtimeFile = path.join(engineConfigDir, "config.json");
  await writeFile(settingsFile, JSON.stringify({ source: "ocr", config: legacyConfig }));
  await writeFile(runtimeFile, JSON.stringify(legacyConfig));
  const first = await preview();
  assert.equal(first.root, await realpath(root));
  assert.ok(first.files.some((entry) => entry.path === "math.ts" && entry.included));
  assert.ok(!first.files.some((entry) => entry.path === ".env" && entry.included));

  assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), { config: { telemetry: { enabled: false } } });
  assert.deepEqual(JSON.parse(await readFile(runtimeFile, "utf8")), {
    language: "中文",
    effort: "low",
    telemetry: { enabled: false },
  });

  let mode: "success" | "finding" | "auth" | "hold" = "success";
  let requests = 0;
  let closed = 0;
  const observedTools = new Set<string>();
  let remoteMcpCalls = 0;
  const apiKey = "ocr-smoke-key";
  let sawChinese = false;
  const model = "smoke-review-model";
  const provider = "ocr-smoke";
  const selection: ReviewModelSelection = { provider, modelId: model, thinking: "high" };
  const observedThinking = new Set<string>();
  async function respond(req: IncomingMessage, res: ServerResponse) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.url === "/mcp") {
        assert.equal(req.headers.authorization, "Bearer mcp-fixture-key");
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (input.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        const result =
          input.method === "initialize"
            ? {
                protocolVersion: input.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: "review-remote", version: "1" },
              }
            : input.method === "tools/list"
              ? {
                  tools: [{ name: "review_remote_lookup", inputSchema: { type: "object", properties: {} } }],
                }
              : { content: [{ type: "text", text: "MCP review fixture" }] };
        if (input.method === "tools/call") remoteMcpCalls++;
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
        return;
      }
      requests++;
      res.once("close", () => {
        closed++;
      });
      if (req.headers.authorization !== `Bearer ${apiKey}` || mode === "auth") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid api key", type: "invalid_request_error" } }));
        return;
      }
      assert.equal(req.headers["x-stainless-timeout"], undefined);
      if (mode === "hold") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.flushHeaders();
        res.write(
          "data: " +
            JSON.stringify({
              id: "chatcmpl-review-stream",
              created: 1,
              model,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: "Reviewing the source",
                    reasoning_content: "Checking the changed lines",
                  },
                  finish_reason: null,
                },
              ],
            }) +
            "\n\n",
        );
        return;
      }
      const rawRequest = Buffer.concat(chunks).toString("utf8");
      const input = JSON.parse(rawRequest);
      sawChinese ||= rawRequest.includes("中文");
      assert.equal(input.model, model);
      if (input.reasoning_effort) observedThinking.add(input.reasoning_effort);
      const tools = new Set<string>(
        (input.tools ?? []).flatMap((tool: { function?: { name?: string } }) =>
          tool.function?.name ? [tool.function.name] : [],
        ),
      );
      for (const name of tools) observedTools.add(name);
      const toolCalls: {
        id: string;
        index: number;
        type: "function";
        function: { name: string; arguments: string };
      }[] = [];
      const use = (name: string, args: Record<string, unknown>) =>
        toolCalls.push({
          id: `call_${name}`,
          index: toolCalls.length,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        });
      if (tools.has("task_done")) {
        if (tools.has("review_remote_lookup") && remoteMcpCalls === 0) {
          use("review_remote_lookup", {});
        } else {
          if (mode === "finding" && tools.has("code_comment")) {
            use("code_comment", {
              comments: [
                {
                  path: "math.ts",
                  content: "Check the expected constant in the public API.",
                  severity: "high",
                  category: "bug",
                  existing_code: "export const value = 3;",
                  suggestion_code: "export const value = 1;",
                },
              ],
            });
          }
          use("task_done", { state: "DONE" });
        }
      } else if (tools.has("approve_all_comments")) {
        use("approve_all_comments", {});
      }
      const message = toolCalls.length
        ? { role: "assistant", content: "Reviewing the changes", tool_calls: toolCalls }
        : { role: "assistant", content: "ok" };
      const finish_reason = toolCalls.length ? "tool_calls" : "stop";
      const common = { id: "chatcmpl-smoke", created: 1, model };
      const usage = {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 4 },
      };
      if (input.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = { ...common, object: "chat.completion.chunk" };
        res.end(
          [
            { ...chunk, choices: [{ index: 0, delta: message, finish_reason: null }] },
            { ...chunk, choices: [{ index: 0, delta: {}, finish_reason }] },
            { ...chunk, choices: [], usage },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("") + "data: [DONE]\n\n",
        );
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...common,
            object: "chat.completion",
            choices: [{ index: 0, message, finish_reason }],
            usage,
          }),
        );
      }
    } catch {
      res.destroy();
    }
  }
  const server = createServer((req, res) => void respond(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const emptyMcp = unwrap(await call("codeReview.mcp.get"));
    assert.equal(emptyMcp.text, "{}");
    const runtime = process.env.PI_DESKTOP_RUNTIME_PROBE_NODE;
    assert.ok(runtime);
    const fixture = path.join(userData, "ocr-mcp-fixture.cjs");
    await writeFile(
      fixture,
      `
const fs = require("node:fs");
if (!fs.existsSync("math.ts")) process.exit(1);
require("node:readline").createInterface({input:process.stdin}).on("line", line => {
  const r = JSON.parse(line);
  if (r.id === undefined) return;
  const result = r.method === "initialize"
    ? {protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"review-local",version:"1"}}
    : {tools:[{name:"review_local_lookup",inputSchema:{type:"object",properties:{}}}]};
  console.log(JSON.stringify({jsonrpc:"2.0",id:r.id,result}));
});
`,
    );
    const mcpConfig = JSON.stringify({
      remote: {
        type: "remote",
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { Authorization: "Bearer mcp-fixture-key" },
        tools: ["review_remote_lookup"],
      },
      local: {
        type: "stdio",
        command: runtime,
        args: [fixture],
        env: ["OCR_SMOKE_MCP=1"],
        tools: ["review_local_lookup"],
        setup: process.platform === "win32" ? "if not exist math.ts exit /b 1" : "test -f math.ts",
      },
    });
    const savedMcp = unwrap(await call("codeReview.mcp.save", { ...emptyMcp, text: mcpConfig }));
    assert.deepEqual(JSON.parse(savedMcp.text), JSON.parse(mcpConfig));
    assert.deepEqual(unwrap(await call("codeReview.mcp.get")), savedMcp);
    assert.deepEqual(await call("codeReview.mcp.save", emptyMcp), { ok: false, issue: "mcpChanged" });
    assert.deepEqual(await call("codeReview.mcp.save", { ...savedMcp, text: "{invalid" }), {
      ok: false,
      issue: "mcpConfig",
    });
    const models = await call("modelsConfig.get");
    await call("modelsConfig.set", {
      expectedVersion: models.version,
      config: {
        ...models.config,
        providers: {
          ...(models.config.providers as Record<string, unknown> | undefined),
          [provider]: {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            models: [
              {
                id: model,
                name: "Review smoke model",
                reasoning: true,
                input: ["text"],
                contextWindow: 32000,
                maxTokens: 8000,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                compat: { supportsReasoningEffort: true },
              },
            ],
          },
        },
      },
    });
    await call("auth.setApiKey", { provider, key: apiKey });
    const config = unwrap(await call("codeReview.config.get"));
    assert.deepEqual(JSON.parse(config.text), { language: "中文", telemetry: { enabled: false } });
    const configText = JSON.stringify({
      language: "中文",
      telemetry: { enabled: false, exporter: "console" },
    });
    const stored = unwrap(await call("codeReview.config.save", { ...config, text: configText }));
    assert.deepEqual(await call("codeReview.config.save", config), { ok: false, issue: "configChanged" });
    assert.deepEqual(await call("codeReview.config.save", { ...stored, text: '{"LLM":{"timeout_sec":1}}' }), {
      ok: false,
      issue: "configInvalid",
    });
    assert.deepEqual(unwrap(await call("codeReview.mcp.get")), savedMcp);
    unwrap(await call("codeReview.testModel", { cwd: root, model: selection }));
    mode = "auth";
    assert.deepEqual(await call("codeReview.testModel", { cwd: root, model: selection }), {
      ok: false,
      issue: "authentication",
    });
    mode = "success";

    await writeFile(file, "export const value = 3;\n");
    assert.deepEqual(await call("codeReview.start", { previewId: first.id, model: selection }), {
      ok: false,
      issue: "stalePreview",
    });
    const next = await preview();
    const running = unwrap(await call("codeReview.start", { previewId: next.id, model: selection }));
    const readRun = (id: string) => call("codeReview.getRun", { id });
    const finished = await waitFor(
      () => readRun(running.id),
      (run) => !!run?.finishedAt,
    ).catch((error: unknown) => {
      throw new Error(
        `OCR MCP fixture did not finish: ${requests} model requests, ${remoteMcpCalls} MCP calls, tools: ${[...observedTools]}`,
        { cause: error },
      );
    });
    assert.equal(finished?.state, "complete", JSON.stringify(finished));
    assert.ok(sawChinese);
    assert.equal(finished?.findings.length, 0);
    assert.ok(observedThinking.has("high"), JSON.stringify([...observedThinking]));
    assert.ok(observedTools.has("review_remote_lookup"));
    assert.ok(observedTools.has("review_local_lookup"));
    assert.ok(remoteMcpCalls > 0);
    const activity = await call("codeReview.activity", { id: running.id });
    const totals = activity?.stats;
    assert.ok(totals && totals.modelCalls > 0 && totals.toolCalls > 0);
    assert.equal(totals.inputTokens, totals.modelCalls * 12);
    assert.equal(totals.outputTokens, totals.modelCalls * 3);
    assert.equal(totals.cacheReadTokens, totals.modelCalls * 4);
    assert.equal(totals.cacheWriteTokens, 0);
    assert.deepEqual(totals.context, { tokens: 15, window: finished.contextWindow });
    assert.deepEqual(finished.activityStats, totals);
    assert.ok(
      activity?.entries.some(
        (entry) =>
          entry.kind === "model" &&
          entry.status === "done" &&
          entry.text.includes("Reviewing the changes") &&
          entry.outputTokens,
      ),
    );
    assert.ok(
      activity?.entries.some((entry) => entry.kind === "engine" && /reviewing \d+/iu.test(entry.message)),
      JSON.stringify(activity?.entries.map((entry) => entry.kind)),
    );
    const remoteActivity = activity?.entries.filter(
      (entry) => entry.kind === "tool" && entry.name === "review_remote_lookup",
    );
    assert.equal(remoteActivity?.length, 1);
    assert.ok(remoteActivity[0].kind === "tool" && remoteActivity[0].output?.includes("MCP review fixture"));
    assert.equal(typeof remoteActivity[0].durationMs, "number");
    assert.deepEqual((await call("codeReview.activity", { id: running.id, after: activity?.cursor }))?.entries, []);
    const getHistory = async (cwd?: string) => unwrap(await call("codeReview.history.list", { cwd }));
    const historyActivity = async (ref: ReviewHistoryRef) => {
      const entries = [];
      let after = 0;
      for (;;) {
        const page = unwrap(await call("codeReview.history.activity", { ref, after }));
        entries.push(...page.entries);
        if (!page.more) return entries;
        assert.ok(page.cursor > after);
        after = page.cursor;
      }
    };
    const mcpRef = { archiveId: running.id };
    assert.deepEqual(unwrap(await call("codeReview.history.activity", { ref: mcpRef })).stats, totals);
    const persistedMcp = await historyActivity(mcpRef);
    assert.ok(
      persistedMcp.some(
        (entry) =>
          entry.kind === "tool" &&
          entry.name === "review_remote_lookup" &&
          entry.output?.includes("MCP review fixture"),
      ),
    );
    assert.equal(
      persistedMcp.filter((entry) => entry.kind === "tool" && entry.name === "review_remote_lookup").length,
      1,
    );
    unwrap(await call("codeReview.mcp.save", { ...savedMcp, text: "{}" }));

    mode = "finding";
    const findingRun = unwrap(await call("codeReview.start", { previewId: (await preview()).id, model: selection }));
    const found = await waitFor(
      () => readRun(findingRun.id),
      (run) => !!run?.finishedAt,
    );
    assert.ok(finished.sessionId && found?.sessionId, JSON.stringify(found));
    const finding = found?.findings[0];
    assert.ok(finding, JSON.stringify(found));
    assert.equal(finding.path, "math.ts");
    assert.deepEqual(unwrap(await call("codeReview.locateFinding", { id: findingRun.id, findingId: finding.id })), {
      root: await realpath(root),
      path: await realpath(file),
      line: 1,
      stale: false,
    });
    await writeFile(file, "export const value = 4;\n");
    const stale = unwrap(await call("codeReview.locateFinding", { id: findingRun.id, findingId: finding.id }));
    assert.equal(stale.stale, true);
    assert.equal(stale.line, null);

    const foundRef = { archiveId: found.id };
    const savedRows = await getHistory(root);
    assert.equal(savedRows.filter((row) => row.sessionId === found.sessionId).length, 1);
    assert.deepEqual(
      unwrap(await call("codeReview.history.list", { cwd: root, offset: 1, limit: 1 })),
      savedRows.slice(1, 2),
    );
    const checkSavedReview = async () => {
      assert.ok((await getHistory()).some((row) => "archiveId" in row.ref && row.ref.archiveId === found.id));
      const archived = unwrap(await call("codeReview.history.open", foundRef));
      assert.equal(archived.snapshot, "saved");
      assert.equal(archived.legacy, false);
      assert.equal(archived.run.root, first.root);
      assert.deepEqual(archived.run.scope, workspace.scope);
      assert.equal(archived.run.worktreeBranch, git("branch", "--show-current").toString().trim());
      assert.equal(JSON.stringify(archived.run.files), JSON.stringify(found.files));
      assert.equal(JSON.stringify(archived.run.findings), JSON.stringify(found.findings));
      const savedDiff = unwrap(await call("codeReview.history.diff", { ref: foundRef, path: "math.ts" }));
      assert.match(savedDiff?.text ?? "", /^\+export const value = 3;/mu);
      assert.doesNotMatch(savedDiff?.text ?? "", /^\+export const value = [45];/mu);
      assert.equal(unwrap(await call("codeReview.history.diff", { ref: foundRef, path: ".env" })), null);
      const savedActivity = await historyActivity(foundRef);
      assert.ok(savedActivity.some((entry) => entry.kind === "model" && entry.text.includes("Reviewing the changes")));
      assert.ok(savedActivity.some((entry) => entry.kind === "engine" && /reviewing \d+/iu.test(entry.message)));
      assert.ok(savedActivity.some((entry) => entry.kind === "tool" && entry.name === "code_comment" && entry.output));
    };
    await checkSavedReview();

    const command = async (params: ApiParams<"codeReview.command">) => unwrap(await call("codeReview.command", params));
    const listed = JSON.parse((await command({ kind: "sessions", cwd: root })).text);
    assert.ok(listed.some((row: { session_id: string }) => row.session_id === found.sessionId));
    const detail = JSON.parse((await command({ kind: "sessionShow", cwd: root, id: found.sessionId })).text);
    assert.equal(detail.summary.session_id, found.sessionId);
    const comments = JSON.parse(
      (await command({ kind: "sessionComments", cwd: root, id: found.sessionId, severity: "high" })).text,
    );
    assert.ok(comments.length > 0);
    assert.ok(
      JSON.parse(
        (await command({ kind: "sessionCompare", cwd: root, before: finished.sessionId, after: found.sessionId })).text,
      ),
    );
    assert.match((await command({ kind: "sessionExport", cwd: root, id: found.sessionId })).text, /<!doctype html>/iu);
    const exportParams = { kind: "sessionExport", cwd: root, id: found.sessionId, runId: found.id } as const;
    const textReport = await command({ ...exportParams, format: "text" });
    assert.equal(textReport.filename, "code-review.txt");
    assert.match(textReport.text, /math\.ts:1/iu);
    const jsonReport = await command({ ...exportParams, format: "json" });
    assert.equal(JSON.parse(jsonReport.text).session_id, found.sessionId);
    const sarif = JSON.parse((await command({ ...exportParams, format: "sarif" })).text);
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "math.ts");
    assert.equal(sarif.runs[0].results[0].level, "error");
    const archive = path.join(userData, "code-review", "engine", ".opencodereview", "serphia-reports");
    await rm(archive, { recursive: true, force: true });
    const legacy = await command({ kind: "sessionExport", cwd: root, id: found.sessionId, format: "json" });
    assert.equal(JSON.parse(legacy.text).summary.session_id, found.sessionId);
    assert.ok(JSON.parse(legacy.text).comments.length > 0);
    const legacyRef = { cwd: root, sessionId: found.sessionId };
    const legacyDetail = unwrap(await call("codeReview.history.open", legacyRef));
    assert.equal(legacyDetail.snapshot, "unavailable");
    assert.equal(legacyDetail.legacy, true);
    assert.equal(legacyDetail.run.findings[0]?.message, finding.message);
    assert.ok(legacyDetail.run.files.some((entry) => entry.path === "math.ts"));
    assert.ok(
      (await historyActivity(legacyRef)).some(
        (entry) => entry.kind === "model" && entry.text.includes("Reviewing the changes"),
      ),
    );
    assert.equal(unwrap(await call("codeReview.history.diff", { ref: legacyRef, path: "math.ts" })), null);
    const firstArchive = path.join(userData, "code-review", "engine", ".opencodereview", "serphia-history", running.id);
    const priorVersion = path.join(userData, "history-archive-temporary");
    await rename(firstArchive, priorVersion);
    try {
      const legacyRow = (await getHistory(root)).find((row) => row.sessionId === finished.sessionId);
      assert.deepEqual(legacyRow?.ref, { cwd: first.root, sessionId: finished.sessionId });
    } finally {
      await rename(priorVersion, firstArchive);
    }
    await command({ kind: "sessionDelete", cwd: root, id: finished.sessionId });
    assert.ok(!(await getHistory(root)).some((row) => row.sessionId === finished.sessionId));
    assert.ok((await command({ kind: "ruleCheck", cwd: root, file: "math.ts" })).text.trim());
    assert.ok(JSON.parse((await command({ kind: "delegatePreview", request: workspace })).text));
    assert.match((await command({ kind: "delegatePreview", request: workspace, format: "text" })).text, /math\.ts/u);
    assert.ok(JSON.parse((await command({ kind: "delegateRule", request: workspace, files: "math.ts" })).text));
    assert.match((await command({ kind: "completion", shell: "zsh" })).text, /compdef/u);
    assert.match((await command({ kind: "help", command: "review" })).text, /--commit/u);
    await command({ kind: "engineConfig", key: "effort", value: "high" });
    await command({ kind: "engineConfig", key: "effort" });
    const { viewerUrl } = await command({ kind: "viewer" });
    assert.match(viewerUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.ok((await fetch(viewerUrl!)).ok);
    await command({ kind: "viewerStop" });

    const scan: ReviewRequest = { cwd: root, scope: { kind: "scan", paths: "math.ts" } };
    assert.ok((await preview(scan)).files.some((entry) => entry.path === "math.ts" && entry.included));
    assert.equal(unwrap(await call("codeReview.diff", { ...scan, path: "math.ts" })).text, "export const value = 4;\n");
    assert.match(
      unwrap(await call("codeReview.diff", { ...workspace, path: "math.ts" })).text,
      /^\+export const value = 4;/mu,
    );
    git("add", "math.ts");
    git(
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=Fixture",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "update",
    );
    const range: ReviewRequest = { cwd: root, scope: { kind: "branch", from: "HEAD^", to: "HEAD" } };
    git("branch", "review-base", "HEAD^");
    git("update-ref", "refs/remotes/origin/pr-review", "HEAD");
    git("update-ref", "refs/pull/42/head", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/pr-review");
    const branches = unwrap(await call("codeReview.branches", { cwd: root }));
    assert.ok(branches.current?.startsWith("refs/heads/"));
    assert.ok(branches.refs.some(({ ref, kind }) => ref === "refs/heads/review-base" && kind === "local"));
    assert.ok(branches.refs.some(({ ref, kind }) => ref === "refs/remotes/origin/pr-review" && kind === "remote"));
    assert.ok(branches.refs.some(({ ref, kind }) => ref === "refs/pull/42/head" && kind === "pull"));
    assert.ok(!branches.refs.some(({ ref }) => ref === "refs/remotes/origin/HEAD"));
    const linked = path.join(userData, "PR linked worktree");
    git("worktree", "add", "-qb", "linked-pr", linked, "HEAD");
    const worktrees = await call("worktrees.list", { projectRoot: root });
    const linkedPath = await realpath(linked);
    assert.ok(worktrees.worktrees.some(({ path, branch }) => path === linkedPath && branch === "linked-pr"));
    assert.equal(unwrap(await call("codeReview.branches", { cwd: linkedPath })).current, "refs/heads/linked-pr");
    range.scope = { kind: "branch", from: "refs/heads/review-base", to: "refs/pull/42/head" };
    const commit: ReviewRequest = { cwd: root, scope: { kind: "commit", ref: "HEAD" } };
    for (const request of [range, commit]) {
      assert.ok((await preview(request)).files.some((entry) => entry.path === "math.ts" && entry.included));
      assert.match(
        unwrap(await call("codeReview.diff", { ...request, path: "math.ts" })).text,
        /^\+export const value = 4;/mu,
      );
    }
    const runScope = async (request: ReviewRequest) => {
      const started = unwrap(
        await call("codeReview.start", { previewId: (await preview(request)).id, model: selection }),
      );
      const result = await waitFor(
        () => readRun(started.id),
        (run) => !!run?.finishedAt,
      );
      assert.equal(result?.state, "complete", JSON.stringify(result));
      assert.ok(result.sessionId);
      return result.sessionId;
    };
    mode = "success";
    const rangeSession = await runScope({ ...range, cwd: linkedPath });
    const rangeRow = (await getHistory(root)).find((row) => row.sessionId === rangeSession);
    assert.ok(rangeRow && "archiveId" in rangeRow.ref);
    const rangeArchive = unwrap(await call("codeReview.history.open", rangeRow.ref));
    assert.deepEqual(rangeArchive.run.scope, range.scope);
    assert.equal(rangeArchive.run.root, linkedPath);
    assert.equal(rangeArchive.run.projectRoot, first.root);
    assert.equal(rangeArchive.run.worktreeBranch, "linked-pr");
    assert.deepEqual(rangeArchive.run.diffScope, {
      kind: "branch",
      from: git("rev-parse", "HEAD^").toString().trim(),
      to: git("rev-parse", "HEAD").toString().trim(),
    });
    const commitSession = await runScope(commit);
    await runScope({ ...commit, options: { resume: commitSession } });
    await runScope({ ...scan, options: { noPlan: true, noDedup: true, noSummary: true } });
    const folder = path.join(userData, "scan-without-git");
    await mkdir(folder);
    await writeFile(path.join(folder, "math.ts"), "export const value = 1;\n");
    assert.equal((await call("system.validateCwd", { path: folder })).ok, true);
    assert.ok((await preview({ cwd: folder, scope: { kind: "scan" } })).files.some((entry) => entry.included));
    await writeFile(file, "export const value = 5;\n");

    mode = "hold";
    const before = requests;
    const cancelPreview = await preview();
    const cancelRun = unwrap(await call("codeReview.start", { previewId: cancelPreview.id, model: selection }));
    await waitFor(
      async () => requests,
      (current) => current > before,
    );
    await waitFor(
      () => call("codeReview.activity", { id: cancelRun.id }),
      (page) =>
        !!page?.entries.some((entry) => entry.kind === "engine") &&
        page.entries.some(
          (entry) =>
            entry.kind === "model" &&
            entry.status === "running" &&
            entry.text.includes("Reviewing the source") &&
            entry.reasoning.includes("Checking the changed lines"),
        ),
    );
    assert.equal((await call("codeReview.cancel", { id: cancelRun.id }))?.state, "cancelling");
    const cancelled = await waitFor(
      () => readRun(cancelRun.id),
      (run) => !!run?.finishedAt,
    );
    assert.equal(cancelled?.state, "cancelled");
    const cancelRef = { archiveId: cancelRun.id };
    assert.equal(unwrap(await call("codeReview.history.open", cancelRef)).run.state, "cancelled");
    assert.ok(
      (await historyActivity(cancelRef)).some(
        (entry) => entry.kind === "model" && entry.reasoning.includes("Checking the changed lines"),
      ),
    );
    await waitFor(
      async () => closed,
      (current) => current === requests,
    );
    assert.deepEqual(await readdir(path.join(userData, "code-review")), ["engine"]);
    if (process.platform !== "win32") {
      const originalPid = manager.getPid();
      assert.ok(originalPid);
      const beforeCrash = requests;
      unwrap(await call("codeReview.start", { previewId: (await preview()).id, model: selection }));
      await waitFor(
        async () => requests,
        (current) => current > beforeCrash,
      );
      expectHostCrash(true);
      try {
        process.kill(originalPid, "SIGKILL");
        await waitFor(async () => manager.getStatus() === "ready" && manager.getPid() !== originalPid, Boolean);
        await waitFor(
          async () => manager.getToolchainAckRevision(),
          (revision) => revision >= 0,
        );
        await waitFor(
          async () => closed,
          (current) => current === requests,
        );
        const recovered = unwrap(await call("codeReview.config.get"));
        assert.equal(JSON.parse(recovered.text).language, "中文");
        assert.deepEqual(JSON.parse(recovered.text).telemetry, { enabled: false, exporter: "console" });
        assert.equal(await call("codeReview.getRun", {}), null);
        await checkSavedReview();
        git("update-ref", "refs/pull/42/head", "HEAD^");
        const savedRangeDiff = unwrap(await call("codeReview.history.diff", { ref: rangeRow.ref, path: "math.ts" }));
        assert.match(savedRangeDiff?.text ?? "", /^\+export const value = 4;/mu);
        await call("system.validateCwd", { path: root });
        await preview();
        assert.deepEqual(await readdir(path.join(userData, "code-review")), ["engine"]);
      } finally {
        expectHostCrash(false);
      }
    }

    console.log(
      "OCR smoke passed: Chinese default, native config migration, Serphia model authentication, MCP stdio/HTTP, local/remote/PR refs, workspace/branch/commit/scan, all report formats, restart-safe history, legacy sessions, and cancellation",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
