import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import release from "../../../build/desktop-window/agent-desktop-release.json";

export function resolveDesktopWindowDriver(paths: { platform: string; arch: string; resourceRoot: string }) {
  if (`${paths.platform}-${paths.arch}` !== release.target) return undefined;
  const executable = path.join(paths.resourceRoot, "desktop-window", release.target, release.executable);
  try {
    const hash = createHash("sha256").update(readFileSync(executable)).digest("hex");
    if (hash === release.executableSha256) return executable;
  } catch {
    // Missing resources disable the tool.
  }
  return undefined;
}
