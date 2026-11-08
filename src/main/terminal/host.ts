/** Composition of the desktop terminal service for this Electron host. */

import type { TerminalEvent } from "../../contract/terminal";
import { TerminalService } from "./service.ts";
import { defaultShellDiscoveryDependencies, discoverShells } from "./shells.ts";

/**
 * Build the terminal service the IPC handlers share.
 * @param emit - sink for output, exit, and close events; the host sends them to the window.
 * @returns a service whose shells were discovered once for this process.
 */
export function createDesktopTerminalService(emit: (event: TerminalEvent) => void): TerminalService {
  const discovery = discoverShells(defaultShellDiscoveryDependencies());
  return new TerminalService({ shells: discovery.shells, defaultShellId: discovery.defaultShellId, emit });
}
