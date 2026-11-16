import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { SuperAgentApproval } from "../../contract/superagent";
import { array, object, string, type JsonObject } from "./protocol";

type WorkspaceEdit = { paths: string[]; allowChoice: string };

export type AgentApprovalRequest = Omit<SuperAgentApproval, "id" | "memberId"> & {
  workspaceEdit?: WorkspaceEdit;
};

export function fileEdit(pathname: unknown, allowChoice = "allow"): WorkspaceEdit | undefined {
  return typeof pathname === "string" && pathname && allowChoice ? { paths: [pathname], allowChoice } : undefined;
}

export function codexFileEdit(params: JsonObject, item: JsonObject): WorkspaceEdit | undefined {
  if (params.grantRoot != null || params.networkApprovalContext != null || item.type !== "fileChange") return;
  const changes = array(item.changes).map(object);
  const paths: string[] = [];
  for (const change of changes) {
    const kind = object(change.kind);
    const target = string(change.path);
    if (!target || (kind.type !== "add" && kind.type !== "update") || kind.move_path != null) return;
    paths.push(target);
  }
  if (paths.length) return { paths, allowChoice: "allow" };
}

export function workspaceEditChoice(cwd: string, edit?: WorkspaceEdit): string | undefined {
  if (!edit?.paths.length) return;
  try {
    const root = path.resolve(cwd);
    if (!lstatSync(root).isDirectory() || path.relative(root, realpathSync.native(root))) return;
    if (edit.paths.every((file) => isWorkspaceFile(root, file))) return edit.allowChoice;
  } catch {
    // An inaccessible or ambiguous path still needs a person to review it.
  }
}

function isWorkspaceFile(root: string, file: string): boolean {
  if (!file || file.startsWith("~") || /[\0-\x1f]/u.test(file)) return false;
  const windows = process.platform === "win32";
  if (windows && (file.startsWith("\\\\") || file.startsWith("//") || /^[a-z]:(?![\\/])/iu.test(file))) return false;
  if (file.split(windows ? /[\\/]/u : /\//u).includes("..")) return false;
  const relative = path.relative(root, path.resolve(root, file));
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") return false;
  const segments = relative.split(path.sep);
  if (
    segments.some(
      (part) =>
        part.toLowerCase() === ".git" ||
        (windows &&
          (/[. ]$/u.test(part) ||
            /[:*?"<>|]/u.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))),
    )
  )
    return false;

  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const info = lstatSync(current);
      const isLast = index === segments.length - 1;
      if (isLast ? !info.isFile() || info.nlink > 1 : !info.isDirectory()) return false;
      if (path.relative(current, realpathSync.native(current))) return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }
  return true;
}
