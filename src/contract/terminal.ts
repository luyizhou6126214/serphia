/** Typed surface of the desktop terminal: shells, sessions, and the output stream. */

/** One shell the Host discovered and can launch. */
export interface TerminalShellInfo {
  /** Stable identity: the resolved executable path. */
  id: string;
  /** Display label ("PowerShell 7", "zsh", …). */
  label: string;
}

/** One open terminal session as the Renderer sees it. */
export interface TerminalSessionInfo {
  id: string;
  /** Chip label, initially the shell's label. */
  title: string;
  shellId: string;
  cwd: string;
  cols: number;
  rows: number;
  state: "running" | "exited";
  /** Exit code once the process ended; null while running or on a signal. */
  exitCode: number | null;
}

/** Shells plus every terminal the Host still holds. */
export interface TerminalSnapshot {
  shells: TerminalShellInfo[];
  terminals: TerminalSessionInfo[];
}

/** Everything a mounting screen needs to reproduce a terminal's current content. */
export interface TerminalAttachResult {
  info: TerminalSessionInfo;
  /** Retained raw output, oldest first. */
  backlog: string;
  /** Whether older output was dropped before the retained backlog begins. */
  truncated: boolean;
  /** Output frame sequence already contained in `backlog`. */
  seq: number;
}

export interface TerminalCreateInput {
  /** A discovered shell id; omitted means the Host default. */
  shellId?: string;
  cwd: string;
  cols: number;
  rows: number;
}

/** Host-published terminal events; data frames carry raw terminal output. */
export type TerminalEvent =
  | { type: "data"; id: string; data: string; seq: number }
  | { type: "exited"; id: string; exitCode: number | null }
  | { type: "closed"; id: string };
