/**
 * Platform resolution for the open-in-app catalog: every entry's locator chain
 * resolves to a launcher this host actually holds — an existing bundle, an
 * executable on disk, a registry target, or a PATH resolution — never a bare
 * install record. One pass yields the map the IPC handlers serve and launch
 * from, so a click never re-runs detection. PATH names resolve in-process; the
 * Windows registry is read through batched `reg.exe query` calls (argv, no
 * shell) at most once per pass.
 */

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  OPEN_IN_APP_CATALOG,
  type OpenInAppCatalogEntry,
  type OpenInAppLaunch,
  type OpenInAppLocator,
  type OpenInAppPlatform,
} from "./catalog.ts";

/** One catalog entry proven present on this host. */
export interface ResolvedApplication {
  readonly id: string;
  readonly launch: OpenInAppLaunch;
  /** Executable (Windows/Linux) or bundle (macOS) carrying the application icon. */
  readonly iconPath: string | null;
}

/** One Windows Uninstall record's fields relevant to launcher derivation. */
export interface WindowsInstallRecord {
  readonly displayName: string;
  readonly installLocation?: string;
  readonly displayIcon?: string;
}

/** The Windows registry facts shared by one resolution pass. */
export interface WindowsRegistryView {
  readonly appPaths: ReadonlyMap<string, string>;
  readonly installRecords: readonly WindowsInstallRecord[];
}

/** Everything resolution needs from the host, injectable for deterministic tests. */
export interface ResolverDependencies {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly applicationRoots: readonly string[];
  isFile(target: string): Promise<boolean>;
  isDirectory(target: string): Promise<boolean>;
  readDirectory(target: string): Promise<readonly string[]>;
  resolveOnPath(name: string): Promise<string | null>;
  readRegistry(): Promise<WindowsRegistryView>;
}

/** `App Paths` roots, user hive first (per-user installs shadow machine ones). */
const APP_PATHS_ROOTS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
] as const;

/** Uninstall-record roots: user hive, 64-bit machine hive, 32-bit machine view. */
const UNINSTALL_ROOTS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
] as const;

const REGISTRY_TIMEOUT_MS = 2_500;
const REGISTRY_MAX_BYTES = 4 * 1024 * 1024;

/** Catalog entries declared for one platform, in menu order. */
export function entriesForPlatform(
  platform: NodeJS.Platform,
): readonly (OpenInAppCatalogEntry & { readonly locators: readonly OpenInAppLocator[] })[] {
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return [];
  const key: OpenInAppPlatform = platform;
  return OPEN_IN_APP_CATALOG.flatMap((entry) => {
    const locators = entry.platforms[key];
    return locators === undefined ? [] : [{ ...entry, locators }];
  });
}

/**
 * Path flavor of the platform being resolved. Real hosts always match, so this
 * only keeps an injected platform's resolution deterministic in tests.
 */
function platformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Expand `${VAR}` references and a leading `~/` in a candidate template.
 * @param template - candidate template from the catalog.
 * @param env - host environment.
 * @param home - host home directory.
 * @returns the expanded candidate, or null when a referenced variable is unset.
 */
export function expandCandidate(
  template: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string | null {
  const unset: string[] = [];
  const expanded = template.replace(/\$\{([^}]+)\}/g, (token, name: string) => {
    const value = env[name];
    if (value === undefined || value === "") unset.push(name);
    return value ?? token;
  });
  if (unset.length > 0) return null;
  return expanded.startsWith("~/") ? path.join(home, expanded.slice(2)) : expanded;
}

/** Expand `%VAR%` references in a Windows registry value; null when one is unset. */
function expandRegistryValue(value: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const unset: string[] = [];
  const expanded = value.replace(/%([^%]+)%/g, (token, name: string) => {
    const found = env[name];
    if (found === undefined) unset.push(name);
    return found ?? token;
  });
  return unset.length > 0 ? null : expanded;
}

/**
 * Parse `reg.exe query <root> /s` output into per-subkey string values.
 * Value columns are matched by the `REG_*` type token because the default-value
 * marker localizes (`(Default)`, `(默认)`); every locale wraps it in parentheses.
 * @param dump - raw `reg.exe` stdout.
 * @returns subkey path to its string values by value name.
 */
export function parseRegistryDump(dump: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const keys = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of dump.split(/\r?\n/)) {
    if (/^HK/.test(line)) {
      current = new Map();
      keys.set(line.trim(), current);
      continue;
    }
    const value = /^\s+(.*?)\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*)$/.exec(line);
    if (value === null || current === undefined) continue;
    const [name, data] = [value[1] ?? "", value[3] ?? ""];
    current.set(/^\(.*\)$/.test(name) ? "(Default)" : name, data.trim());
  }
  return keys;
}

