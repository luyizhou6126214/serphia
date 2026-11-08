import assert from "node:assert/strict";
import test from "node:test";

import {
  createPathResolver,
  entriesForPlatform,
  expandCandidate,
  parseRegistryDump,
  resolveApplications,
} from "./resolver.ts";

const ENV = {
  ProgramFiles: "C:/Program Files",
  LOCALAPPDATA: "C:/Users/me/AppData/Local",
  SystemRoot: "C:/Windows",
  PATH: "",
};

const REGISTRY_DUMP = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe
    (Default)    REG_EXPAND_SZ    "%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe"
    Path    REG_SZ    %LOCALAPPDATA%/Programs/Microsoft VS Code/bin

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1
    DisplayName    REG_SZ    Git version 2.44.0
    InstallLocation    REG_SZ    "\${ProgramFiles}/Git"
    NoModify    REG_DWORD    0x1
`;

/** Windows accepts either separator; the assertions stay separator-independent. */
function normalize(target) {
  return typeof target === "string" ? target.replace(/\\/g, "/") : target;
}

/** One launch with separator-independent paths. */
function normalizedLaunch(application) {
  if (!application) return undefined;
  const launch = application.launch;
  return {
    iconPath: normalize(application.iconPath),
    launch:
      launch.kind === "argv"
        ? { kind: "argv", command: normalize(launch.command), args: launch.args.map(normalize) }
        : { kind: "shell-open" },
  };
}

/** Resolution facts over an in-memory filesystem. */
function resolverDependencies({ files = [], directories = [], entries = {}, pathNames = {}, registry } = {}) {
  const fileSet = new Set(files);
  return {
    platform: "win32",
    env: ENV,
    home: "C:/Users/me",
    applicationRoots: ["/Applications", "C:/Users/me/Applications"],
    isFile: async (target) => fileSet.has(normalize(target)),
    isDirectory: async (target) => directories.map(normalize).includes(normalize(target)),
    readDirectory: async (target) => entries[normalize(target)] ?? [],
    resolveOnPath: async (name) => pathNames[name] ?? null,
    readRegistry: async () => registry ?? { appPaths: new Map(), installRecords: [] },
  };
}

test("Windows resolution verifies each locator kind and keeps catalog order", async () => {
  const registry = {
    appPaths: new Map([["code.exe", "C:/Program Files/Microsoft VS Code/Code.exe"]]),
    installRecords: [
      { displayName: "Git version 2.44.0", installLocation: "C:/Program Files/Git" },
      { displayName: "Unrelated App", displayIcon: "C:/Program Files/Unrelated/app.exe" },
    ],
  };
  const resolved = await resolveApplications(
    resolverDependencies({
      files: [
        "C:/Program Files/Microsoft VS Code/Code.exe",
        "C:/Program Files/JetBrains/IntelliJ IDEA 2024.1.1/bin/idea64.exe",
        "C:/Program Files/Git/git-bash.exe",
        "C:/Program Files/Unrelated/app.exe",
      ],
      entries: {
        "C:/Program Files/JetBrains": ["IntelliJ IDEA 2024.1", "IntelliJ IDEA 2024.1.1", "PyCharm 2024.1"],
      },
      pathNames: { wt: "C:/Windows/System32/wt.exe" },
      registry,
    }),
  );

  assert.deepEqual([...resolved.keys()], ["explorer", "vscode", "intellij", "windowsTerminal", "gitbash"]);
  assert.deepEqual(normalizedLaunch(resolved.get("explorer")), {
    iconPath: "C:/Windows/explorer.exe",
    launch: { kind: "shell-open" },
  });
  assert.deepEqual(normalizedLaunch(resolved.get("vscode")), {
    iconPath: "C:/Program Files/Microsoft VS Code/Code.exe",
    launch: { kind: "argv", command: "C:/Program Files/Microsoft VS Code/Code.exe", args: [] },
  });
  // The newest versioned JetBrains install wins, and its own executable is the icon.
  assert.deepEqual(normalizedLaunch(resolved.get("intellij")), {
    iconPath: "C:/Program Files/JetBrains/IntelliJ IDEA 2024.1.1/bin/idea64.exe",
    launch: { kind: "argv", command: "C:/Program Files/JetBrains/IntelliJ IDEA 2024.1.1/bin/idea64.exe", args: [] },
  });
  assert.deepEqual(normalizedLaunch(resolved.get("gitbash")), {
    iconPath: "C:/Program Files/Git/git-bash.exe",
    launch: { kind: "argv", command: "C:/Program Files/Git/git-bash.exe", args: ["--cd={path}"] },
  });
  assert.deepEqual(normalizedLaunch(resolved.get("windowsTerminal")), {
    iconPath: "C:/Windows/System32/wt.exe",
    launch: { kind: "argv", command: "C:/Windows/System32/wt.exe", args: ["-d", "{path}"] },
  });
});

test("an install record without a verified executable proves nothing", async () => {
  const resolved = await resolveApplications(
    resolverDependencies({
      registry: {
        appPaths: new Map(),
        installRecords: [
          // InstallLocation names no launcher file, and DisplayIcon names no file either.
          { displayName: "Cursor", installLocation: "C:/Users/me/AppData/Local/Programs/cursor" },
          { displayName: "Git version 2.44.0", displayIcon: "C:/Program Files/Git/git-bash.exe,0" },
        ],
      },
    }),
  );
  assert.equal(resolved.has("cursor"), false);
  assert.equal(resolved.has("gitbash"), false);
});

test("macOS resolves bundles and appends the directory to open", async () => {
  const dependencies = resolverDependencies();
  const resolved = await resolveApplications({
    ...dependencies,
    platform: "darwin",
    isDirectory: async (target) => target === "/Applications/Cursor.app",
  });
  assert.deepEqual(normalizedLaunch(resolved.get("cursor")), {
    iconPath: "/Applications/Cursor.app",
    launch: { kind: "argv", command: "open", args: ["-a", "/Applications/Cursor.app"] },
  });
  assert.equal(resolved.has("explorer"), false);
  assert.equal(resolved.has("finder"), true);
});

test("Linux resolves PATH commands without an icon source", async () => {
  const dependencies = resolverDependencies();
  const resolved = await resolveApplications({
    ...dependencies,
    platform: "linux",
    resolveOnPath: async (name) => (name === "code" ? "/usr/bin/code" : null),
  });
  assert.deepEqual(normalizedLaunch(resolved.get("vscode")), {
    iconPath: null,
    launch: { kind: "argv", command: "/usr/bin/code", args: [] },
  });
  assert.equal(resolved.has("filemanager"), true);
});

test("unsupported platforms expose no catalog entries", async () => {
  assert.deepEqual(entriesForPlatform("freebsd"), []);
  const resolved = await resolveApplications({ ...resolverDependencies(), platform: "freebsd" });
  assert.equal(resolved.size, 0);
});

test("registry parsing keeps string values and normalizes the localized default marker", () => {
  const parsed = parseRegistryDump(REGISTRY_DUMP);
  const code = parsed.get("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe");
  // The dump keeps the registry's own quoting; resolution strips it before use.
  assert.equal(code?.get("(Default)"), '"%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe"');
  assert.equal(code?.get("Path"), "%LOCALAPPDATA%/Programs/Microsoft VS Code/bin");
  const git = parsed.get("HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1");
  assert.equal(git?.get("DisplayName"), "Git version 2.44.0");
  // Non-string values are not launcher candidates.
  assert.equal(git?.has("NoModify"), false);
});

test("candidate templates expand the environment and home directory", () => {
  assert.equal(
    normalize(expandCandidate("${ProgramFiles}/Git/git-bash.exe", ENV, "C:/Users/me")),
    "C:/Program Files/Git/git-bash.exe",
  );
  assert.equal(
    normalize(expandCandidate("~/Applications/Cursor.app", ENV, "C:/Users/me")),
    "C:/Users/me/Applications/Cursor.app",
  );
  assert.equal(expandCandidate("${Missing}/tool.exe", ENV, "C:/Users/me"), null);
});

test("PATH resolution probes each PATHEXT candidate without a shell", async () => {
  const probed = [];
  const resolveOnPath = createPathResolver("win32", { PATH: "C:/one;C:/two", PATHEXT: ".COM;.EXE" }, async (target) => {
    probed.push(normalize(target));
    return normalize(target) === "C:/two/wt.exe";
  });
  assert.equal(normalize(await resolveOnPath("wt")), "C:/two/wt.exe");
  assert.deepEqual(probed, ["C:/one/wt.com", "C:/one/wt.exe", "C:/two/wt.com", "C:/two/wt.exe"]);
  assert.equal(await resolveOnPath("missing"), null);
});
