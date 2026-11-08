import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { resolveNodePtyTarget } from "./session.ts";

test("a packaged app loads node-pty from the unpacked archive", () => {
  assert.equal(resolveNodePtyTarget(undefined), "node-pty");
  assert.equal(
    resolveNodePtyTarget("C:/app/resources", () => false),
    "node-pty",
    "a missing unpacked copy falls back to normal resolution",
  );
  const unpacked = path.join("C:/app/resources", "app.asar.unpacked", "node_modules", "node-pty");
  assert.equal(
    resolveNodePtyTarget("C:/app/resources", (target) => target === unpacked),
    unpacked,
  );
});

/**
 * node-pty keeps its ConPTY worker handles alive after a child exits, so the real
 * pty runs in a probe process that reports and exits on its own; this test reads
 * that report. The probe exercises a one-shot command and an interactive shell
 * (typed input, resize, close) through `TerminalSession`.
 */
test("a real pty runs a command and an interactive shell", () => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(import.meta.dirname, "pty-probe.mjs")],
    { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
  );
  if (result.error !== undefined) assert.fail(`pty probe failed to start: ${result.error.message}`);
  assert.equal(result.status, 0, `pty probe failed (status ${String(result.status)}): ${String(result.stderr).trim()}`);
  const report = JSON.parse(String(result.stdout).trim().split(/\r?\n/).at(-1) ?? "{}");
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.interactiveState, "exited");
  assert.ok(report.oneShotBacklog > 0, "the probe retained the command's output");
});
