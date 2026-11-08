/**
 * Host-side owner of the open-in-app feature: one lazy resolution pass per
 * app process, an icon cache keyed by catalog id, and the validated launch the
 * Renderer can request. A launch that finds its executable gone re-resolves
 * once, so an application uninstalled while serphia runs disappears from the
 * list instead of failing forever. This module deliberately carries no
 * Electron dependency: the host wiring lives in `index.ts`, which keeps the
 * orchestration testable.
 */

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { OpenInAppApplication, OpenInAppOpenResult } from "../../contract/desktop";
import type { OpenInAppLaunchOutcome } from "./launcher.ts";
import type { ResolvedApplication } from "./resolver.ts";

const MAX_DIRECTORY_LENGTH = 4_096;

/**
 * Validate one requested workspace directory.
 * @param value - untrusted IPC argument.
 * @returns the canonical absolute directory, or null when it is not one.
 */
export async function validateWorkspaceDirectory(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DIRECTORY_LENGTH) return null;
  if (value.includes("\0") || !path.isAbsolute(value)) return null;
  try {
    const canonical = await realpath(value);
    return (await stat(canonical)).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

/** Injectable host operations for deterministic tests. */
export interface OpenInAppServiceDependencies {
  resolve(): Promise<Map<string, ResolvedApplication>>;
  launch(application: ResolvedApplication, directory: string): Promise<OpenInAppLaunchOutcome>;
  readIcon(iconPath: string | null): Promise<string | null>;
}

export class OpenInAppService {
  private resolution: Promise<Map<string, ResolvedApplication>> | null = null;
  private readonly icons = new Map<string, string | null>();
  private readonly dependencies: OpenInAppServiceDependencies;

  constructor(dependencies: OpenInAppServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The installed applications this host verified, with their icons, in menu order.
   * @returns one entry per launchable application; empty when nothing resolved.
   */
  async list(): Promise<OpenInAppApplication[]> {
    const applications = [...(await this.resolved()).values()];
    return Promise.all(
      applications.map(async (application) => ({
        id: application.id,
        icon: await this.iconFor(application),
      })),
    );
  }

  /**
   * Open one directory in a previously listed application.
   * @param appId - untrusted IPC argument naming a catalog id.
   * @param directory - untrusted IPC argument naming a workspace directory.
   * @returns the validated outcome; a vanished launcher re-resolves once.
   */
  async open(appId: unknown, directory: unknown): Promise<OpenInAppOpenResult> {
    if (typeof appId !== "string" || appId === "") return { ok: false, code: "INVALID_REQUEST" };
    const target = await validateWorkspaceDirectory(directory);
    if (target === null) return { ok: false, code: "INVALID_REQUEST" };
    const application = (await this.resolved()).get(appId);
    if (application === undefined) return { ok: false, code: "NOT_INSTALLED" };
    const outcome = await this.dependencies.launch(application, target);
    if (outcome === "launched") return { ok: true };
    if (outcome === "failed") return { ok: false, code: "LAUNCH_FAILED" };
    // A missing executable marks the resolution stale: forget the pass, look the
    // entry up again, and retry once before reporting the application as gone.
    this.resolution = null;
    this.icons.clear();
    const refreshed = (await this.resolved()).get(appId);
    if (refreshed === undefined) return { ok: false, code: "NOT_INSTALLED" };
    const retried = await this.dependencies.launch(refreshed, target);
    return retried === "launched" ? { ok: true } : { ok: false, code: "LAUNCH_FAILED" };
  }

  /** The single resolution pass shared by every request in this process. */
  private resolved(): Promise<Map<string, ResolvedApplication>> {
    this.resolution ??= this.dependencies.resolve().catch(() => new Map<string, ResolvedApplication>());
    return this.resolution;
  }

  /** One application's icon, extracted at most once per process. */
  private async iconFor(application: ResolvedApplication): Promise<string | null> {
    if (this.icons.has(application.id)) return this.icons.get(application.id) ?? null;
    const icon = await this.dependencies.readIcon(application.iconPath);
    this.icons.set(application.id, icon);
    return icon;
  }
}
