import assert from "node:assert/strict";
import test from "node:test";

import {
  TERMINAL_SHELL_STORAGE_KEY,
  readTerminalShellChoice,
  selectTerminalShell,
  writeTerminalShellChoice,
} from "./terminal-shells.ts";

/** In-memory storage with the surface the preference helpers use. */
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[TERMINAL_SHELL_STORAGE_KEY, initial]]);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const SHELLS = [
  { id: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", label: "Windows PowerShell" },
  { id: "C:/Windows/System32/cmd.exe", label: "Command Prompt" },
];

test("the remembered shell persists and unreadable storage never throws", () => {
  const storage = memoryStorage();
  assert.equal(readTerminalShellChoice(storage), null);
  writeTerminalShellChoice("C:/Windows/System32/cmd.exe", storage);
  assert.equal(readTerminalShellChoice(storage), "C:/Windows/System32/cmd.exe");

  const broken = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  assert.equal(readTerminalShellChoice(broken), null);
  writeTerminalShellChoice("x", broken);
  assert.equal(readTerminalShellChoice(null), null);
  writeTerminalShellChoice("x", null);
});

test("a new terminal uses the remembered shell while it is still installed", () => {
  assert.equal(selectTerminalShell(SHELLS, "C:/Windows/System32/cmd.exe")?.label, "Command Prompt");
  // A remembered shell this host no longer lists falls back to the Host default.
  assert.equal(selectTerminalShell(SHELLS, "/bin/zsh")?.label, "Windows PowerShell");
  assert.equal(selectTerminalShell(SHELLS, null)?.label, "Windows PowerShell");
  assert.equal(selectTerminalShell([], "x"), undefined);
});
