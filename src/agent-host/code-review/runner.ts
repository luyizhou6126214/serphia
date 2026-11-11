import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { callMain } from "../parent-rpc";
import { PosixManagedProcessBackend } from "../managed-process/posix-backend";
import { WindowsByteProcessChild } from "../managed-process/windows-byte-child";
import { ReviewError } from "./output";

type Options = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  timeout: number;
  onStdout?: (bytes: Buffer) => void;
  onStderr?: (bytes: Buffer) => void;
};

const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_DIAGNOSTICS = 64 * 1024;

export async function runOcr(options: Options) {
  const { executable, args, cwd, env, signal } = options;
  signal.throwIfAborted();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new ReviewError("timeout")), options.timeout);
  const runSignal = AbortSignal.any([signal, controller.signal]);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  function collectStdout(bytes: Buffer) {
    stdoutBytes += bytes.length;
    if (stdoutBytes > MAX_OUTPUT) controller.abort(new ReviewError("scopeLimit"));
    else stdout.push(bytes);
    options.onStdout?.(bytes);
  }
  function collectStderr(bytes: Buffer) {
    options.onStderr?.(bytes);
    if (stderrBytes < MAX_DIAGNOSTICS) {
      const chunk = bytes.subarray(0, MAX_DIAGNOSTICS - stderrBytes);
      stderrBytes += chunk.length;
      stderr.push(chunk);
    }
  }

  try {
    let code: number | null;
    if (process.platform === "win32") {
      const child = new WindowsByteProcessChild(executable, args, randomUUID(), {
        cwd,
        env,
        processPrefix: "ocr",
        capabilityScope: "transport",
      });
      child.stdout.on("data", collectStdout);
      child.stderr.on("data", collectStderr);
      let failed = false;
      child.on("error", () => {
        failed = true;
      });
      const stop = () => child.kill("SIGKILL");
      runSignal.addEventListener("abort", stop, { once: true });
      try {
        if (runSignal.aborted) stop();
        await new Promise<void>((resolve) => child.once("close", resolve));
        code = child.targetExitCode;
        runSignal.throwIfAborted();
        if (failed) throw new ReviewError("containment");
      } finally {
        runSignal.removeEventListener("abort", stop);
      }
    } else {
      if (process.platform !== "darwin" && process.platform !== "linux") throw new ReviewError("containment");
      const settings = await callMain<{ reaperReady: boolean }>("managedProcesses.getSettings", undefined, 5000);
      runSignal.throwIfAborted();
      if (!settings.reaperReady) throw new ReviewError("containment");
      const backend = new PosixManagedProcessBackend({
        platform: process.platform,
        workerEntryPath: fileURLToPath(new URL("managed-process-worker.mjs", import.meta.url)),
        hostInstanceId: randomUUID(),
      });
      let exitCode: number | null = null;
      let clean = false;
      const off = backend.onEvent((event) => {
        if (event.type === "stdout") collectStdout(event.bytes);
        if (event.type === "stderr") collectStderr(event.bytes);
        if (event.type === "exit") {
          exitCode = event.exit.code;
          clean = event.exit.reason !== "host-failure";
        }
      });
      const stop = () => {
        void backend.stop("force", "user").catch(() => undefined);
      };
      runSignal.addEventListener("abort", stop, { once: true });
      let record: Awaited<ReturnType<typeof backend.prepare>>["reaper"] | undefined;
      try {
        const prepared = await backend.prepare(
          {
            executable,
            args,
            cwd,
            env,
            processId: `ocr-${randomUUID()}`,
            runId: randomUUID(),
          },
          runSignal,
        );
        const registered = await callMain<{ journalRevision: number }>(
          "managedProcesses.register",
          {
            record: prepared.reaper,
          },
          5000,
        );
        record = prepared.reaper;
        await backend.commit(prepared, registered.journalRevision);
        if (runSignal.aborted) stop();
        await backend.waitForExit();
        runSignal.throwIfAborted();
        if (!clean) throw new ReviewError("containment");
        code = exitCode;
      } finally {
        runSignal.removeEventListener("abort", stop);
        await backend.dispose();
        off();
        if (clean && record) {
          await callMain(
            "managedProcesses.unregister",
            {
              processId: record.processId,
              runId: record.runId,
              hostInstanceId: record.hostInstanceId,
              nonce: record.nonce,
            },
            5000,
          );
        }
      }
    }
    return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
  } catch (error) {
    if (runSignal.aborted) runSignal.throwIfAborted();
    throw error instanceof ReviewError ? error : new ReviewError("containment");
  } finally {
    clearTimeout(deadline);
  }
}
