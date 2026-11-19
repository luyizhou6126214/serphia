import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { x } from "tar";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";

function reply(model, content) {
  const message = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  globalThis.queueMicrotask(() => {
    stream.push({ type: "done", reason: message.stopReason, message });
    stream.end();
  });
  return stream;
}
const api = await importTestBundle("presentation-workflows", {
  packages: "external",
  stdin: {
    resolveDir: import.meta.dirname,
    loader: "ts",
    contents: `export * from './presentation-workflows.ts';
      export * from './presentation-artifacts.ts';
      export * from './presentation-workflow-context.ts';
      export {createSessionWorkflowExtension} from './session-workflow.ts';
      export {SessionToolPolicy} from './session-tool-policy.ts';
      export {createSessionHandlers} from './handlers/sessions.ts';
      export {setAgentSessionSource, getAgentSessionSource} from './session-source.ts';
      export {sessions} from './handlers/agent';`,
  },
  plugins: [
    {
      name: "host-session-registry",
      setup(build) {
        build.onResolve({ filter: /^\.\/handlers\/agent$/ }, () => ({ path: "registry", namespace: "fixture" }));
        build.onResolve({ filter: /(?:\.\/|\.\.\/)rpc-manager(?:\.ts)?$/ }, () => ({
          path: "registry",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          loader: "js",
          contents: `
      export const sessions = new Map();
      export function getRpcSession(id) { return sessions.get(id); }
      export function getRunningRpcSessionIds() { return []; }
      export async function openExistingAgentSession(id) {
        const session = sessions.get(id); if (!session) throw new Error('Session not found'); return session;
      }`,
        }));
        build.onResolve({ filter: /^\.\/path-authorization$/ }, () => ({
          path: "authorization",
          namespace: "authorization",
        }));
        build.onLoad({ filter: /.*/, namespace: "authorization" }, () => ({
          loader: "js",
          contents: `export async function assertPathAllowed() {}`,
        }));
      },
    },
  ],
});

