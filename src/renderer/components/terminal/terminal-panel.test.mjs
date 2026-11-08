import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TerminalPanel.tsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../AppShell.tsx", import.meta.url), "utf8");
const deferred = readFileSync(new URL("../DeferredPanels.tsx", import.meta.url), "utf8");

test("the terminal screen attaches before streaming and replays the retained backlog", () => {
  // Subscribe first, attach second, then drop frames the backlog already covers.
  assert.match(source, /onTerminalEvent\(/);
  assert.match(source, /attachTerminal\(terminalId\)/);
  assert.match(source, /lastSeq = result\.seq/);
  assert.match(source, /if \(event\.seq <= lastSeq\) return/);
  assert.match(source, /result\.backlog !== ""/);
  assert.match(source, /buffer/i);
});

test("the terminal screen owns input, sizing, and the ended state", () => {
  assert.match(source, /xterm\.onData\(/);
  assert.match(source, /writeTerminal\(terminalId/);
  assert.match(source, /new ResizeObserver\(/);
  assert.match(source, /resizeTerminal\(terminalId/);
  assert.match(source, /fit\.proposeDimensions\(\)/);
  assert.match(source, /rightPanelTerminalExited/);
  assert.match(source, /rightPanelTerminalClose/);
  assert.match(source, /onNewTerminal/);
});

test("AppShell starts, titles, and closes Host terminals instead of Herdr panes", () => {
  assert.match(appShell, /createTerminal\(\{/);
  assert.match(appShell, /closeTerminal\(tab\.terminalId\)/);
  assert.match(appShell, /kind === "terminal" && tab\.terminalId !== undefined/);
  assert.match(appShell, /onTitleChange=\{\(title\) =>/);
  assert.match(appShell, /listTerminals\(\)/);
  assert.match(appShell, /terminalShells\.length > 1/);
  assert.doesNotMatch(appShell, /herdr\.workspace\.create/);
  assert.doesNotMatch(appShell, /useHerdrFleet|useHerdrRuntime/);
  assert.match(deferred, /import\("\.\/terminal\/TerminalPanel"\)/);
  assert.doesNotMatch(deferred, /TerminalDock/);
});
