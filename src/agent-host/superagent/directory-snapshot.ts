import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { GitStatusEntry, GitStatusResult } from "../../shared/api-types";
import { createBoundedTextDiff, MAX_DIFF_INPUT_BYTES } from "../../shared/text-diff";

const previewLimit = 180_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

function snapshotRoot(dataDirectory: string, roomId: string): string {
  return path.resolve(dataDirectory, "snapshots", roomId);
}

function isGitMetadata(name: string): boolean {
  return name.toLowerCase() === ".git";
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (file) => {
      if (file !== source && isGitMetadata(path.basename(file))) return false;
      const info = await lstat(file);
      return info.isDirectory() || info.isFile();
    },
  });
}

export async function createDirectorySnapshot(dataDirectory: string, roomId: string, source: string, count: number) {
  const root = snapshotRoot(await realpath(dataDirectory), roomId);
  const relative = path.relative(source, root);
  if (!relative || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..")) {
    throw new Error("Choose a project directory that does not contain SuperAgent’s data directory");
  }
  const parent = path.dirname(root);
  await mkdir(parent, { recursive: true });
  // The removal target is a fresh direct child of the app-owned snapshot directory.
  if (path.relative(parent, await realpath(parent))) {
    throw new Error("The SuperAgent snapshot directory was moved");
  }
  await mkdir(root);
  const discard = () => rm(root, { recursive: true, force: true });
  try {
    const baseline = path.join(root, "baseline");
    await copyDirectory(source, baseline);
    const directories: string[] = [];
    for (let index = 0; index < count; index++) {
      const destination = path.join(root, `role-${index + 1}`);
      await copyDirectory(baseline, destination);
      directories.push(destination);
    }
    return { directories, discard };
  } catch (error) {
    await discard().catch(() => undefined);
    throw error;
  }
}

interface SnapshotFile {
  location: string;
  size: number;
}

async function listFiles(root: string): Promise<Map<string, SnapshotFile>> {
  if (!(await lstat(root)).isDirectory()) throw new Error("The SuperAgent directory copy is unavailable");
  const files = new Map<string, SnapshotFile>();
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (isGitMetadata(entry.name)) continue;
      const name = prefix + entry.name;
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location, name + "/");
      else if (entry.isFile()) files.set(name, { location, size: (await lstat(location)).size });
    }
  }
  await visit(root, "");
  return files;
}

async function digest(file: SnapshotFile): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file.location)) hash.update(chunk);
  return hash.digest("hex");
}

function textPreview(file: string, oldData: Buffer, newData: Buffer): string | undefined {
  if (oldData.includes(0) || newData.includes(0)) return undefined;
  let before: string;
  let after: string;
  try {
    before = decoder.decode(oldData);
    after = decoder.decode(newData);
  } catch {
    return undefined;
  }
  const result = createBoundedTextDiff(before, after);
  if (result.kind !== "lines") return undefined;
  const prefix = { unchanged: " ", removed: "-", added: "+" };
  return `--- a/${file}\n+++ b/${file}\n${result.lines.map((line) => prefix[line.type] + line.text).join("\n")}\n`;
}

export async function diffDirectorySnapshot(dataDirectory: string, roomId: string, cwd: string) {
  const baseline = path.join(snapshotRoot(dataDirectory, roomId), "baseline");
  const [original, current] = await Promise.all([listFiles(baseline), listFiles(cwd)]);
  const entries: GitStatusEntry[] = [];
  let diff = "";
  let truncated = false;
  for (const file of [...new Set([...original.keys(), ...current.keys()])].sort()) {
    const before = original.get(file);
    const after = current.get(file);
    let preview: string | undefined;
    if ((before?.size ?? 0) + (after?.size ?? 0) <= MAX_DIFF_INPUT_BYTES) {
      const [oldData, newData] = await Promise.all([
        before ? readFile(before.location) : Buffer.alloc(0),
        after ? readFile(after.location) : Buffer.alloc(0),
      ]);
      if (before && after && oldData.equals(newData)) continue;
      if (diff.length < previewLimit) preview = textPreview(file, oldData, newData);
    } else if (before && after && before.size === after.size) {
      const [oldHash, newHash] = await Promise.all([digest(before), digest(after)]);
      if (oldHash === newHash) continue;
    }
    entries.push({ path: file, index: " ", workingTree: before ? (after ? "M" : "D") : "A" });
    if (preview && diff.length + preview.length <= previewLimit) diff += preview;
    else if (before?.size || after?.size) truncated = true;
  }
  const untracked = entries.filter((entry) => entry.workingTree === "A").length;
  const status: GitStatusResult = {
    isGit: false,
    branch: null,
    clean: entries.length === 0,
    staged: 0,
    conflicted: 0,
    modified: entries.length - untracked,
    untracked,
    entries,
  };
  return { status, diff, truncated };
}
