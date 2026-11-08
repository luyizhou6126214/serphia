/**
 * The open-in-app catalog: a compile-time table of applications a workspace
 * directory can be opened in, declaring the locator chain tried on each
 * platform. Data only — `resolver.ts` turns a chain into a verified launcher
 * this host actually holds, `launcher.ts` runs it, and `service.ts` caches one
 * resolution pass. A platform without declared entries resolves as empty.
 */

/** Platforms with declared launcher chains; anything else resolves as empty. */
export type OpenInAppPlatform = "darwin" | "win32" | "linux";

/** Argv token replaced by the workspace directory; absent tokens append it. */
export const PATH_TOKEN = "{path}";

/** How a resolved application receives the workspace directory. */
export type OpenInAppLaunch =
  | { readonly kind: "argv"; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: "shell-open" };

/**
 * How one platform derives a verified launcher: `fixed` ships with the OS,
 * `app-bundle` checks the known macOS application directories, `app-paths`
 * reads the Windows `App Paths` registry keys, `install-record` verifies the
 * executable a Windows Uninstall record points at, `file` takes the first
 * existing expanded candidate, `scan` picks the newest versioned install
 * directory, and `cli` resolves a PATH name.
 */
export type OpenInAppLocator =
  | { readonly kind: "fixed"; readonly launch: OpenInAppLaunch; readonly iconPath?: string }
  | { readonly kind: "app-bundle"; readonly names: readonly string[] }
  | { readonly kind: "app-paths"; readonly exe: string; readonly args: readonly string[] }
  | {
      readonly kind: "install-record";
      readonly displayNamePrefix: string;
      readonly relativeLauncher?: string;
      readonly args: readonly string[];
    }
  | { readonly kind: "file"; readonly candidates: readonly string[]; readonly args: readonly string[] }
  | {
      readonly kind: "scan";
      readonly root: string;
      readonly namePrefix: string;
      readonly relativeLauncher: string;
      readonly args: readonly string[];
    }
  | { readonly kind: "cli"; readonly name: string; readonly args: readonly string[] };

export interface OpenInAppCatalogEntry {
  readonly id: string;
  readonly platforms: Readonly<Partial<Record<OpenInAppPlatform, readonly OpenInAppLocator[]>>>;
}

/** In-process PATH-name locator that appends the workspace directory. */
function cli(name: string, ...args: string[]): OpenInAppLocator {
  return { kind: "cli", name, args };
}

/** First-existing-file locator launching the matched candidate. */
function file(candidates: string[], ...args: string[]): OpenInAppLocator {
  return { kind: "file", candidates, args };
}

/** Windows `App Paths` registry locator for one registered executable name. */
function appPaths(exe: string, ...args: string[]): OpenInAppLocator {
  return { kind: "app-paths", exe, args };
}

/** Windows Uninstall-record locator verified through the executable it points at. */
function installRecord(displayNamePrefix: string, relativeLauncher?: string, ...args: string[]): OpenInAppLocator {
  return { kind: "install-record", displayNamePrefix, relativeLauncher, args };
}

/** JetBrains product: newest versioned Windows install, verified Uninstall record, or PATH command. */
function jetBrains(
  id: string,
  productName: string,
  cliName: string,
  winExe: string,
  macNames: readonly string[],
): OpenInAppCatalogEntry {
  return {
    id,
    platforms: {
      darwin: [{ kind: "app-bundle", names: macNames }],
      win32: [
        {
          kind: "scan",
          root: "${ProgramFiles}/JetBrains",
          namePrefix: productName,
          relativeLauncher: `bin/${winExe}`,
          args: [],
        },
        installRecord(productName, `bin/${winExe}`),
      ],
      linux: [cli(cliName)],
    },
  };
}

/**
 * The catalog in menu order: file managers, editors and IDEs, terminals.
 * Edition-specific ids stay separate so the remembered choice names exactly
 * one installed application.
 */