test(
  "complete installed skill is expanded and read by a real persistent Pi session; workflow tools persist across turns",
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "ppt-workflow-"));
    const skillDir = path.join(root, "ppt-master");
    await mkdir(skillDir);
    await x(
      {
        file: path.resolve(import.meta.dirname, "../../build/presentation-skills/ppt-master-6.9.0.tar.gz"),
        cwd: skillDir,
      },
      ["SKILL.md"],
    );
    const priorSkillDir = process.env.PI_DESKTOP_PPT_MASTER_DIR;
    process.env.PI_DESKTOP_PPT_MASTER_DIR = skillDir;
    t.after(() => {
      if (priorSkillDir === undefined) delete process.env.PI_DESKTOP_PPT_MASTER_DIR;
      else process.env.PI_DESKTOP_PPT_MASTER_DIR = priorSkillDir;
    });
    const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
    const upstream = path.join(process.env.PI_CODING_AGENT_DIR, "skills/deck-a");
    await mkdir(upstream, { recursive: true });
    await writeFile(
      path.join(upstream, "SKILL.md"),
      "---\nname: deck-a\ndescription: Test presentation workflow\n---\n# Mandatory Load Order\nRead the reference and run attribution_guard.py.\n",
    );
    await mkdir(path.join(process.env.PI_CODING_AGENT_DIR, "skills/another-deck"));
    await writeFile(
      path.join(process.env.PI_CODING_AGENT_DIR, "skills/another-deck/SKILL.md"),
      "---\nname: another-deck\ndescription: Alternative presentation workflow\n---\n# Alternative deck workflow\n",
    );
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const childRequests = [];
    runtime.registerProvider("presentation-fixture", {
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "local-fixture",
      models: [
        {
          id: "fixture",
          name: "Presentation fixture",
          reasoning: false,
          input: ["text"],
          contextWindow: 200000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      streamSimple(model, context) {
        childRequests.push(structuredClone(context));
        const read = context.messages.some((message) => message.role === "toolResult");
        return reply(
          model,
          read
            ? [{ type: "text", text: "Assigned page complete using the selected skill." }]
            : [
                {
                  type: "toolCall",
                  id: `child-read-${childRequests.length}`,
                  name: "read",
                  arguments: { path: path.join(upstream, "SKILL.md") },
                },
              ],
        );
      },
    });
    const created = [];
    const workflows = api.createPresentationWorkflows(
      async ({ cwd, toolNames, provider, modelId, modelSelectionExplicit, thinkingLevel }) => {
        assert.equal(provider, "presentation-fixture");
        assert.equal(modelId, "fixture");
        assert.equal(modelSelectionExplicit, true);
        assert.equal(thinkingLevel, "high");
        assert.ok(toolNames.includes("write") && toolNames.includes("read"));
        const manager = SessionManager.create(cwd, path.join(root, "sessions"));
        api.setAgentSessionSource(manager, "local");
        const policy = new api.SessionToolPolicy(manager, ["read"]);
        const services = await createAgentSessionServices({
          cwd,
          agentDir: process.env.PI_CODING_AGENT_DIR,
          modelRuntime: runtime,
          settingsManager: SettingsManager.inMemory({
            cacheWarming: "off",
            retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 },
          }),
          resourceLoaderOptions: {
            noExtensions: false,
            noThemes: true,
            noContextFiles: true,
            noPromptTemplates: true,
            disabledBuiltinExtensions: ["mcp", "codemode", "tool-search"],
            extensionFactories: [
              policy.extension(),
              api.createSessionWorkflowExtension(policy),
              {
                name: "fixture-check",
                factory(pi) {
                  pi.on("before_agent_start", (_event, ctx) => {
                    assert.equal(
                      api.getAgentSessionSource(ctx.sessionManager),
                      "local",
                      "source is available to extension context",
                    );
                    assert.ok(
                      api.presentationWorkflowContext(ctx.sessionManager),
                      "metadata is available to extension context",
                    );
                  });
                },
              },
            ],
          },
        });
        const { session } = await createAgentSessionFromServices({
          services,
          sessionManager: manager,
          model: runtime.getModel("presentation-fixture", "fixture"),
        });
        session.setActiveToolsByName(["read"]);
        policy.bind(session);
        await session.bindExtensions({ mode: "rpc" });
        const id = manager.getSessionId();
        api.sessions.set(id, { inner: session, isAlive: () => true });
        created.push({ session, policy, id });
        return { sessionId: id, cwd, data: null };
      },
    );
    t.after(async () => {
      for (const item of created) {
        item.session.dispose();
        api.sessions.delete(item.id);
      }
      if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
      await rm(root, { recursive: true, force: true });
    });
    const request = {
      cwd: root,
      model: { provider: "presentation-fixture", modelId: "fixture" },
      thinkingLevel: "high",
    };
    const workflow = await workflows.prepare(request);
    assert.equal("prompt" in workflow, false, "creating a conversation must not submit a user turn");
    const { session, policy } = created[0];
    const sessionHandlers = api.createSessionHandlers({
      server: { emit() {} },
      managedProcesses: {
        activeForSession() {
          return [];
        },
        async stop() {},
      },
      clearSessionEventBinding() {},
    });
    const prepared = await sessionHandlers.get({ id: workflow.sessionId });
    assert.equal(prepared.info.id, workflow.sessionId);
    assert.equal(prepared.context.messages.length, 0, "ChatWindow can load before the first prompt is persisted");
    assert.equal(prepared.context.historyRevision, `pending:${workflow.sessionId}`);
    const contexts = [];
    let calls = 0;
    session.agent.streamFunction = (model, context) => {
      contexts.push({ ...structuredClone(context), activeTools: session.getActiveToolNames() });
      const first = ++calls === 1;
      const message = {
        role: "assistant",
        content: first
          ? [{ type: "toolCall", id: "read-skill", name: "read", arguments: { path: path.join(upstream, "SKILL.md") } }]
          : [{ type: "text", text: "The selected workflow is loaded. Confirm the design brief to continue." }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: first ? "toolUse" : "stop",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      globalThis.queueMicrotask(() => {
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    };
    await session.prompt("/skill:deck-a Build a 2-slide presentation", { source: "rpc" });
    assert.match(JSON.stringify(contexts[0].messages), /<skill name=\\"deck-a\\"/);
    assert.match(JSON.stringify(contexts[0].messages), /Mandatory Load Order/);
    function assertLockedSkill(context) {
      const instructions = JSON.stringify(context.messages.filter((message) => message.role === "system"));
      assert.match(instructions, /ppt-master skill is locked/);
      assert.match(instructions, /--daemon --no-browser/);
      assert.match(instructions, /--wait-only --wait-stage final/);
      assert.match(instructions, /editable PPTX pane/);
      assert.match(instructions, /Global Execution Discipline/);
    }
    assertLockedSkill(contexts[0]);
    assert.ok(JSON.stringify(contexts[0]).includes(JSON.stringify(path.join(skillDir, "SKILL.md")).slice(1, -1)));
    assert.ok(
      contexts[0].activeTools.includes("serphia_workflow"),
      JSON.stringify({
        active: contexts[0].activeTools,
        tools: session.getAllTools().map((t) => t.name),
        extensions: session.resourceLoader.getExtensions().errors,
      }),
    );
    assert.ok(
      session.messages.some(
        (m) => m.role === "toolResult" && !m.isError && JSON.stringify(m.content).includes("attribution_guard.py"),
      ),
    );
    assert.equal(policy.isAllowed("serphia_workflow"), false, "delegation grant ends with the turn");
    let retryAttempt = 0;
    session.agent.streamFunction = (model, context) => {
      const declared = new Set((context.tools ?? []).map((tool) => tool.name));
      for (const message of context.messages) {
        for (const tool of message.toolsAdded ?? []) declared.add(tool.name);
        for (const tool of message.toolsRemoved ?? []) declared.delete(tool.name);
      }
      assert.ok(declared.has("serphia_workflow"), "delegation remains declared during provider retries");
      assert.equal(policy.isAllowed("serphia_workflow"), true);
      if (++retryAttempt > 1) return reply(model, [{ type: "text", text: "Retry recovered." }]);
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: "error",
        errorMessage: "Connection error.",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      globalThis.queueMicrotask(() => {
        stream.push({ type: "error", reason: "error", error: message });
        stream.end();
      });
      return stream;
    };
    await session.prompt("Retry the interrupted provider request", { source: "rpc" });
    assert.equal(retryAttempt, 2, JSON.stringify(session.messages.at(-1)));
    assert.equal(policy.isAllowed("serphia_workflow"), false, "grant closes only after retries settle");
    session.agent.streamFunction = (model, context) => {
      contexts.push({ ...structuredClone(context), activeTools: session.getActiveToolNames() });
      return reply(model, [{ type: "text", text: "Continuing." }]);
    };
    await session.prompt("Confirm the design brief", { source: "rpc" });
    assertLockedSkill(contexts.at(-1));
    assert.ok(contexts.at(-1).activeTools.includes("serphia_workflow"), "continuation re-enables delegation");
    let dispatched = false;
    session.agent.streamFunction = (model) => {
      if (dispatched) return reply(model, [{ type: "text", text: "Both page agents finished." }]);
      dispatched = true;
      return reply(model, [
        {
          type: "toolCall",
          id: "delegated-pages",
          name: "serphia_workflow",
          arguments: {
            stages: [
              {
                title: "Approved page batch",
                tasks: [
                  { title: "Page 1", prompt: "Read the selected skill and report page 1 complete." },
                  { title: "Page 2", prompt: "Read the selected skill and report page 2 complete." },
                ],
              },
            ],
          },
        },
      ]);
    };
    const events = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await session.prompt("The design is approved. Delegate both page tasks.", { source: "rpc" });
    unsubscribe();
    const delegated = session.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "delegated-pages",
    );
    assert.equal(delegated?.isError, false, JSON.stringify(delegated));
    assert.match(JSON.stringify(delegated.content), /Assigned page complete/);
    assert.equal(childRequests.length, 4, "two real child Pi sessions read the skill and return results");
    assert.ok(
      childRequests.every((context) =>
        JSON.stringify(context.messages).includes(workflow.directory.replaceAll("\\", "\\\\")),
      ),
    );
    assert.ok(
      events.some((event) => event.type === "tool_execution_update" && JSON.stringify(event).includes("Page 1")),
      "live delegation progress reaches the standard event stream",
    );
    assert.ok(
      (await readFile(session.sessionManager.getSessionFile(), "utf8")).includes("serphia-presentation-workflow"),
    );
    assert.equal((await workflows.workflow({ sessionId: workflow.sessionId })).directory, workflow.directory);
    assert.equal("skill" in (await workflows.workflow({ sessionId: workflow.sessionId })), false);
    session.agent.streamFunction = (model, context) => {
      assert.match(JSON.stringify(context.messages.at(-1)), /Alternative deck workflow/);
      assertLockedSkill(context);
      return reply(model, [{ type: "text", text: "Using the additional skill within the PPT workflow." }]);
    };
    await session.prompt("/skill:another-deck Use this workflow now", { source: "rpc" });
  },
);

test("Studio discovers only the active confirmation service owned by this project and tracks final submission", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ppt-form-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "deck");
  const receipts = path.join(project, "confirm_ui");
  await mkdir(receipts, { recursive: true });
  const health = { service: "confirm_ui", status: "ok", pid: process.pid, project, session: { status: "ready_user" } };
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/health");
    res.end(JSON.stringify(health));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  await writeFile(path.join(project, ".confirm_ui.lock"), JSON.stringify({ pid: process.pid, port }));
  assert.equal((await api.presentationArtifacts(root)).confirmationPort, port);
  health.session.status = "waiting_agent";
  assert.equal((await api.presentationArtifacts(root)).confirmationPort, port);
  health.project = root;
  assert.equal((await api.presentationArtifacts(root)).confirmationPort, undefined);
  health.project = project;
  health.pid++;
  assert.equal((await api.presentationArtifacts(root)).confirmationPort, undefined);
  health.pid--;
  health.session.status = "done";
  await writeFile(path.join(receipts, "result.json"), JSON.stringify({ stage: "final", status: "confirmed" }));
  assert.deepEqual(await api.presentationArtifacts(root), { exports: [], designConfirmed: true });
});

