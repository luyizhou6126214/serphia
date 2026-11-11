import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReviewActivityEntry,
  ReviewActivityPage,
  ReviewDiff,
  ReviewHistoryDetail,
  ReviewHistoryRow,
  ReviewRun,
} from "../../contract/code-review";
import { ReviewError } from "./output";
import { relativePath, sessionId, workspaceDiff, type PreparedScope, type Workspace } from "./scope";

const MAX_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_DIFF_BYTES = 32 * 1024 * 1024;
const MAX_ACTIVITY_BYTES = 64 * 1024 * 1024;
const PAGE_BYTES = 512 * 1024;

type Archive = { version: 1; run: ReviewRun; snapshot: ReviewHistoryDetail["snapshot"]; activityLimited?: boolean };

function historyRoot(home: string) {
  return path.join(home, ".opencodereview", "serphia-history");
}

function directory(home: string, id: string) {
  return path.join(historyRoot(home), sessionId(id));
}

function diffFile(dir: string, file: string) {
  const name = createHash("sha256").update(relativePath(file)).digest("hex");
  return path.join(dir, "diffs", name + ".json");
}

async function readJson(file: string, maximum: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > maximum) throw new ReviewError("invalidOutput");
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(target: string, data: unknown) {
  const temp = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

export class ReviewHistoryWriter {
  private queue = new Map<number, ReviewActivityEntry>();
  private timer?: ReturnType<typeof setTimeout>;
  private writing = Promise.resolve();
  private bytes = 0;
  private limited = false;
  private constructor(
    private dir: string,
    private metadata: Archive,
  ) {}

  static async create(home: string, run: ReviewRun) {
    const dir = directory(home, run.id);
    await mkdir(path.join(dir, "diffs"), { recursive: true, mode: 0o700 });
    const metadata: Archive = { version: 1, run: structuredClone(run), snapshot: "unavailable" };
    await writeJson(path.join(dir, "run.json"), metadata);
    return new ReviewHistoryWriter(dir, metadata);
  }

  async capture(workspace: Workspace, scope: PreparedScope, files: ReviewRun["files"], signal: AbortSignal) {
    const entries = [...new Set(files.filter((file) => file.included).map((file) => file.path))];
    let cursor = 0;
    let bytes = 0;
    let limited = false;
    await Promise.all(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length && bytes < MAX_DIFF_BYTES) {
          signal.throwIfAborted();
          const file = entries[cursor++];
          const diff = await workspaceDiff(workspace, scope, file).catch(() => null);
          if (!diff) {
            limited = true;
            continue;
          }
          const size = Buffer.byteLength(JSON.stringify(diff));
          if (bytes + size > MAX_DIFF_BYTES) {
            limited = true;
            break;
          }
          bytes += size;
          limited ||= diff.truncated;
          await writeJson(diffFile(this.dir, file), diff).catch(() => {
            limited = true;
          });
        }
      }),
    );
    this.metadata.snapshot = limited || cursor < entries.length ? "partial" : "saved";
    await writeJson(path.join(this.dir, "run.json"), this.metadata);
  }

  async invalidateSnapshot() {
    this.metadata.snapshot = "unavailable";
    await writeJson(path.join(this.dir, "run.json"), this.metadata);
  }

  record(entry: ReviewActivityEntry) {
    if (this.limited) return;
    this.queue.set(entry.id, entry);
    this.timer ??= setTimeout(() => this.flush(), 350);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const entries = [...this.queue.values()];
    this.queue.clear();
    if (!entries.length || this.limited) return;
    this.writing = this.writing
      .then(async () => {
        if (this.limited) return;
        const lines: string[] = [];
        for (const entry of entries) {
          const line = JSON.stringify(entry) + "\n";
          const size = Buffer.byteLength(line);
          if (this.bytes + size > MAX_ACTIVITY_BYTES) {
            this.limited = true;
            break;
          }
          this.bytes += size;
          lines.push(line);
        }
        if (lines.length) await appendFile(path.join(this.dir, "activity.jsonl"), lines.join(""), { mode: 0o600 });
      })
      .catch(() => {
        this.limited = true;
      });
  }

  async finish(run: ReviewRun, remaining: ReviewActivityEntry[]) {
    for (const entry of remaining) this.record(entry);
    this.flush();
    await this.writing;
    this.metadata = { ...this.metadata, run, activityLimited: this.limited };
    await writeJson(path.join(this.dir, "run.json"), this.metadata);
  }
}

