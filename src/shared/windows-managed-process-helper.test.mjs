import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clearInterval, setInterval } from "node:timers";
import {
  resolveWindowsManagedProcessHelper,
  resolveWindowsManagedProcessHelperWithRetry,
  verifyWindowsManagedProcessHelperReplaceable,
} from "./windows-managed-process-helper.ts";

async function fixture(packaged = false) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-helper-resolution-"));
  const directory = packaged
    ? path.join(root, "managed-process", "win32-x64")
    : path.join(root, "out", "native", "windows-managed-process-helper");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from("fixed helper bytes");
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    buildId: "pimpd-0.1.13-p1-abcdef123456",
    arch: "x64",
    provenance: "windows-native-dev",
    file: "pi-managed-process-helper.exe",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceRevision: "abcdef123456",
    targetTriple: "x86_64-pc-windows-msvc",
  };
  await writeFile(path.join(directory, manifest.file), bytes);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return { root, directory, manifest, bytes };
}

test("Windows helper resolution accepts only the fixed development or packaged directory", async () => {
  const development = await fixture(false);
  const dev = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: "C:\\ignored",
    projectRoot: development.root,
    verifyExecutable: false,
  });
  assert.equal(dev.ok, true);
  assert.equal(dev.descriptor.path, await realpath(path.join(development.directory, development.manifest.file)));

  const packaged = await fixture(true);
  const release = resolveWindowsManagedProcessHelper({
    isPackaged: true,
    resourcesPath: packaged.root,
    projectRoot: "C:\\ignored",
    verifyExecutable: false,
  });
  assert.equal(release.ok, true);
  assert.equal(release.descriptor.path, await realpath(path.join(packaged.directory, packaged.manifest.file)));
});

test("Windows helper resolution fails closed on manifest drift and byte tampering", async () => {
  const value = await fixture(false);
  await writeFile(path.join(value.directory, "manifest.json"), JSON.stringify({ ...value.manifest, extra: true }));
  assert.deepEqual(
    resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    }),
    { ok: false, errorCode: "HELPER_INTEGRITY" },
  );
  await writeFile(path.join(value.directory, "manifest.json"), JSON.stringify(value.manifest));
  await writeFile(path.join(value.directory, value.manifest.file), Buffer.from("tampered"));
  assert.deepEqual(
    resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    }),
    { ok: false, errorCode: "HELPER_INTEGRITY" },
  );
});

test("startup retries a failed probe while preserving hash and version verification", async () => {
  const { root, directory, manifest } = await fixture();
  const options = { isPackaged: false, resourcesPath: root, projectRoot: root };
  const { arch, buildId, protocolVersion, provenance } = manifest;
  const version = JSON.stringify({ arch, buildId, protocolVersion, provenance });
  let attempts = 0;
  const result = await resolveWindowsManagedProcessHelperWithRetry(options, async () => {
    if (++attempts === 1) throw new Error("timed out");
    return version;
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);

  attempts = 0;
  const mismatch = await resolveWindowsManagedProcessHelperWithRetry(options, async () => {
    attempts++;
    return JSON.stringify({ ...JSON.parse(version), buildId: "unexpected" });
  });
  assert.deepEqual(mismatch, { ok: false, errorCode: "HELPER_INTEGRITY" });
  assert.equal(attempts, 1);

  attempts = 0;
  const changed = await resolveWindowsManagedProcessHelperWithRetry(options, async () => {
    attempts++;
    await writeFile(path.join(directory, manifest.file), "changed during the failed launch");
    throw new Error("timed out");
  });
  assert.deepEqual(changed, { ok: false, errorCode: "HELPER_INTEGRITY" });
  assert.equal(attempts, 1);
});

test("Windows update gate proves the fixed helper can be atomically moved and restored", async () => {
  const value = await fixture(false);
  const resolution = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: value.root,
    projectRoot: value.root,
    verifyExecutable: false,
  });
  assert.equal(resolution.ok, true);
  assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), true);
  assert.deepEqual(await readFile(resolution.descriptor.path), value.bytes);
});

test("Windows update gate fails closed when the helper is locked and never starts a move", async () => {
  const value = await fixture(false);
  const resolution = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: value.root,
    projectRoot: value.root,
    verifyExecutable: false,
  });
  assert.equal(resolution.ok, true);
  assert.equal(
    verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor, () => {
      const error = new Error("sharing violation");
      error.code = "EPERM";
      throw error;
    }),
    false,
  );
  assert.deepEqual(await readFile(resolution.descriptor.path), value.bytes);
});

test(
  "Windows update gate rejects a real sharing lock and succeeds after release",
  { skip: process.platform !== "win32", timeout: 10_000 },
  async () => {
    const value = await fixture(false);
    const resolution = resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    });
    assert.equal(resolution.ok, true);
    const script = [
      `$stream=[System.IO.File]::Open(${JSON.stringify(resolution.descriptor.path)},[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)`,
      '[Console]::Out.WriteLine("LOCKED")',
      "[Console]::In.ReadLine()|Out-Null",
      "$stream.Dispose()",
    ].join(";");
    const locker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    locker.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sharing lock did not become ready")), 5_000);
      const poll = setInterval(() => {
        if (!output.includes("LOCKED")) return;
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }, 20);
      locker.once("error", reject);
    });
    assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), false);
    locker.stdin.end("release\n");
    assert.equal(await new Promise((resolve) => locker.once("exit", resolve)), 0);
    assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), true);
  },
);
