import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { ReviewActivityLog } from "./activity";
import { issueFromDiagnostics } from "./output";
import { sessionId } from "./scope";

const MAX_RECORD = 8 * 1024 * 1024;
const CHUNK = 256 * 1024;
const SESSION = /^[a-z0-9][a-z0-9._-]{0,126}\.jsonl$/iu;

function sessionDirectory(home: string, root: string) {
  // Match OCR v1.13.7 internal/session/persist.go: encodeRepoPath.
  const volume = process.platform === "win32" ? path.parse(root).root.replace(/[\\/]+$/u, "") : "";
  const encoded =
    volume.replaceAll(":", "_") +
    root
      .slice(volume.length)
      .replace(/^[\\/]+/u, "")
      .replace(/[\\/]/gu, "-");
  return path.join(home, ".opencodereview", "sessions", encoded || "empty");
}

export class NativeReviewActivity {
  private source?: string;
  private offset = 0;
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private skipping = false;
  private reading?: Promise<void>;
  more = false;
  scanPaths?: string[];

  private constructor(
    private directory: string,
    private previous: Set<string>,
    private log: ReviewActivityLog,
    private replay = false,
  ) {}

  static async start(home: string, root: string, log: ReviewActivityLog, captureModels = false) {
    const directory = sessionDirectory(home, root);
    const previous = new Set(await readdir(directory).catch(() => []));
    return new NativeReviewActivity(directory, previous, log, captureModels);
  }

  get sessionId() {
    return this.source ? path.basename(this.source, ".jsonl") : undefined;
  }

  static async history(home: string, root: string, id: string, log: ReviewActivityLog) {
    const reader = new NativeReviewActivity(sessionDirectory(home, root), new Set(), log, true);
    reader.source = path.join(reader.directory, sessionId(id) + ".jsonl");
    do {
      await reader.readAvailable();
    } while (reader.more);
    return reader.scanPaths;
  }

  read(session?: string) {
    this.reading ??= this.readAvailable(session)
      .catch(() => {
        this.more = false;
        // A live file may not exist until OCR creates and flushes it.
      })
      .finally(() => {
        this.reading = undefined;
      });
    return this.reading;
  }

  private async readAvailable(session?: string) {
    this.more = false;
    if (!this.source) {
      const preferred = session ? session + ".jsonl" : null;
      const names = await readdir(this.directory).catch((): string[] => []);
      const name =
        preferred && SESSION.test(preferred) && names.includes(preferred)
          ? preferred
          : names.find((candidate) => SESSION.test(candidate) && !this.previous.has(candidate));
      if (!name) return;
      this.source = path.join(this.directory, name);
    }
    if (!(await lstat(this.source)).isFile()) return;
    const file = await open(this.source, "r");
    try {
      const buffer = Buffer.allocUnsafe(CHUNK);
      // Yield between bounded reads so a large engine trace does not block Host RPC.
      for (let iteration = 0; iteration < 96; iteration++) {
        const { bytesRead } = await file.read(buffer, 0, CHUNK, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.accept(this.decoder.write(buffer.subarray(0, bytesRead)));
        if (bytesRead < CHUNK) break;
        if (iteration === 95) this.more = true;
      }
    } finally {
      await file.close();
    }
  }

  private accept(chunk: string) {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) {
      if (this.skipping) {
        this.skipping = false;
        continue;
      }
      if (line.length > MAX_RECORD) {
        this.log.truncated = true;
        continue;
      }
      if (
        !line.includes('"type":"tool_call"') &&
        (!this.replay || !/"type":"(?:session_start|llm_response|llm_error)"/u.test(line))
      )
        continue;
      try {
        const row = JSON.parse(line);
        if (this.replay && row.type === "session_start") {
          if (Array.isArray(row.scanPaths))
            this.scanPaths = row.scanPaths.filter((item: unknown) => typeof item === "string");
          continue;
        }
        if (this.replay && (row.type === "llm_response" || row.type === "llm_error")) {
          const duration = typeof row.duration_ms === "number" ? row.duration_ms : 0;
          const ended = Date.parse(row.timestamp) || Date.now();
          const id = this.log.beginModel(typeof row.model === "string" ? row.model : "OCR", "", ended - duration);
          this.log.finishModel(id, {
            durationMs: duration,
            status: row.type === "llm_error" ? "error" : "done",
            text: typeof row.content === "string" ? row.content : "",
            reasoning: typeof row.reasoning_content === "string" ? row.reasoning_content : "",
            inputTokens: typeof row.usage?.prompt_tokens === "number" ? row.usage.prompt_tokens : undefined,
            outputTokens: typeof row.usage?.completion_tokens === "number" ? row.usage.completion_tokens : undefined,
            ...(typeof row.error === "string" ? { issue: issueFromDiagnostics(row.error), diagnostic: row.error } : {}),
          });
          continue;
        }
        if (row.type !== "tool_call" || typeof row.tool_name !== "string") continue;
        this.log.nativeToolResult({
          name: row.tool_name,
          input: typeof row.arguments === "string" ? row.arguments : "{}",
          output: typeof row.result === "string" ? row.result : "",
          path: typeof row.filePath === "string" ? row.filePath : undefined,
          task: typeof row.taskType === "string" ? row.taskType : undefined,
          durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
          at: Date.parse(row.timestamp) || Date.now(),
          ok: row.ok !== false,
        });
      } catch {
        /* A native record may be unavailable after a forced stop. */
      }
    }
    if (this.pending.length > MAX_RECORD) {
      this.log.truncated = true;
      this.pending = "";
      this.skipping = true;
    }
  }
}