export async function readHistoryArchive(home: string, id: string): Promise<Archive> {
  const dir = directory(home, id);
  if (!(await lstat(dir)).isDirectory()) throw new ReviewError("notRepository");
  const data = await readJson(path.join(dir, "run.json"), MAX_METADATA_BYTES);
  if (data?.version !== 1 || data.run?.id !== id) throw new ReviewError("invalidOutput");
  return data;
}

export async function listHistoryArchives(home: string, active?: string): Promise<ReviewHistoryRow[]> {
  const entries = await readdir(historyRoot(home), { withFileTypes: true }).catch(() => []);
  const rows: ReviewHistoryRow[] = [];
  // UUIDs are not ordered by time. Read metadata in small batches before sorting.
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(12, entries.length) }, async () => {
      while (index < entries.length) {
        const dir = entries[index++];
        if (!dir.isDirectory() || dir.name === active) continue;
        const data = await readHistoryArchive(home, dir.name).catch(() => null);
        if (!data) continue;
        const { run } = data;
        rows.push({
          ref: { archiveId: run.id },
          sessionId: run.sessionId,
          root: run.root,
          projectRoot: run.projectRoot,
          startedAt: run.startedAt,
          model: run.model,
          scope: run.scope,
          state: run.finishedAt ? run.state : "cancelled",
        });
      }
    }),
  );
  return rows;
}

export async function readHistoryDiff(home: string, id: string, file: string): Promise<ReviewDiff | null> {
  const { snapshot } = await readHistoryArchive(home, id);
  if (snapshot === "unavailable") return null;
  return readJson(diffFile(directory(home, id), file), 2 * 1024 * 1024).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

export async function readHistoryEntries(home: string, id: string) {
  const meta = await readHistoryArchive(home, id);
  const file = path.join(directory(home, id), "activity.jsonl");
  const rows = new Map<number, ReviewActivityEntry>();
  let truncated = Boolean(meta.activityLimited);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_ACTIVITY_BYTES) throw new ReviewError("invalidOutput");
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line) continue;
      try {
        const entry: ReviewActivityEntry = JSON.parse(line);
        if (Number.isSafeInteger(entry.id) && entry.id > 0) rows.set(entry.id, entry);
      } catch {
        truncated = true;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { entries: [...rows.values()].sort((a, b) => a.id - b.id), truncated };
}

export function historyPage(entries: ReviewActivityEntry[], after: number, truncated: boolean): ReviewActivityPage {
  if (!Number.isSafeInteger(after) || after < 0) throw new ReviewError("invalidOutput");
  const page: ReviewActivityEntry[] = [];
  let cursor = after;
  let bytes = 0;
  for (const entry of entries) {
    if (entry.id <= after) continue;
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (page.length && (page.length >= 80 || bytes + size > PAGE_BYTES)) break;
    page.push(entry);
    cursor = entry.id;
    bytes += size;
  }
  return { entries: page, cursor, more: (entries.at(-1)?.id ?? 0) > cursor, truncated };
}

export async function deleteHistoryBySession(home: string, root: string, id: string) {
  for (const item of await listHistoryArchives(home)) {
    if ("archiveId" in item.ref && item.root === root && item.sessionId === id) {
      await rm(directory(home, item.ref.archiveId), { recursive: true, force: true });
    }
  }
}
