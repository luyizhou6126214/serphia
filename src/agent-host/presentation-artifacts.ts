import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { open as openZip } from "yauzl";
import { FILE_DOWNLOAD_MAX_BYTES } from "../shared/file-types";
import { parseJsonRecord } from "../shared/node/locked-json-file";
import type { PresentationArtifactSnapshot } from "../contract/presentations";

function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function completePresentation(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    openZip(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return resolve(false);
      let presentation = false;
      let contentTypes = false;
      let count = 0;
      zip.on("error", () => {
        zip.close();
        resolve(false);
      });
      zip.on("entry", (entry) => {
        if (++count > 20000) {
          zip.close();
          resolve(false);
          return;
        }
        presentation ||= entry.fileName === "ppt/presentation.xml";
        contentTypes ||= entry.fileName === "[Content_Types].xml";
        zip.readEntry();
      });
      zip.on("end", () => resolve(presentation && contentTypes));
      zip.readEntry();
    });
  });
}

async function readWorkflowJson(file: string) {
  try {
    const stat = await lstat(file);
    if (stat.isFile() && stat.size <= 1024 * 1024) return parseJsonRecord(await readFile(file, "utf8"));
  } catch {
    // Locks and receipts can disappear or be replaced between polls.
  }
  return null;
}

async function confirmationPort(folder: string, lockFile: string) {
  const lock = await readWorkflowJson(lockFile);
  const port = lock?.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(lock?.pid))
    return;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const health = parseJsonRecord(await response.text());
    if (
      health.service === "confirm_ui" &&
      health.status === "ok" &&
      health.pid === lock?.pid &&
      typeof health.project === "string" &&
      path.isAbsolute(health.project) &&
      path.relative(folder, health.project) === "" &&
      health.session &&
      typeof health.session === "object" &&
      "status" in health.session &&
      health.session.status !== "done"
    )
      return port;
  } catch {
    // A stale lock can outlive the form server or its port can be reused.
  }
}

/** Discover the project-owned confirmation surface and complete slide exports. */
export async function presentationArtifacts(directory: string): Promise<PresentationArtifactSnapshot> {
  const root = await realpath(directory);
  const result: PresentationArtifactSnapshot = { exports: [] };
  const ignored = new Set([
    "images",
    "icons",
    "templates",
    "sources",
    "node_modules",
    "backup",
    "backups",
    "svg_output",
    "svg_final",
  ]);
  async function walk(folder: string, depth: number) {
    if (depth > 5) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.name === ".confirm_ui.lock" && entry.isFile()) {
        const port = await confirmationPort(folder, file);
        if (port) result.confirmationPort = port;
      }
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name === "result.json" && path.basename(folder) === "confirm_ui") {
        const receipt = await readWorkflowJson(file);
        if (receipt?.stage === "final" && receipt.status === "confirmed") result.designConfirmed = true;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name.toLowerCase())) await walk(file, depth + 1);
      } else if (
        entry.isFile() &&
        /\.pptx$/i.test(entry.name) &&
        within(root, await realpath(file)) &&
        (await completePresentation(file))
      ) {
        result.exports.push({ name: entry.name, path: file, updatedAt: (await lstat(file)).mtimeMs });
      }
    }
  }
  await walk(root, 0);
  result.exports.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
  return result;
}

const saving = new Set<string>();

export async function savePresentationFile(
  directory: string,
  input: { path: string; base64: string; expectedHash: string },
) {
  const root = await realpath(directory);
  const file = await realpath(input.path);
  if (!within(root, file) || !/\.pptx$/i.test(file) || !(await lstat(file)).isFile())
    throw new Error("File is outside the presentation workspace");
  if (typeof input.base64 !== "string" || input.base64.length > Math.ceil(FILE_DOWNLOAD_MAX_BYTES / 3) * 4)
    throw new Error("Presentation exceeds the editor size limit");
  if (saving.has(file)) throw new Error("Another save is in progress");
  saving.add(file);
  const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    const bytes = Buffer.from(input.base64, "base64");
    await writeFile(temporary, bytes, { flag: "wx" });
    if (!(await completePresentation(temporary))) throw new Error("Invalid PowerPoint file");
    if (
      (await lstat(file)).size > FILE_DOWNLOAD_MAX_BYTES ||
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") !== input.expectedHash
    )
      throw new Error("This PowerPoint file changed on disk. Export your edits as a copy.");
    await rename(temporary, file);
    return { hash: createHash("sha256").update(bytes).digest("hex"), updatedAt: (await lstat(file)).mtimeMs };
  } finally {
    saving.delete(file);
    await rm(temporary, { force: true });
  }
}
