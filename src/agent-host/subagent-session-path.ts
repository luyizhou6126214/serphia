import { existsSync } from "node:fs";
import path from "node:path";

const PI_SESSION_BASENAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const SUBAGENT_RUN_DIRECTORY = /^(?:async-)?[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const SUBAGENT_STEP_DIRECTORY = /^run-\d+$/;

/** Match the bundled and separately installed plugins' transcript directories. */
export function isSubagentSessionPath(candidate: string, sessionsRoot: string): boolean {
  const relative = path.relative(sessionsRoot, candidate);
  const segments = relative.split(path.sep);
  if (path.isAbsolute(relative) || segments[0] === "..") return false;

  return segments.some((name, index) => {
    if (name === "subagent-artifacts") return true;
    if (index === 0) return false;
    const parentName = segments[index - 1];
    // Explicit session directories still group run-N under a plugin-generated run ID.
    if (SUBAGENT_STEP_DIRECTORY.test(name) && SUBAGENT_RUN_DIRECTORY.test(parentName)) return true;
    if (!(name === "tasks" || name === "forks" || SUBAGENT_RUN_DIRECTORY.test(name))) return false;
    // Generated parent names still identify internal runs after the parent is deleted.
    return (
      PI_SESSION_BASENAME.test(parentName) ||
      existsSync(`${path.join(sessionsRoot, ...segments.slice(0, index))}.jsonl`)
    );
  });
}