export const OPEN_IN_APP_CATALOG: readonly OpenInAppCatalogEntry[] = [
  {
    id: "finder",
    platforms: {
      darwin: [
        {
          kind: "fixed",
          launch: { kind: "shell-open" },
          iconPath: "/System/Library/CoreServices/Finder.app",
        },
      ],
    },
  },
  {
    id: "explorer",
    platforms: {
      win32: [{ kind: "fixed", launch: { kind: "shell-open" }, iconPath: "${SystemRoot}/explorer.exe" }],
    },
  },
  {
    id: "filemanager",
    platforms: { linux: [{ kind: "fixed", launch: { kind: "shell-open" } }] },
  },
  {
    id: "cursor",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Cursor.app"] }],
      win32: [appPaths("Cursor.exe"), installRecord("Cursor"), file(["${LOCALAPPDATA}/Programs/cursor/Cursor.exe"])],
      linux: [cli("cursor")],
    },
  },
  {
    id: "vscode",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Visual Studio Code.app"] }],
      win32: [
        appPaths("Code.exe"),
        installRecord("Microsoft Visual Studio Code", "Code.exe"),
        file(["${LOCALAPPDATA}/Programs/Microsoft VS Code/Code.exe", "${ProgramFiles}/Microsoft VS Code/Code.exe"]),
      ],
      linux: [cli("code")],
    },
  },
  {
    id: "vscodeInsiders",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Visual Studio Code - Insiders.app"] }],
      win32: [
        appPaths("Code - Insiders.exe"),
        installRecord("Microsoft Visual Studio Code Insiders", "Code - Insiders.exe"),
        file(["${LOCALAPPDATA}/Programs/Microsoft VS Code Insiders/Code - Insiders.exe"]),
      ],
      linux: [cli("code-insiders")],
    },
  },
  {
    id: "windsurf",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Windsurf.app"] }],
      win32: [
        appPaths("Windsurf.exe"),
        installRecord("Windsurf"),
        file(["${LOCALAPPDATA}/Programs/Windsurf/Windsurf.exe"]),
      ],
      linux: [cli("windsurf")],
    },
  },
  {
    id: "zed",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Zed.app", "Zed Preview.app"] }],
      linux: [cli("zed")],
    },
  },
  {
    id: "sublimeText",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Sublime Text.app"] }],
      win32: [
        appPaths("sublime_text.exe"),
        installRecord("Sublime Text"),
        file(["${ProgramFiles}/Sublime Text/sublime_text.exe"]),
      ],
      linux: [cli("subl")],
    },
  },
  {
    id: "androidStudio",
    platforms: {
      darwin: [{ kind: "app-bundle", names: ["Android Studio.app"] }],
      win32: [
        installRecord("Android Studio", "bin/studio64.exe"),
        file([
          "${ProgramFiles}/Android/Android Studio/bin/studio64.exe",
          "${LOCALAPPDATA}/Programs/Android Studio/bin/studio64.exe",
        ]),
      ],
      linux: [cli("studio")],
    },
  },
  jetBrains("intellij", "IntelliJ IDEA", "idea", "idea64.exe", [
    "IntelliJ IDEA.app",
    "IntelliJ IDEA Ultimate.app",
    "IntelliJ IDEA CE.app",
  ]),
  jetBrains("pycharm", "PyCharm", "pycharm", "pycharm64.exe", [
    "PyCharm.app",
    "PyCharm Professional.app",
    "PyCharm CE.app",
  ]),
  jetBrains("webstorm", "WebStorm", "webstorm", "webstorm64.exe", ["WebStorm.app"]),
  jetBrains("goland", "GoLand", "goland", "goland64.exe", ["GoLand.app"]),
  {
    id: "windowsTerminal",
    platforms: { win32: [cli("wt", "-d", PATH_TOKEN)] },
  },
  {
    id: "gitbash",
    platforms: {
      win32: [
        // Git for Windows registers as "Git version <x.y.z>"; the bare "Git"
        // prefix would also match unrelated Git tooling.
        installRecord("Git version", "git-bash.exe", `--cd=${PATH_TOKEN}`),
        file(["${ProgramFiles}/Git/git-bash.exe"], `--cd=${PATH_TOKEN}`),
      ],
    },
  },
  {
    id: "terminal",
    platforms: {
      darwin: [
        {
          kind: "fixed",
          launch: { kind: "argv", command: "open", args: ["-a", "Terminal"] },
          iconPath: "/System/Applications/Utilities/Terminal.app",
        },
      ],
    },
  },
];
