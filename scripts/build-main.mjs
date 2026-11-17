#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSuccessfulSpawn, resolvePackageFile } from "./process-utils.mjs";
import { prepareOcrSdk } from "./prepare-ocr-sdk.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function cleanMainBuildOutputs(projectRoot = root) {
  fs.rmSync(path.join(projectRoot, "out", "main"), { recursive: true, force: true });
  fs.rmSync(path.join(projectRoot, "out", "preload"), { recursive: true, force: true });
}

function prepareMainBuild(projectRoot) {
  prepareOcrSdk(projectRoot);
  if (process.platform === "win32" && process.arch === "x64")
    assertSuccessfulSpawn(
      spawnSync(process.execPath, [path.join(projectRoot, "scripts", "prepare-desktop-window-driver.mjs")], {
        cwd: projectRoot,
        stdio: "inherit",
        windowsHide: true,
      }),
      "desktop window driver preparation",
    );
  cleanMainBuildOutputs(projectRoot);
}

export function buildMain(projectRoot = root) {
  prepareMainBuild(projectRoot);
  const tsupCli = resolvePackageFile(projectRoot, "tsup", "dist/cli-default.js");
  assertSuccessfulSpawn(
    spawnSync(process.execPath, [tsupCli, "--config", "tsup.config.ts"], {
      cwd: projectRoot,
      stdio: "inherit",
    }),
    "main/preload/host build",
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    if (process.argv.includes("--watch")) {
      prepareMainBuild(root);
      const { build } = await import("tsup");
      // The watch build also emits the initial bundles. Wait for every target to finish writing.
      await build({
        config: "tsup.config.ts",
        // tsup expands watch globs before applying ignore rules, so give it source paths only.
        watch: ["src/{main,preload,agent-host,contract,shared}/**/*", "package.json"],
      });
      process.send?.("build-ready");
    } else {
      buildMain();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    // A different tsup sub-config may have already started its watcher.
    process.exit(1);
  }
}
