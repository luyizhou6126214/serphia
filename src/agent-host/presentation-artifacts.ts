import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { open as openZip } from "yauzl";
import type { PresentationArtifactSnapshot } from "../contract/presentations";

function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

/** Resolve authored icon placeholders only from this presentation's local assets. */
async function embedIcons(svg: string, file: string, root: string): Promise<string> {
  const uses = [...svg.matchAll(/<use\b([^>]*\bdata-icon\s*=\s*(["'])([^"']+)\2[^>]*)(?:\/\s*>|>\s*<\/use>)/gi)].slice(
    0,
    100,
  );
  for (const match of uses) {
    const key = match[3];
    if (!/^[\w/-]+$/.test(key) || key.split("/").some((part) => !part || part === "..")) continue;
    let folder = path.dirname(file);
    while (within(root, folder)) {
      try {
        const asset = await realpath(path.join(folder, "icons", `${key}.svg`));
        if (!within(root, asset) || (await lstat(asset)).size > 256 * 1024) break;
        let icon = await readFile(asset, "utf8");
        if (!/<svg[\s>]/i.test(icon) || !/<\/svg>\s*$/i.test(icon)) break;
        const color = match[1].match(/\b(?:color|fill)\s*=\s*["'](#[\da-f]{3,8}|[a-z]+)["']/i)?.[1] ?? "#000000";
        icon = icon.replace(/currentColor/gi, color);
        // SVG images stay isolated from the application's DOM, just like page previews.
        icon = icon.replace(/(?:xlink:)?href\s*=\s*(["'])(?!#|data:image\/)[\s\S]*?\1/gi, 'href=""');
        const attrs = match[1].replace(/\b(?:data-icon|(?:xlink:)?href)\s*=\s*(["']).*?\1/gi, "").replace(/\/\s*$/, "");
        svg = svg.replace(
          match[0],
          `<image ${attrs} href="data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}"/>`,
        );
        break;
      } catch {
        // Assets may be written after the page. The next snapshot retries them.
      }
      if (folder === root) break;
      folder = path.dirname(folder);
    }
  }
  return svg;
}

function completePresentation(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    openZip(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return resolve(false);
      let presentation = false;
      let contentTypes = false;
      let count = 0;
      zip.on("error", () => {
        zip.close();
        resolve(false);
      });
      zip.on("entry", (entry) => {
        if (++count > 20000) {
          zip.close();
          resolve(false);
          return;
        }
        presentation ||= entry.fileName === "ppt/presentation.xml";
        contentTypes ||= entry.fileName === "[Content_Types].xml";
        zip.readEntry();
      });
      zip.on("end", () => resolve(presentation && contentTypes));
      zip.readEntry();
    });
  });
}

/** Read only artifacts belonging to a host-created workflow. No SVG is injected into the DOM. */
export async function presentationArtifacts(directory: string): Promise<PresentationArtifactSnapshot> {
  const root = await realpath(directory);
  const result: PresentationArtifactSnapshot = { pages: [], exports: [] };
  let visited = 0;
  let totalBytes = 0;
  async function walk(folder: string, depth: number) {
    if (depth > 5 || visited > 600) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (++visited > 600) return;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          !["images", "icons", "templates", "node_modules", "backup", "backups", "svg_final"].includes(
            entry.name.toLowerCase(),
          )
        )
          await walk(file, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(svg|pptx)$/i.test(entry.name)) continue;
      const canonical = await realpath(file);
      if (!within(root, canonical)) continue;
      const stat = await lstat(canonical);
      if (entry.name.toLowerCase().endsWith(".pptx")) {
        if (stat.size > 0 && result.exports.length < 30 && (await completePresentation(canonical)))
          result.exports.push({ name: entry.name, path: canonical, updatedAt: stat.mtimeMs });
        continue;
      }
      if (stat.size > 4 * 1024 * 1024 || result.pages.length >= 40 || totalBytes > 24 * 1024 * 1024) continue;
      let svg = await readFile(canonical, "utf8");
      if (!/<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) continue; // File is still being written.
      svg = await embedIcons(svg, canonical, root);
      // Embed local raster assets without granting the SVG access to arbitrary paths or URLs.
      const references = [...svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)];
      for (const match of references) {
        const target = match[2];
        if (target.startsWith("#") || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(target)) continue;
        let replacement = "";
        if (!/^[a-z][a-z\d+.-]*:/i.test(target) && !path.isAbsolute(target)) {
          try {
            const asset = await realpath(path.resolve(path.dirname(canonical), decodeURIComponent(target)));
            const ext = path.extname(asset).toLowerCase();
            const mime = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[ext];
            if (within(root, asset) && mime && (await lstat(asset)).size < 4 * 1024 * 1024)
              replacement = `data:image/${mime};base64,${(await readFile(asset)).toString("base64")}`;
          } catch {
            /* Missing assets will appear on the next update. */
          }
        }
        svg = svg.replace(match[0], `href="${replacement}"`);
      }
      const bytes = Buffer.byteLength(svg);
      if (totalBytes + bytes > 24 * 1024 * 1024) continue;
      totalBytes += bytes;
      result.pages.push({
        name: entry.name,
        path: canonical,
        revision: createHash("sha256").update(svg).digest("hex").slice(0, 16),
        updatedAt: stat.mtimeMs,
        image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      });
    }
  }
  await walk(root, 0);
  result.pages.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  result.exports.sort((a, b) => b.updatedAt - a.updatedAt);
  return result;
}
