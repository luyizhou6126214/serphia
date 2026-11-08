/**
 * Owns every desktop terminal: shell catalog, pty sessions, bounded output
 * batching toward the Renderer, and teardown. Electron-free so the session
 * rules stay testable; `host.ts` supplies the window event sink.
 */

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import type {
  TerminalAttachResult,
  TerminalCreateInput,
  TerminalEvent,
  TerminalSessionInfo,
  TerminalSnapshot,
} from "../../contract/terminal";
import { TerminalSession, type TerminalSessionOptions } from "./session.ts";
import type { TerminalShellDefinition } from "./shells.ts";

/** Largest input one write accepts, in UTF-16 code units. */
export const TERMINAL_MAX_INPUT_CHARS = 64 * 1024;
/** Most terminals one host keeps open at a time. */
export const TERMINAL_MAX_COUNT = 12;
/** Output coalescing window toward the Renderer, in milliseconds. */
const DEFAULT_BATCH_MS = 8;

/** Clamp reported dimensions into the pty's accepted range. */
export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
  const safeCols = Number.isFinite(cols) ? Math.round(cols) : 0;
  const safeRows = Number.isFinite(rows) ? Math.round(rows) : 0;
  return {
    cols: Math.min(500, Math.max(20, safeCols)),
    rows: Math.min(200, Math.max(4, safeRows)),
  };
}

/** Injectable session factory, so service rules can be tested without a pty. */
export type TerminalSessionFactory = (options: TerminalSessionOptions) => TerminalSession;

export interface TerminalServiceOptions {
  shells: readonly TerminalShellDefinition[];
  defaultShellId: string | null;
  /** Send one event to the Renderer; the host wires this to the window. */
  emit: (event: TerminalEvent) => void;
  spawnSession?: TerminalSessionFactory;
  batchMs?: number;
  maxTerminals?: number;
}

interface TerminalEntry {
  session: TerminalSession;
  pending: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** Last output frame sequence attach has already covered. */
  seq: number;
}

export class TerminalService {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly shells: readonly TerminalShellDefinition[];
  private readonly defaultShellId: string | null;
  private readonly emit: (event: TerminalEvent) => void;
  private readonly spawnSession: TerminalSessionFactory;
  private readonly batchMs: number;
  private readonly maxTerminals: number;

  constructor(options: TerminalServiceOptions) {
    this.shells = options.shells;
    this.defaultShellId = options.defaultShellId;
    this.emit = options.emit;
    this.spawnSession = options.spawnSession ?? ((sessionOptions) => new TerminalSession(sessionOptions));
    this.batchMs = options.batchMs ?? DEFAULT_BATCH_MS;
    this.maxTerminals = options.maxTerminals ?? TERMINAL_MAX_COUNT;
  }

  /** Shells plus every terminal this host still holds. */
  list(): TerminalSnapshot {
    return {
      shells: this.shells.map((shell) => ({ id: shell.id, label: shell.label })),
      terminals: [...this.entries.values()].map((entry) => entry.session.info),
    };
  }

  /** The shell a create call would launch when it names none. */
  defaultShell(): TerminalShellDefinition | null {
    const wanted = this.defaultShellId ?? this.shells[0]?.id;
    return this.shells.find((shell) => shell.id === wanted) ?? this.shells[0] ?? null;
  }

  /**
   * Start one shell in a workspace directory.
   * @param input - chosen shell (optional), absolute cwd, and screen dimensions.
   * @returns the new terminal's metadata.
   */
  create(input: TerminalCreateInput): TerminalSessionInfo {
    if (this.entries.size >= this.maxTerminals) {
      throw new Error("TERMINAL_LIMIT: too many terminals are open");
    }
    const shell =
      input.shellId === undefined
        ? this.defaultShell()
        : (this.shells.find((candidate) => candidate.id === input.shellId) ?? null);
    if (shell === null) throw new Error("TERMINAL_SHELL_UNAVAILABLE: that shell is not available");
    const cwd = resolveTerminalCwd(input.cwd);
    const { cols, rows } = clampTerminalSize(input.cols, input.rows);
    const id = randomUUID();
    const session = this.spawnSession({
      id,
      shell,
      cwd,
      cols,
      rows,
      onData: (chunk) => {
        this.append(id, chunk);
      },
      onExit: (exitCode) => {
        this.finish(id, exitCode);
      },
    });
    this.entries.set(id, { session, pending: "", timer: null, seq: 0 });
    return session.info;
  }

