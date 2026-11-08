/**
 * Renderer-side naming and preference rules for open-in-app: the Host returns
 * stable catalog ids, while localized labels and the remembered choice belong
 * to the browser surface.
 */

import type { OpenInAppApplication } from "@contract/desktop";

/** LocalStorage key holding the last application the user opened the workspace in. */
export const OPEN_IN_APP_STORAGE_KEY = "pi-desktop:open-in-app-app";

/** Minimal storage surface, injectable so the rules stay testable off-browser. */
export type OpenInAppStorage = Pick<Storage, "getItem" | "setItem">;

/** One host application with the label this build shows for it. */
export interface OpenInAppChoice {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
}

/** Translation lookup shaped like `useI18n().t`. */
export type OpenInAppTranslator = (key: string, fallback: string) => string;

/** Applications a directory is opened in; never a text product name. */
const PRODUCT_NAMES: Record<string, string> = {
  cursor: "Cursor",
  vscode: "VS Code",
  vscodeInsiders: "VS Code Insiders",
  windsurf: "Windsurf",
  zed: "Zed",
  sublimeText: "Sublime Text",
  androidStudio: "Android Studio",
  intellij: "IntelliJ IDEA",
  pycharm: "PyCharm",
  webstorm: "WebStorm",
  goland: "GoLand",
  windowsTerminal: "Windows Terminal",
  gitbash: "Git Bash",
};

/**
 * Label one host application id.
 * @param id - catalog id from the Host.
 * @param t - active dictionary lookup.
 * @returns the localized label, or null for an id this build cannot name.
 */
export function openInAppLabel(id: string, t: OpenInAppTranslator): string | null {
  switch (id) {
    case "explorer":
      return t("openInAppFileExplorer", "File Explorer");
    case "finder":
      return t("openInAppFinder", "Finder");
    case "filemanager":
      return t("openInAppFiles", "Files");
    case "terminal":
      return t("openInAppTerminal", "Terminal");
    default:
      return PRODUCT_NAMES[id] ?? null;
  }
}

/**
 * Attach labels to the Host's applications, dropping ids this build cannot name.
 * @param applications - Host list in menu order.
 * @param t - active dictionary lookup.
 * @returns the nameable applications in menu order.
 */
export function describeOpenInApps(
  applications: readonly OpenInAppApplication[],
  t: OpenInAppTranslator,
): OpenInAppChoice[] {
  return applications.flatMap((application) => {
    const name = openInAppLabel(application.id, t);
    return name === null ? [] : [{ id: application.id, name, icon: application.icon }];
  });
}

/**
 * Pick the application the main button opens with.
 * @param applications - nameable applications in menu order.
 * @param choice - remembered catalog id, if any.
 * @returns the remembered application when still installed, else the first one.
 */
export function selectOpenInApp(
  applications: readonly OpenInAppChoice[],
  choice: string | null,
): OpenInAppChoice | undefined {
  return applications.find((application) => application.id === choice) ?? applications[0];
}

/** Browser storage, or null when unavailable (privacy-restricted renderer). */
function browserStorage(): OpenInAppStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the remembered application id.
 * @param storage - storage surface, defaulting to this renderer's localStorage.
 * @returns the remembered catalog id, or null when absent or unreadable.
 */
export function readOpenInAppChoice(storage: OpenInAppStorage | null = browserStorage()): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(OPEN_IN_APP_STORAGE_KEY);
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Remember one application id.
 * @param appId - catalog id the launch just used.
 * @param storage - storage surface, defaulting to this renderer's localStorage.
 */
export function writeOpenInAppChoice(appId: string, storage: OpenInAppStorage | null = browserStorage()): void {
  if (storage === null) return;
  try {
    storage.setItem(OPEN_IN_APP_STORAGE_KEY, appId);
  } catch {
    // Keep the in-memory choice when persistence is unavailable.
  }
}