/** Run one bounded `reg.exe query` and read its stdout; a failure reads as empty. */
function queryRegistry(root: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", root, "/s"],
      { timeout: REGISTRY_TIMEOUT_MS, windowsHide: true, maxBuffer: REGISTRY_MAX_BYTES },
      (error, stdout) => {
        resolve(error ? "" : String(stdout ?? ""));
      },
    );
  });
}

/**
 * Read the Windows `App Paths` table and the Uninstall records: one
 * `reg.exe query /s` per root, all in parallel. A root that fails or is absent
 * contributes nothing.
 * @param env - host environment for `%VAR%` expansion.
 * @returns the parsed view.
 */
export async function readWindowsRegistryView(
  env: Readonly<Record<string, string | undefined>>,
): Promise<WindowsRegistryView> {
  const [appPathDumps, uninstallDumps] = await Promise.all([
    Promise.all(APP_PATHS_ROOTS.map((root) => queryRegistry(root))),
    Promise.all(UNINSTALL_ROOTS.map((root) => queryRegistry(root))),
  ]);
  const appPaths = new Map<string, string>();
  for (const dump of appPathDumps) {
    for (const [key, values] of parseRegistryDump(dump)) {
      // Registry keys separate with '\' on every host this parser runs on
      // (tests parse fixtures on POSIX), so path.basename does not apply.
      const exe = key.slice(key.lastIndexOf("\\") + 1).toLowerCase();
      const target = values.get("(Default)");
      if (!exe.endsWith(".exe") || target === undefined || appPaths.has(exe)) continue;
      const expanded = expandRegistryValue(target.replace(/^"|"$/g, ""), env);
      if (expanded !== null) appPaths.set(exe, expanded);
    }
  }
  const installRecords: WindowsInstallRecord[] = [];
  for (const dump of uninstallDumps) {
    for (const values of parseRegistryDump(dump).values()) {
      const displayName = values.get("DisplayName");
      if (displayName === undefined) continue;
      const installLocation = values.get("InstallLocation");
      const displayIcon = values.get("DisplayIcon");
      installRecords.push({
        displayName,
        ...(installLocation === undefined ? {} : { installLocation }),
        ...(displayIcon === undefined ? {} : { displayIcon }),
      });
    }
  }
  return { appPaths, installRecords };
}

/** Registry view used when the registry cannot be read at all. */
const EMPTY_REGISTRY: WindowsRegistryView = { appPaths: new Map(), installRecords: [] };

/** PATH/PATHEXT lookup without a shell; the first existing candidate wins. */
export function createPathResolver(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  isFile: (target: string) => Promise<boolean>,
): (name: string) => Promise<string | null> {
  const pathValue = env.PATH ?? env.Path ?? "";
  const paths = platformPath(platform);
  const separator = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(separator).filter((entry) => entry !== "");
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((entry) => entry !== "") : [""];
  return async (name) => {
    const names =
      path.extname(name) === "" ? extensions.map((extension) => `${name}${extension.toLowerCase()}`) : [name];
    for (const directory of directories) {
      for (const candidate of names) {
        const target = paths.join(directory, candidate);
        if (await isFile(target)) return target;
      }
    }
    return null;
  };
}

/** Probe one path as an existing regular file; unreadable paths are absent. */
async function existingFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/** Probe one path as an existing directory; unreadable paths are absent. */
async function existingDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Default dependencies for the running host.
 * @returns resolution facts read from this process and filesystem.
 */
export function createResolverDependencies(): ResolverDependencies {
  const platform = process.platform;
  const env = process.env;
  const home = homedir();
  let registry: Promise<WindowsRegistryView> | null = null;
  const dependencies: ResolverDependencies = {
    platform,
    env,
    home,
    applicationRoots: ["/Applications", path.join(home, "Applications")],
    isFile: existingFile,
    isDirectory: existingDirectory,
    readDirectory: async (target) => {
      try {
        return await readdir(target);
      } catch {
        return [];
      }
    },
    resolveOnPath: createPathResolver(platform, env, existingFile),
    readRegistry: () => {
      registry ??= readWindowsRegistryView(env).catch(() => EMPTY_REGISTRY);
      return registry;
    },
  };
  return dependencies;
}

