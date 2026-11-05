import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";

const {
  startRpcSession,
  disposeAllRpcSessions,
  createAgentHandlers,
  openSessionWorkspace,
  defaultSessionDirectoryPath,
  isDefaultSessionDirectory,
  resolveSessionPath,
  systemHandlers,
} = await importTestBundle("default-session-workspace", {
  packages: "external",
  stdin: {
    resolveDir: import.meta.dirname,
    loader: "ts",
    contents: `
        export { startRpcSession, disposeAllRpcSessions } from "./rpc-manager.ts";
        export { createAgentHandlers } from "./handlers/agent.ts";
        export { openSessionWorkspace } from "./session-workspace.ts";
        export { defaultSessionDirectoryPath } from "./default-session-directory.ts";
        export { isDefaultSessionDirectory } from "../shared/session-workspace.ts";
        export { resolveSessionPath } from "./session-reader.ts";
        export { systemHandlers } from "./handlers/system.ts";
      `,
  },
  plugins: [
    {
      name: "offline-workspace-toolchain",
      setup(build) {
        build.onResolve({ filter: /^\.\/desktop-session-tools$/ }, () => ({
          path: "tools",
          namespace: "offline-workspace",
        }));
        build.onLoad({ filter: /.*/, namespace: "offline-workspace" }, () => ({
          contents: "export async function createDesktopSessionTools(){return {customTools:[],attach(){}};}",
        }));
      },
    },
  ],
});

