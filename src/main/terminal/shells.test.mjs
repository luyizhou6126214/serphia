import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { discoverShells } from "./shells.ts";

/** Windows hosts accept both separators; assertions stay separator-independent. */
function normalize(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : value;
}

/** Discovery over an in-memory filesystem. */
function dependencies(platform, env, files, declared) {
  const fileSet = new Set(files.map(normalize));
  return {
    platform,
    env,
    isFile: (target) => fileSet.has(normalize(target)),
    readFile: (target) => (target === "/etc/shells" ? (declared ?? null) : null),
  };
}

test("Windows lists the installed shells in preference order", () => {
  const result = discoverShells(
    dependencies(
      "win32",
      {
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        ProgramFiles: "C:\\Program Files",
        PATH: "C:\\Program Files\\PowerShell\\7",
      },
      [
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "C:\\Windows\\System32\\cmd.exe",
        "C:\\Program Files\\Git\\bin\\bash.exe",
      ],
    ),
  );
  assert.deepEqual(
    result.shells.map((shell) => shell.label),
    ["PowerShell 7", "Windows PowerShell", "Command Prompt", "Git Bash"],
  );
  assert.deepEqual(
    result.shells.map((shell) => normalize(shell.executable)),
    [
      "C:/Program Files/PowerShell/7/pwsh.exe",
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      "C:/Windows/System32/cmd.exe",
      "C:/Program Files/Git/bin/bash.exe",
    ],
  );
  assert.equal(result.defaultShellId, result.shells[0].id);
  assert.deepEqual(result.shells[1].args, ["-NoLogo"], "PowerShell starts without its banner");
  assert.deepEqual(result.shells[3].args, ["-i"], "Git Bash starts interactively");
});

test("Windows falls back to cmd when no PowerShell is installed", () => {
  const result = discoverShells(
    dependencies("win32", { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe" }, [
      "C:\\Windows\\System32\\cmd.exe",
    ]),
  );
  assert.deepEqual(
    result.shells.map((shell) => shell.label),
    ["Command Prompt"],
  );
});

test("POSIX keeps the caller's shell first and reads /etc/shells", () => {
  const result = discoverShells(
    dependencies(
      "darwin",
      { SHELL: "/bin/zsh" },
      ["/bin/zsh", "/bin/sh", "/bin/bash", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"],
      "# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/opt/homebrew/bin/fish\n/opt/homebrew/bin/fish\n",
    ),
  );
  assert.deepEqual(
    result.shells.map((shell) => shell.label),
    ["zsh", "sh", "bash", "fish"],
  );
  assert.equal(result.defaultShellId, "/bin/zsh");
  assert.deepEqual(result.shells[0].args, []);
});

test("POSIX falls back to the standard shell paths when nothing is declared", () => {
  const result = discoverShells(dependencies("linux", { SHELL: "/usr/bin/missing" }, ["/bin/bash", "/bin/sh"]));
  assert.deepEqual(
    result.shells.map((shell) => shell.id),
    ["/bin/bash", "/bin/sh"],
  );
});

test("a host with no shell still resolves to an empty catalog", () => {
  const result = discoverShells(dependencies("linux", {}, []));
  assert.deepEqual(result.shells, []);
  assert.equal(result.defaultShellId, null);
  // The Windows candidate paths themselves never appear when nothing exists on disk.
  const windows = discoverShells(dependencies("win32", { SystemRoot: "C:\\Windows" }, []));
  assert.deepEqual(windows.shells, []);
});

test("the Windows PATH probe joins with the platform separator", () => {
  const result = discoverShells(
    dependencies("win32", { PATH: "C:\\first;C:\\second", SystemRoot: "C:\\Windows" }, ["C:\\second\\pwsh.exe"]),
  );
  assert.equal(path.isAbsolute(result.shells[0].executable), true);
  assert.match(normalize(result.shells[0].executable), /^C:\/second\/pwsh\.exe$/);
});
