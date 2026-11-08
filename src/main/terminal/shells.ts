/**
 * Shell discovery for the desktop terminal: the shells this host can actually
 * launch, the platform's default first. Windows lists its known shells in a
 * fixed preference order; POSIX reads `/etc/shells` and keeps the caller's
 * `$SHELL` as the default.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** One launchable shell: identity, display label, and argv prefix. */
export interface TerminalShellDefinition {
  /** Stable identity and the Renderer's shell id: the executable path. */
  id: string;
  label: string;
  /** Executable path passed to the pty. */
  executable: string;
  /** Arguments leading to an interactive session. */
  args: string[];
}

/** The shell list and the default choice among it. */
export interface ShellDiscovery {
  shells: TerminalShellDefinition[];
  defaultShellId: string | null;
}

/** Host facts discovery reads; injectable so platform rules stay testable. */
export interface ShellDiscoveryDependencies {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether a path names an existing regular file. */
  isFile(target: string): boolean;
  /** File contents, or null when unreadable. */
  readFile(target: string): string | null;
}

/** Known Windows shell names shown in the menu, in preference order. */
const WINDOWS_SHELL_LABELS: Readonly<Record<string, string>> = {
  "pwsh.exe": "PowerShell 7",
  "powershell.exe": "Windows PowerShell",
  "cmd.exe": "Command Prompt",
};

/** Shell basenames whose label is the plain basename on POSIX. */
const POSIX_FALLBACK_SHELLS = ["/bin/zsh", "/bin/bash", "/bin/sh"] as const;

/** The label for one executable path. */
function labelFor(executable: string, platform: NodeJS.Platform): string {
  const base = path.basename(executable);
  const lower = base.toLowerCase();
  if (platform === "win32") {
    const known = WINDOWS_SHELL_LABELS[lower];
    if (known !== undefined) return known;
    if (lower === "bash.exe" && /git/i.test(executable)) return "Git Bash";
    return base.replace(/\.exe$/i, "");
  }
  return base;
}

/** Arguments one shell needs to open an interactive session. */
function argsFor(executable: string, platform: NodeJS.Platform): string[] {
  const lower = path.basename(executable).toLowerCase();
  if (lower === "pwsh.exe" || lower === "powershell.exe") return ["-NoLogo"];
  if (lower === "bash.exe") return ["-i"];
  if (platform !== "win32" && lower === "bash") return ["-i"];
  return [];
}

/** First PATH directory holding `name`, or null. */
function findOnPath(
  name: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  isFile: (target: string) => boolean,
): string | null {
  const pathValue = env.PATH ?? env.Path ?? "";
  const separator = platform === "win32" ? ";" : ":";
  for (const directory of pathValue.split(separator)) {
    if (directory === "") continue;
    const candidate = path.join(directory, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Windows candidates in preference order, with the paths that may hold each. */
function windowsCandidates(
  env: Readonly<Record<string, string | undefined>>,
  isFile: (target: string) => boolean,
): string[] {
  const candidates: string[] = [];
  const push = (target: string | null | undefined): void => {
    if (target !== null && target !== undefined && target !== "" && isFile(target)) candidates.push(target);
  };
  push(findOnPath("pwsh.exe", "win32", env, isFile));
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  push(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  push(env.ComSpec ?? env.COMSPEC);
  push(path.join(systemRoot, "System32", "cmd.exe"));
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
  if (programFiles !== undefined) {
    push(path.join(programFiles, "Git", "bin", "bash.exe"));
    push(path.join(programFiles, "Git", "usr", "bin", "bash.exe"));
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData !== undefined) push(path.join(localAppData, "Programs", "Git", "bin", "bash.exe"));
  return candidates;
}

/** POSIX candidates: `$SHELL` first, then the system's declared shells. */
function posixCandidates(dependencies: ShellDiscoveryDependencies): string[] {
  const candidates: string[] = [];
  const push = (target: string | null | undefined): void => {
    const value = target?.trim() ?? "";
    if (value !== "" && dependencies.isFile(value)) candidates.push(value);
  };
  push(dependencies.env.SHELL);
  const declared = dependencies.readFile("/etc/shells");
  if (declared !== null) {
    for (const line of declared.split(/\r?\n/)) {
      const entry = line.trim();
      if (entry === "" || entry.startsWith("#")) continue;
      push(entry);
    }
  }
  for (const fallback of POSIX_FALLBACK_SHELLS) push(fallback);
  return candidates;
}

/**
 * Build the shell list for one platform.
 * @param dependencies - platform facts and file probes.
 * @returns the launchable shells with the platform's default first.
 */
export function discoverShells(dependencies: ShellDiscoveryDependencies): ShellDiscovery {
  const candidates =
    dependencies.platform === "win32"
      ? windowsCandidates(dependencies.env, dependencies.isFile)
      : posixCandidates(dependencies);
  const seen = new Set<string>();
  const shells: TerminalShellDefinition[] = [];
  for (const executable of candidates) {
    // One entry per executable name: PATH lookup can reach the same shell
    // through another directory (a user Git install beside the machine one),
    // and the earliest entry in preference order wins.
    const base = path.basename(executable).toLowerCase();
    const key = base.endsWith(".exe") ? base.slice(0, -4) : base;
    if (seen.has(key)) continue;
    seen.add(key);
    shells.push({
      id: executable,
      label: labelFor(executable, dependencies.platform),
      executable,
      args: argsFor(executable, dependencies.platform),
    });
  }
  return { shells, defaultShellId: shells[0]?.id ?? null };
}

/**
 * Host facts for the running process.
 * @returns discovery dependencies reading this process's environment and disk.
 */
export function defaultShellDiscoveryDependencies(): ShellDiscoveryDependencies {
  return {
    platform: process.platform,
    env: process.env,
    isFile: (target) => {
      try {
        return statSync(target).isFile();
      } catch {
        return false;
      }
    },
    readFile: (target) => {
      try {
        return readFileSync(target, "utf8");
      } catch {
        return null;
      }
    },
  };
}
