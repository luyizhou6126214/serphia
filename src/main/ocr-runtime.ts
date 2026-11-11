import { createHash } from "node:crypto";
import { access, lstat, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import catalog from "../../build/ocr/runtime-catalog.json" with { type: "json" };
import { darwinCodeDigest } from "./toolchains/darwin-binary-integrity.ts";

export async function resolveOcrRuntime(
  root: string,
  platform = process.platform,
  arch: string = process.arch,
): Promise<{ executable: string; version: string }> {
  const target = `${platform}-${arch}`;
  const artifact = catalog.artifacts[target as keyof typeof catalog.artifacts];
  if (!artifact) throw new Error("Unsupported Open Code Review platform");
  const dir = path.join(root, "ocr", "bin", target);
  const name = platform === "win32" ? "ocr.exe" : "ocr";
  const executable = path.join(dir, name);
  const stat = await lstat(executable);
  if (!stat.isFile() || stat.size > 80 * 1024 * 1024) throw new Error("Invalid OCR executable");
  if (platform !== "win32") await access(executable, constants.X_OK);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.version !== catalog.version ||
    manifest.target !== target ||
    manifest.executable !== name ||
    manifest.sha256 !== artifact.sha256 ||
    manifest.bytes !== artifact.bytes
  )
    throw new Error("OCR manifest does not match the release");
  const binary = await readFile(executable);
  const matchesRelease =
    binary.length === artifact.bytes && createHash("sha256").update(binary).digest("hex") === artifact.sha256;
  if (!matchesRelease) {
    const code = platform === "darwin" && darwinCodeDigest(binary, manifest.darwinCode?.bytes);
    if (!code || code.sha256 !== manifest.darwinCode?.sha256 || code.bytes !== manifest.darwinCode?.bytes) {
      throw new Error("OCR executable failed verification");
    }
  }
  return { executable, version: catalog.version };
}
