/**
 * Launching half of open-in-app: one resolved application is spawned detached
 * (never through a shell) on the workspace directory, or handed to the OS
 * shell's open verb for the file-manager entries. Launch success is decoupled
 * from process exit — an editor stays in the foreground for its whole window
 * lifetime — so a bounded watch window only catches launchers that fail
 * immediately; a child still running when it closes is unrefed and counted
 * launched, never killed.
 */

import { spawn } from "node:child_process";
import { app, shell } from "electron";
import type { OpenInAppLaunch } from "./catalog.ts";
import { launchArguments } from "./command.ts";
import type { ResolvedApplication } from "./resolver.ts";

/** How one launch attempt ended; `missing` marks a stale resolution (ENOENT). */
export type OpenInAppLaunchOutcome = "launched" | "missing" | "failed";

/** Early-failure watch window per launch, in milliseconds. */
export const LAUNCH_WATCH_MS = 1_200;

/** Whether a spawn error names a missing executable (a stale resolution). */
function isMissingExecutable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Spawn one launcher detached under the watch window.
 * @param command - executable path.
 * @param args - argv (never a shell string).
 * @param watchMs - early-failure window.
 * @returns how the attempt ended.
 */
function spawnDetached(command: string, args: string[], watchMs: number): Promise<OpenInAppLaunchOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    } catch {
      resolve("failed");
      return;
    }
    let settled = false;
    const settle = (outcome: OpenInAppLaunchOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      resolve(outcome);
    };
    const timer = setTimeout(() => settle("launched"), watchMs);
    timer.unref?.();
    child.on("error", (error: unknown) => settle(isMissingExecutable(error) ? "missing" : "failed"));
    child.on("exit", (code) => settle(code === 0 ? "launched" : "failed"));
  });
}

/**
 * Hand a directory to the OS shell's open verb (the file-manager entries).
 * @param directory - absolute workspace directory.
 * @returns `launched` when the shell accepted the request.
 */
async function openThroughShell(directory: string): Promise<OpenInAppLaunchOutcome> {
  try {
    const failure = await shell.openPath(directory);
    return failure === "" ? "launched" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Run one resolved launcher on a workspace directory.
 * @param application - verified application from the resolution pass.
 * @param directory - absolute workspace directory.
 * @param watchMs - early-failure watch window.
 * @returns how the attempt ended.
 */
export async function launchApplication(
  application: ResolvedApplication,
  directory: string,
  watchMs: number = LAUNCH_WATCH_MS,
): Promise<OpenInAppLaunchOutcome> {
  const launch: OpenInAppLaunch = application.launch;
  if (launch.kind === "shell-open") return openThroughShell(directory);
  return spawnDetached(launch.command, launchArguments(launch.args, directory), watchMs);
}

/**
 * Extract an application's own icon as a PNG data URL.
 * @param iconPath - executable or bundle resolved for the application.
 * @returns the data URL, or null when the platform yields no icon.
 */
export async function readApplicationIcon(iconPath: string | null): Promise<string | null> {
  if (iconPath === null) return null;
  try {
    const image = await app.getFileIcon(iconPath, { size: "normal" });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}