test("only deliverable PPTX files reach the editor and stale or invalid edits preserve the current file", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ppt-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "partial.pptx"), Buffer.from("PK partial zip"));
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.addSlide().addText("Native", { x: 1, y: 1, w: 3, h: 1 });
  await writeFile(path.join(root, "complete.pptx"), await deck.write({ outputType: "nodebuffer" }));
  await mkdir(path.join(root, "deck/exports/.pptx-build-temporary"), { recursive: true });
  await writeFile(
    path.join(root, "deck/exports/.pptx-build-temporary/base.pptx"),
    await readFile(path.join(root, "complete.pptx")),
  );
  const snapshot = await api.presentationArtifacts(root);
  assert.deepEqual(
    snapshot.exports.map((file) => file.name),
    ["complete.pptx"],
  );
  const file = snapshot.exports[0].path;
  const original = await readFile(file);
  const expectedHash = createHash("sha256").update(original).digest("hex");
  await assert.rejects(
    api.savePresentationFile(root, { path: file, expectedHash, base64: "bm90IHppcA==" }),
    /Invalid PowerPoint/,
  );
  assert.deepEqual(await readFile(file), original);
  deck.addSlide().addText("Edited", { x: 1, y: 1, w: 3, h: 1 });
  const base64 = await deck.write({ outputType: "base64" });
  const saved = await api.savePresentationFile(root, { path: file, expectedHash, base64 });
  assert.equal(saved.hash, createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"));
  await assert.rejects(
    api.savePresentationFile(root, { path: file, expectedHash, base64: original.toString("base64") }),
    /changed on disk/,
  );
  assert.equal((await readFile(file)).toString("base64"), base64);
  await assert.rejects(
    api.savePresentationFile(path.join(root, "deck"), { path: file, expectedHash: saved.hash, base64 }),
    /outside/,
  );
});
