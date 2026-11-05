import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function defaultSessionDirectoryPath(
  documents: string,
  now = new Date(),
  uuid = randomUUID(),
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const id = uuid.replace(/-/g, "").toLowerCase();
  if (!paths.isAbsolute(documents) || !/^[a-f0-9]{32}$/.test(id) || Number.isNaN(now.getTime()))
    throw new Error("Invalid default session directory");
  return paths.join(documents, "Serphia", date, id);
}

export function createDefaultSessionDirectory(): string {
  // Electron supplies the OS Documents location, including Windows Known Folder redirection.
  const documents = process.env.PI_DESKTOP_DOCUMENTS?.trim() || path.join(homedir(), "Documents");
  const directory = defaultSessionDirectoryPath(documents);
  mkdirSync(directory, { recursive: true });
  return directory;
}
