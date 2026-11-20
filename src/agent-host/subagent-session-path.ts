import { existsSync } from "node:fs";
import path from "node:path";

const PI_SESSION_BASENAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

/** Pi Subagents stores child transcripts in <parent-session-basename>/tasks. */
export function isSubagentSessionDirectory(directory: string): boolean {
  if (path.basename(directory) !== "tasks") return false;
  const parent = path.dirname(directory);
  // A generated parent name still identifies the directory after the parent is deleted.
  return PI_SESSION_BASENAME.test(path.basename(parent)) || existsSync(`${parent}.jsonl`);
}
