/**
 * One pty-backed terminal session: the shell runs under a real pseudo-terminal,
 * its output is retained in a bounded backlog so a remounting screen can
 * reproduce the current content, and closing waits for the process to end.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { IPty } from "node-pty";
import type { TerminalSessionInfo } from "../../contract/terminal";
import type { TerminalShellDefinition } from "./shells.ts";

/** node-pty's runtime surface, loaded on first use. */
type NodePtyModule = typeof import("node-pty");

/** Module loader that works from the CJS main bundle and from ESM test files. */
const moduleRequire = createRequire(typeof __filename === "string" && __filename !== "" ? __filename : import.meta.url);

let nodePtyModule: NodePtyModule | null = null;

/**
 * Where node-pty must be loaded from.
 *
 * A packaged app must load the copy unpacked from the asar archive: node-pty
 * derives its ConPTY worker script path from its own module directory, and a
 * path inside the archive cannot be handed to `worker_threads`.
 * @param resourcesPath - Electron's resources directory, absent outside a packaged app.
 * @param exists - file probe for the unpacked module directory.
 * @returns the absolute unpacked module path, or the bare module name.
 */
export function resolveNodePtyTarget(
  resourcesPath: string | undefined,
  exists: (target: string) => boolean = existsSync,
): string {
  if (resourcesPath === undefined) return "node-pty";
  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules", "node-pty");
  return exists(unpacked) ? unpacked : "node-pty";
}

/**
 * Load node-pty once.
 * @returns node-pty's exports.
 */
function loadNodePty(): NodePtyModule {
  nodePtyModule ??= (() => {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    return moduleRequire(resolveNodePtyTarget(resourcesPath)) as NodePtyModule;
  })();
  return nodePtyModule;
}

/** Retained raw output per terminal, in characters. */
export const TERMINAL_BACKLOG_CHARS = 256 * 1024;

/** How long a close waits for the process before reporting anyway. */
const CLOSE_GRACE_MS = 2_000;

/** Environment entries node-pty accepts (values are always strings). */
function ptyEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return Object.fromEntries([...entries, ["TERM", "xterm-256color"], ["COLORTERM", "truecolor"]]);
}

/** One mounted terminal's acknowledged screen state. */
export interface TerminalAttachPayload {
  info: TerminalSessionInfo;
  backlog: string;
  truncated: boolean;
}

export interface TerminalSessionOptions {
  id: string;
  shell: TerminalShellDefinition;
  cwd: string;
  cols: number;
  rows: number;
  /** Raw output chunk, in order. */
  onData: (chunk: string) => void;
  /** Top-level process ended; `exitCode` is null when a signal ended it. */
  onExit: (exitCode: number | null) => void;
}

export class TerminalSession {
  readonly id: string;
  readonly shell: TerminalShellDefinition;
  readonly cwd: string;
  private readonly terminal: IPty;
  private readonly onExit: (exitCode: number | null) => void;
  private readonly retained: string[] = [];
  private retainedChars = 0;
  private dropped = false;
  private cols: number;
  private rows: number;
  private exitCode: number | null = null;
  private exited = false;
  private exitWaiters: Array<() => void> = [];
  private disposables: Array<{ dispose(): void }> = [];

  constructor(options: TerminalSessionOptions) {
    this.id = options.id;
    this.shell = options.shell;
    this.cwd = options.cwd;
    this.cols = options.cols;
    this.rows = options.rows;
    this.onExit = options.onExit;
    this.terminal = loadNodePty().spawn(options.shell.executable, options.shell.args, {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: ptyEnvironment(process.env),
      ...(process.platform === "win32" ? { useConpty: true } : {}),
    });
    this.disposables = [
      this.terminal.onData((chunk) => {
        this.retain(chunk);
        options.onData(chunk);
      }),
      this.terminal.onExit(({ exitCode, signal }) => {
        if (this.exited) return;
        this.exited = true;
        this.exitCode = signal === undefined || signal === 0 ? exitCode : null;
        for (const waiter of this.exitWaiters.splice(0)) waiter();
        this.onExit(this.exitCode);
      }),
    ];
  }

  /** Current metadata for the Renderer. */
  get info(): TerminalSessionInfo {
    return {
      id: this.id,
      title: this.shell.label,
      shellId: this.shell.id,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      state: this.exited ? "exited" : "running",
      exitCode: this.exitCode,
    };
  }

  /** Whether the top-level process already ended. */
  get ended(): boolean {
    return this.exited;
  }

  /**
   * Everything a mounting screen needs to show the terminal now.
   * @returns metadata plus the retained output, reset-prefixed when truncated.
   */
  attach(): TerminalAttachPayload {
    return {
      info: this.info,
      backlog: `${this.dropped ? "\u001bc" : ""}${this.retained.join("")}`,
      truncated: this.dropped,
    };
  }

  /** Send keystrokes; a session that already ended refuses them. */
  write(data: string): void {
    if (this.exited) throw new Error("TERMINAL_EXITED: this terminal has ended");
    this.terminal.write(data);
  }

  /** Report the screen's dimensions to the pty. */
  resize(cols: number, rows: number): void {
    if (this.exited) return;
    this.cols = cols;
    this.rows = rows;
    try {
      this.terminal.resize(cols, rows);
    } catch {
      // A pty that ended between the check and the call has nothing to resize.
    }
  }

  /**
   * Kill the session and wait for it to end.
   * @returns after the exit event or the close grace, whichever comes first.
   */
  async close(): Promise<void> {
    if (!this.exited) {
      try {
        this.terminal.kill();
      } catch {
        // Already gone.
      }
      await Promise.race([this.endedPromise(), delay(CLOSE_GRACE_MS)]);
    }
    this.dispose();
  }

  /** Kill without waiting; used while the application quits. */
  killNow(): void {
    if (this.exited) return;
    try {
      this.terminal.kill();
    } catch {
      // Already gone.
    }
    this.dispose();
  }

  private endedPromise(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      this.exitWaiters.push(resolve);
    });
  }

  private dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // Disposal is best effort.
      }
    }
  }

  /** Keep a bounded tail of the output for a later attach. */
  private retain(chunk: string): void {
    this.retained.push(chunk);
    this.retainedChars += chunk.length;
    while (this.retainedChars > TERMINAL_BACKLOG_CHARS && this.retained.length > 1) {
      const dropped = this.retained.shift() ?? "";
      this.retainedChars -= dropped.length;
      this.dropped = true;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
