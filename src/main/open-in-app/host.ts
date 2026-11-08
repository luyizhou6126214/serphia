/**
 * Composition root for the open-in-app feature: binds the pure service to the
 * Electron launcher, icon extraction, and the host's catalog resolution.
 */

import { launchApplication, readApplicationIcon } from "./launcher.ts";
import { resolveApplications } from "./resolver.ts";
import { OpenInAppService } from "./service.ts";

/**
 * Build the desktop service the IPC handlers share.
 * @returns a service resolving applications from this host once per process.
 */
export function createOpenInAppService(): OpenInAppService {
  return new OpenInAppService({
    resolve: () => resolveApplications(),
    launch: (application, directory) => launchApplication(application, directory),
    readIcon: (iconPath) => readApplicationIcon(iconPath),
  });
}
