import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { SuperAgentCli } from "../../contract/superagent";
import { WindowsByteProcessChild } from "../managed-process/windows-byte-child";
import { callMain } from "../parent-rpc";

export interface LocalAgentCommand {
  executable: string;
  prefix: string[];
}

const npmEntry: Record<SuperAgentCli, string[]> = {
  claude: ["@anthropic-ai", "claude-code", "bin", "claude.exe"],
  codex: ["@openai", "codex", "bin", "codex.js"],
  dsh: ["@deepseek-ai", "dsh", "lib", "bin.js"],
};

export function discoverLocalAgents(): Promise<Partial<Record<SuperAgentCli | "node", string>>> {
  return callMain("superagent.discoverClis");
}

export async function resolveLocalAgent(
  cli: SuperAgentCli,
  candidate: string,
  node?: string,
): Promise<LocalAgentCommand> {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(candidate)) {
    return { executable: candidate, prefix: [] };
  }
  const entry = path.join(path.dirname(candidate), "node_modules", ...npmEntry[cli]);
  try {
    await access(entry);
  } catch {
    throw new Error(`Unsupported ${cli} launcher. Use the official executable or npm installation.`);
  }
  if (cli === "claude") return { executable: entry, prefix: [] };
  const sibling = path.join(path.dirname(candidate), "node.exe");
  const executable = await access(sibling).then(
    () => sibling,
    () => node ?? (!process.versions.electron ? process.execPath : undefined),
  );
  if (!executable) throw new Error(`The ${cli} npm installation requires a local Node.js executable.`);
  return { executable, prefix: [entry] };
}

export function startLocalAgent(command: LocalAgentCommand, args: string[], cwd: string) {
  const argv = [...command.prefix, ...args];
  if (process.platform === "win32" && process.versions.electron) {
    return new WindowsByteProcessChild(command.executable, argv, randomUUID(), {
      cwd,
      processPrefix: "superagent",
      capabilityScope: "transport",
      retryWindowsContainment: true,
    });
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(command.executable, argv, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: "pipe",
  });
}

export type LocalAgentProcess = ReturnType<typeof startLocalAgent>;

export function stopLocalAgent(child: LocalAgentProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may already have exited.
    }
  }
  child.kill(signal);
}
