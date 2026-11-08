/**
 * Real-pty probe run by `session.test.mjs` in its own process: node-pty keeps
 * ConPTY worker handles alive after the child exits, so a probe that reports and
 * exits is the only way to exercise a real terminal without leaking handles into
 * the test runner.
 *
 * Prints one JSON line on success and exits 0; any failure prints the reason and
 * exits 1. A hard timeout keeps a wedged pty from hanging the suite.
 */
import { TerminalSession } from "./session.ts";

const TIMEOUT_MS = 25_000;

const timeout = setTimeout(() => {
  console.error("pty-probe: timed out");
  process.exit(1);
}, TIMEOUT_MS);
timeout.unref();

/** One shell that runs `command` and exits. */
function oneShotShell(command) {
  if (process.platform === "win32") {
    return { id: "cmd", label: "Command Prompt", executable: process.env.ComSpec ?? "cmd.exe", args: ["/c", command] };
  }
  return { id: "/bin/sh", label: "sh", executable: "/bin/sh", args: ["-c", command] };
}

/** An interactive shell that stays open until it is closed. */
function interactiveShell() {
  if (process.platform === "win32") {
    return { id: "cmd", label: "Command Prompt", executable: process.env.ComSpec ?? "cmd.exe", args: [] };
  }
  return { id: "/bin/sh", label: "sh", executable: "/bin/sh", args: ["-i"] };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a predicate, polling until the deadline. */
async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(25);
  }
  return false;
}

/** Run one session and resolve with its exit code. */
function startSession(shell) {
  const chunks = [];
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const session = new TerminalSession({
    id: "probe",
    shell,
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    onData: (chunk) => chunks.push(chunk),
    onExit: (code) => resolveExit(code),
  });
  return { session, chunks, exited };
}

async function main() {
  const oneShot = startSession(oneShotShell("echo pty-marker-one"));
  const exitCode = await Promise.race([oneShot.exited, delay(15_000).then(() => "timeout")]);
  if (exitCode !== 0) throw new Error(`one-shot exit was ${String(exitCode)}`);
  if (!oneShot.chunks.join("").includes("pty-marker-one")) throw new Error("one-shot output missing marker");
  if (!oneShot.session.attach().backlog.includes("pty-marker-one")) throw new Error("backlog missing marker");
  if (oneShot.session.info.state !== "exited") throw new Error("session did not report its exit");
  oneShot.session.killNow();

  const interactive = startSession(interactiveShell());
  try {
    if (!(await waitFor(() => interactive.chunks.length > 0))) throw new Error("no prompt output");
    interactive.session.write(process.platform === "win32" ? "echo pty-marker-two\r" : "echo pty-marker-two\n");
    if (!(await waitFor(() => interactive.chunks.join("").includes("pty-marker-two")))) {
      throw new Error("typed command did not round-trip");
    }
    interactive.session.resize(100, 30);
    if (interactive.session.info.cols !== 100 || interactive.session.info.rows !== 30) {
      throw new Error("resize was not recorded");
    }
    await interactive.session.close();
    if (interactive.session.info.state !== "exited") throw new Error("close did not end the session");
  } finally {
    interactive.session.killNow();
  }

  console.log(
    JSON.stringify({
      ok: true,
      exitCode,
      oneShotBacklog: oneShot.session.attach().backlog.length,
      interactiveState: interactive.session.info.state,
    }),
  );
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(`pty-probe: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
