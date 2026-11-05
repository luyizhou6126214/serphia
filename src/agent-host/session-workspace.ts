import path from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { SessionManager, SettingsManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createDefaultSessionDirectory } from "./default-session-directory";
import { isDefaultSessionDirectory } from "../shared/session-workspace";

export function openSessionWorkspace(sessionFile: string, cwd: string, agentDir: string): SessionManager {
  const manager = sessionFile
    ? SessionManager.open(sessionFile)
    : cwd
      ? SessionManager.create(cwd)
      : createUnprojectedSession(agentDir);
  // Persisted headers own workspace identity, even when a caller supplies a different cwd.
  const savedCwd = manager.getHeader()?.cwd;
  if (!savedCwd || isLegacyDefaultDirectory(savedCwd)) {
    const directory = createDefaultSessionDirectory();
    if (sessionFile) persistWorkingDirectory(sessionFile, directory);
    setWorkingDirectory(manager, directory);
  } else if (isDefaultSessionDirectory(savedCwd)) mkdirSync(savedCwd, { recursive: true });
  return manager;
}

function isLegacyDefaultDirectory(cwd: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return (
    normalize(cwd) === normalize(homedir()) ||
    (normalize(path.dirname(cwd)) === normalize(homedir()) && /^pi-cwd-\d{8}$/.test(path.basename(cwd)))
  );
}

/** Keep the SDK's in-memory cwd and JSONL header in sync when upgrading old default workspaces. */
function setWorkingDirectory(manager: SessionManager, cwd: string): void {
  Object.assign(manager, { cwd });
  const header = manager.getHeader();
  if (header) header.cwd = cwd;
}

function persistWorkingDirectory(sessionFile: string, cwd: string): void {
  const source = readFileSync(sessionFile, "utf8");
  const end = source.indexOf("\n");
  const header = JSON.parse(end < 0 ? source : source.slice(0, end));
  const temp = `${sessionFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...header, cwd }) + (end < 0 ? "\n" : source.slice(end)), {
      mode: statSync(sessionFile).mode,
      flag: "wx",
    });
    renameSync(temp, sessionFile);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function createUnprojectedSession(
  agentDir: string,
  sessionDir = path.join(agentDir, "sessions", "__no_project__"),
) {
  return SessionManager.create(createDefaultSessionDirectory(), sessionDir);
}

export function forkSessionWorkspace(manager: SessionManager, currentSessionFile: string, parentId: string | null) {
  const originalCwd = manager.getHeader()?.cwd ?? "";
  const cwd =
    !originalCwd || isDefaultSessionDirectory(originalCwd) || isLegacyDefaultDirectory(originalCwd)
      ? createDefaultSessionDirectory()
      : originalCwd;
  const sessionDir = manager.getSessionDir();
  if (!parentId) {
    const fork = SessionManager.create(cwd, sessionDir);
    const file = fork.newSession({ parentSession: currentSessionFile });
    if (!file) throw new Error("Failed to create forked session");
    // An empty fork must keep its header; otherwise opening a missing file adopts process.cwd().
    writeFileSync(file, `${JSON.stringify(fork.getHeader())}\n`, { flag: "wx", mode: 0o600 });
    return file;
  }
  const source = SessionManager.open(currentSessionFile, sessionDir);
  setWorkingDirectory(source, cwd);
  const file = source.createBranchedSession(parentId);
  if (!file) throw new Error("Failed to create forked session");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      [source.getHeader(), ...source.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  return file;
}

export function createGlobalSessionSettings(agentDir: string): SettingsManager {
  // Untrusted project settings are never read or written by the SDK.
  return SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
}

export function sessionWorkspaceOptions(cwd: string, agentDir: string, extensionFactories: InlineExtension[]) {
  return {
    // The SDK requires an absolute service base. Storage is never the session's working directory.
    cwd: cwd || agentDir,
    agentDir,
    ...(!cwd ? { settingsManager: createGlobalSessionSettings(agentDir) } : {}),
    resourceLoaderOptions: {
      ...(!cwd ? { noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true } : {}),
      extensionFactories,
    },
  };
}