/** The executable a Windows Uninstall record proves, or null when it proves none. */
async function recordLauncher(
  record: WindowsInstallRecord,
  relativeLauncher: string | undefined,
  dependencies: ResolverDependencies,
): Promise<string | null> {
  const paths = platformPath(dependencies.platform);
  if (relativeLauncher !== undefined && record.installLocation !== undefined && record.installLocation !== "") {
    const expanded = expandRegistryValue(record.installLocation.replace(/^"|"$/g, ""), dependencies.env);
    if (expanded !== null) {
      const candidate = paths.join(expanded, relativeLauncher);
      if (await dependencies.isFile(candidate)) return candidate;
    }
  }
  if (record.displayIcon !== undefined) {
    // DisplayIcon may carry a `,<index>` suffix and quotes around the path.
    const bare = record.displayIcon
      .replace(/,-?\d+$/, "")
      .replace(/^"|"$/g, "")
      .trim();
    const expanded = expandRegistryValue(bare, dependencies.env);
    if (expanded !== null && expanded.toLowerCase().endsWith(".exe") && (await dependencies.isFile(expanded))) {
      return expanded;
    }
  }
  return null;
}

/** One verified launcher before its catalog id is attached. */
type LocatedLaunch = Omit<ResolvedApplication, "id">;

/** Resolve one locator to a verified launcher, or null when it proves nothing. */
async function locate(locator: OpenInAppLocator, dependencies: ResolverDependencies): Promise<LocatedLaunch | null> {
  const paths = platformPath(dependencies.platform);
  switch (locator.kind) {
    case "fixed": {
      const iconPath =
        locator.iconPath === undefined ? null : expandCandidate(locator.iconPath, dependencies.env, dependencies.home);
      return { launch: locator.launch, iconPath };
    }
    case "app-bundle": {
      if (dependencies.platform !== "darwin") return null;
      for (const root of dependencies.applicationRoots) {
        for (const name of locator.names) {
          const bundle = paths.join(root, name);
          if (await dependencies.isDirectory(bundle)) {
            return { launch: { kind: "argv", command: "open", args: ["-a", bundle] }, iconPath: bundle };
          }
        }
      }
      return null;
    }
    case "app-paths": {
      if (dependencies.platform !== "win32") return null;
      const view = await dependencies.readRegistry();
      const target = view.appPaths.get(locator.exe.toLowerCase());
      if (target === undefined || !(await dependencies.isFile(target))) return null;
      return { launch: { kind: "argv", command: target, args: locator.args }, iconPath: target };
    }
    case "install-record": {
      if (dependencies.platform !== "win32") return null;
      const view = await dependencies.readRegistry();
      for (const record of view.installRecords) {
        if (!record.displayName.toLowerCase().startsWith(locator.displayNamePrefix.toLowerCase())) continue;
        const launcher = await recordLauncher(record, locator.relativeLauncher, dependencies);
        if (launcher !== null) {
          return { launch: { kind: "argv", command: launcher, args: locator.args }, iconPath: launcher };
        }
      }
      return null;
    }
    case "file": {
      for (const candidate of locator.candidates) {
        const target = expandCandidate(candidate, dependencies.env, dependencies.home);
        if (target !== null && (await dependencies.isFile(target))) {
          return { launch: { kind: "argv", command: target, args: locator.args }, iconPath: target };
        }
      }
      return null;
    }
    case "scan": {
      const root = expandCandidate(locator.root, dependencies.env, dependencies.home);
      if (root === null) return null;
      // Version-suffixed directory names compare numeric-aware, newest first
      // ('2024.1.10' outranks '2024.1.9', which plain lexicographic misses).
      const versions = (await dependencies.readDirectory(root))
        .filter((entry) => entry.startsWith(locator.namePrefix))
        .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
      for (const version of versions) {
        const launcher = paths.join(root, version, locator.relativeLauncher);
        if (await dependencies.isFile(launcher)) {
          return { launch: { kind: "argv", command: launcher, args: locator.args }, iconPath: launcher };
        }
      }
      return null;
    }
    case "cli": {
      const found = await dependencies.resolveOnPath(locator.name);
      if (found === null) return null;
      return {
        launch: { kind: "argv", command: found, args: locator.args },
        iconPath: dependencies.platform === "win32" ? found : null,
      };
    }
    default:
      return null;
  }
}

/**
 * Resolve the whole catalog for this host in menu order.
 * @param dependencies - platform and filesystem facts.
 * @returns catalog id to verified launcher; entries nothing proves are absent.
 */
export async function resolveApplications(
  dependencies: ResolverDependencies = createResolverDependencies(),
): Promise<Map<string, ResolvedApplication>> {
  const found = await Promise.all(
    entriesForPlatform(dependencies.platform).map(async (entry) => {
      for (const locator of entry.locators) {
        const resolved = await locate(locator, dependencies);
        if (resolved !== null) return { ...resolved, id: entry.id };
      }
      return null;
    }),
  );
  const resolved = new Map<string, ResolvedApplication>();
  for (const application of found) {
    if (application !== null) resolved.set(application.id, application);
  }
  return resolved;
}
