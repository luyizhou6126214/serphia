/**
 * Renderer-side terminal preferences: which discovered shell a new terminal
 * opens. The Host owns the shell list; the browser owns the remembered choice.
 */

/** LocalStorage key holding the shell id chosen for subsequent terminals. */
export const TERMINAL_SHELL_STORAGE_KEY = "pi-desktop:terminal-shell";

/** Minimal storage surface, injectable so the rules stay testable off-browser. */
export type TerminalShellStorage = Pick<Storage, "getItem" | "setItem">;

/** Browser storage, or null when unavailable. */
function browserStorage(): TerminalShellStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the remembered shell id.
 * @param storage - storage surface, defaulting to this renderer's localStorage.
 * @returns the remembered shell id, or null when absent or unreadable.
 */
export function readTerminalShellChoice(storage: TerminalShellStorage | null = browserStorage()): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(TERMINAL_SHELL_STORAGE_KEY);
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Remember one shell id.
 * @param shellId - discovered shell id a new terminal should use.
 * @param storage - storage surface, defaulting to this renderer's localStorage.
 */
export function writeTerminalShellChoice(
  shellId: string,
  storage: TerminalShellStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(TERMINAL_SHELL_STORAGE_KEY, shellId);
  } catch {
    // Keep the in-memory choice when persistence is unavailable.
  }
}

/**
 * The shell a new terminal should use.
 * @param shells - discovered shells in Host order.
 * @param choice - remembered shell id, if any.
 * @returns the remembered shell when still available, else the Host default.
 */
export function selectTerminalShell<T extends { id: string }>(
  shells: readonly T[],
  choice: string | null,
): T | undefined {
  return shells.find((shell) => shell.id === choice) ?? shells[0];
}