function configure(t) {
  const root = mkdtempSync(path.join(tmpdir(), "serphia-default-workspace-"));
  const environment = ["PI_CODING_AGENT_DIR", "PI_DESKTOP_USER_DATA", "PI_DESKTOP_DOCUMENTS"].map((key) => [
    key,
    process.env[key],
  ]);
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.PI_DESKTOP_USER_DATA = path.join(root, "desktop");
  process.env.PI_DESKTOP_DOCUMENTS = path.join(root, "redirected documents", "文档");
  writeFileSync(path.join(root, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
  t.after(async () => {
    await disposeAllRpcSessions();
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("default directories use local dates and 32 hex UUIDs on macOS, Windows and redirected Documents", () => {
  const now = new Date(2026, 10, 4, 0, 30);
  const uuid = "a1b2c3d4-5678-4123-9876-0123456789ab";
  const id = uuid.replace(/-/g, "");
  for (const [platform, documents, expected] of [
    ["darwin", "/Users/demo/Documents", `/Users/demo/Documents/Serphia/2026-11-04/${id}`],
    ["win32", "C:\\Users\\demo\\Documents", `C:\\Users\\demo\\Documents\\Serphia\\2026-11-04\\${id}`],
    ["win32", "D:\\OneDrive\\文档", `D:\\OneDrive\\文档\\Serphia\\2026-11-04\\${id}`],
    ["win32", "\\\\server\\users\\Documents", `\\\\server\\users\\Documents\\Serphia\\2026-11-04\\${id}`],
  ]) {
    const actual = defaultSessionDirectoryPath(documents, now, uuid, platform);
    assert.equal(actual, expected);
    assert.equal(isDefaultSessionDirectory(actual), true);
  }
  assert.equal(isDefaultSessionDirectory("/projects/Serphia"), false);
});

test("non-project sessions get unique real workspaces and retain them through restore and reload", async (t) => {
  const root = configure(t);
  const handlers = createAgentHandlers({ server: { emit() {} }, bindEvents() {} });
  const directories = new Set();
  for (const cwd of [undefined, null, ""]) {
    const result = await handlers.new({ cwd, type: "ensure_session" });
    assert.ok(isDefaultSessionDirectory(result.cwd));
    assert.ok(existsSync(result.cwd));
    assert.ok(result.cwd.startsWith(path.join(process.env.PI_DESKTOP_DOCUMENTS, "Serphia") + path.sep));
    directories.add(result.cwd);
  }
  assert.equal(directories.size, 3);
  const firstDefault = await systemHandlers.defaultCwd();
  const nextDefault = await systemHandlers.defaultCwd();
  assert.ok(isDefaultSessionDirectory(firstDefault.cwd));
  assert.ok(existsSync(firstDefault.cwd));
  assert.notEqual(firstDefault.cwd, nextDefault.cwd);
  await assert.rejects(handlers.new({ cwd: 123, type: "ensure_session" }), (error) => error.code === "BAD_REQUEST");
  let { session: wrapper, realSessionId } = await startRpcSession("new-default", "", "", ["read", "bash"]);
  const cwd = wrapper.cwd;
  writeFileSync(path.join(cwd, "workspace.txt"), "private workspace proof");
  const check = async () => {
    assert.equal(wrapper.cwd, cwd);
    assert.equal(wrapper.inner.sessionManager.getCwd(), cwd);
    assert.equal(wrapper.inner.sessionManager.getHeader().cwd, cwd);
    assert.equal(
      (await wrapper.send({ type: "get_tools" })).find((tool) => tool.name === "read").executionAllowed,
      true,
    );
    const read = await wrapper.inner.getToolDefinition("read").execute("workspace-read", { path: "workspace.txt" });
    assert.match(read.content.map((block) => block.text ?? "").join(""), /private workspace proof/);
  };
  await check();
  const manager = wrapper.inner.sessionManager;
  const first = manager.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });
  const second = manager.appendMessage({ role: "user", content: "Again", timestamp: Date.now() });
  const file = manager.getSessionFile();
  assert.equal(JSON.parse(readFileSync(file, "utf8").split("\n")[0]).cwd, cwd);
  await wrapper.dispose();
  ({ session: wrapper } = await startRpcSession(realSessionId, file, "/must-not-be-used"));
  await check();
  await wrapper.send({ type: "reload" });
  await check();
  const fork = await wrapper.send({ type: "fork", entryId: second });
  assert.equal(fork.cancelled, false);
  const sessions = await SessionManager.listAll();
  const forkInfo = sessions.find((session) => session.id === fork.newSessionId);
  assert.ok(isDefaultSessionDirectory(forkInfo.cwd));
  assert.notEqual(forkInfo.cwd, cwd);
  assert.ok(existsSync(forkInfo.cwd));
  ({ session: wrapper } = await startRpcSession(fork.newSessionId, forkInfo.path, ""));
  const emptyFork = await wrapper.send({ type: "fork", entryId: first });
  assert.equal(emptyFork.cancelled, false);
  const emptyPath = await resolveSessionPath(emptyFork.newSessionId);
  assert.ok(emptyPath);
  const emptyHeader = SessionManager.open(emptyPath).getHeader();
  assert.equal(emptyHeader.id, emptyFork.newSessionId);
  assert.ok(isDefaultSessionDirectory(emptyHeader.cwd));
  assert.notEqual(emptyHeader.cwd, forkInfo.cwd);
  const reopened = await startRpcSession(emptyFork.newSessionId, emptyPath, "");
  assert.equal(reopened.realSessionId, emptyFork.newSessionId);
  assert.equal(reopened.session.cwd, emptyHeader.cwd);
  // Project sessions preserve their explicitly chosen directory.
  const project = path.join(root, "project");
  mkdirSync(project);
  const projectManager = openSessionWorkspace("", project, root);
  assert.equal(projectManager.getCwd(), project);
});

test("older home and empty workspaces migrate once without moving transcript content or user files", (t) => {
  const root = configure(t);
  for (const previous of ["", homedir(), path.join(homedir(), "pi-cwd-20261104")]) {
    const manager = SessionManager.create(root, path.join(root, "sessions"));
    manager.getHeader().cwd = previous;
    manager.appendMessage({ role: "user", content: "preserve history", timestamp: Date.now() });
    const file = manager.getSessionFile();
    const original = readFileSync(file, "utf8");
    const restored = openSessionWorkspace(file, previous, root);
    assert.ok(isDefaultSessionDirectory(restored.getCwd()));
    const updated = readFileSync(file, "utf8");
    assert.equal(original.slice(original.indexOf("\n")), updated.slice(updated.indexOf("\n")));
    const again = openSessionWorkspace(file, "", root);
    assert.equal(again.getCwd(), restored.getCwd());
  }
});
