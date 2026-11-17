import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "tar";
import release from "../build/desktop-window/agent-desktop-release.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export async function prepareDesktopWindowDriver(projectRoot = root) {
  if (`${process.platform}-${process.arch}` !== release.target) return;
  const dir = path.join(projectRoot, "out", "native", "desktop-window", release.target);
  const executable = path.join(dir, release.executable);
  const current = await fs.readFile(executable).catch(() => undefined);
  if (current && sha256(current) === release.executableSha256) return executable;

  await fs.mkdir(dir, { recursive: true });
  const staging = await fs.mkdtemp(path.join(dir, ".stage-"));
  try {
    const response = await globalThis.fetch(release.archiveUrl, { signal: globalThis.AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Agent desktop download failed (HTTP ${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== release.archiveSha256) throw new Error("Agent desktop archive checksum mismatch");
    const archive = path.join(staging, "driver.tar.gz");
    await fs.writeFile(archive, bytes);
    await extract({
      file: archive,
      cwd: staging,
      strict: true,
      filter: (name, entry) => name === release.executable && entry.type === "File",
    });
    const extracted = path.join(staging, release.executable);
    if (sha256(await fs.readFile(extracted)) !== release.executableSha256)
      throw new Error("Agent desktop executable checksum mismatch");
    await fs.rename(extracted, executable);
    console.log(`[desktop-window] prepared agent-desktop ${release.version}`);
    return executable;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepareDesktopWindowDriver();
}
