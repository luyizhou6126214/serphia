import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { resolveElectronBinary, terminateProcessTree } from "./process-utils.mjs";
import { prepareDesktopWindowDriver } from "./prepare-desktop-window-driver.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!(await prepareDesktopWindowDriver(root))) throw new Error("Windows x64 is required");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "serphia-desktop-window-test-"));
try {
  const outfile = path.join(temp, "main.cjs");
  buildSync({
    absWorkingDir: root,
    entryPoints: ["src/smoke/desktop-window-prototype.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile,
  });
  const child = spawn(resolveElectronBinary(root), [outfile], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SERPHIA_DESKTOP_WINDOW_TEST_ROOT: temp,
      SERPHIA_DESKTOP_WINDOW_TEST_RESOURCES: process.argv[2] ?? path.join(root, "out", "native"),
    },
  });
  process.exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error("Desktop window harness timed out");
      terminateProcessTree(child);
    }, 45_000);
    child.once("error", (error) => {
      console.error(error);
      clearTimeout(timer);
      resolve(1);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