  /**
   * Read one terminal's metadata and retained output.
   * @param terminalId - id returned by create.
   * @returns the attach payload a mounting screen replays.
   */
  attach(terminalId: string): TerminalAttachResult {
    const entry = this.require(terminalId);
    // Flush first so the retained backlog and the reported sequence describe the
    // same moment: a screen replaying the backlog must not receive that output twice.
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.flush(entry);
    return { ...entry.session.attach(), seq: entry.seq };
  }

  /** Forward keystrokes to one terminal. */
  write(terminalId: string, data: string): void {
    if (typeof data !== "string" || data.length === 0) throw new Error("TERMINAL_INVALID_INPUT: empty input");
    if (data.length > TERMINAL_MAX_INPUT_CHARS) throw new Error("TERMINAL_INVALID_INPUT: input is too large");
    const entry = this.require(terminalId);
    if (entry.session.info.state !== "running") throw new Error("TERMINAL_EXITED: this terminal has ended");
    entry.session.write(data);
  }

  /** Report one terminal's screen dimensions. */
  resize(terminalId: string, cols: number, rows: number): void {
    const entry = this.require(terminalId);
    const size = clampTerminalSize(cols, rows);
    entry.session.resize(size.cols, size.rows);
  }

  /**
   * End one terminal and release its process.
   * @param terminalId - id returned by create.
   */
  async close(terminalId: string): Promise<void> {
    const entry = this.entries.get(terminalId);
    if (entry === undefined) return;
    this.flush(entry);
    if (entry.timer !== null) clearTimeout(entry.timer);
    await entry.session.close();
    this.entries.delete(terminalId);
    this.emit({ type: "closed", id: terminalId });
  }

  /** Kill every terminal without waiting; used while the application quits. */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.session.killNow();
    }
    this.entries.clear();
  }

  /** One terminal entry, or a typed failure. */
  private require(terminalId: string): TerminalEntry {
    const entry = this.entries.get(terminalId);
    if (entry === undefined) throw new Error("TERMINAL_NOT_FOUND: this terminal is no longer open");
    return entry;
  }

  /** Coalesce one output chunk toward the Renderer. */
  private append(terminalId: string, chunk: string): void {
    const entry = this.entries.get(terminalId);
    if (entry === undefined) return;
    entry.pending += chunk;
    entry.timer ??= setTimeout(() => {
      const current = this.entries.get(terminalId);
      if (current === undefined) return;
      current.timer = null;
      this.flush(current);
    }, this.batchMs);
    entry.timer.unref?.();
  }

  /** Send whatever output is pending for one terminal. */
  private flush(entry: TerminalEntry): void {
    if (entry.pending === "") return;
    const data = entry.pending;
    entry.pending = "";
    entry.seq += 1;
    this.emit({ type: "data", id: entry.session.id, data, seq: entry.seq });
  }

  /** Publish the end of one terminal's process. */
  private finish(terminalId: string, exitCode: number | null): void {
    const entry = this.entries.get(terminalId);
    if (entry === undefined) return;
    this.flush(entry);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.emit({ type: "exited", id: terminalId, exitCode });
  }
}

/**
 * Validate one requested working directory.
 * @param cwd - untrusted request value.
 * @returns the normalized absolute directory.
 */
export function resolveTerminalCwd(cwd: string): string {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > 4_096) {
    throw new Error("TERMINAL_INVALID_CWD: a working directory is required");
  }
  if (cwd.includes("\0") || !path.isAbsolute(cwd)) {
    throw new Error("TERMINAL_INVALID_CWD: the working directory must be absolute");
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error("TERMINAL_INVALID_CWD: the working directory does not exist");
  return path.normalize(cwd);
}
