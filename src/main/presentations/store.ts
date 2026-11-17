import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Check } from "typebox/value";
import {
  deckSchema,
  MAX_DECK_IMAGE_DATA,
  presentationIdPattern,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type Presentation,
  type PresentationSummary,
  type SavedPresentation,
} from "../../contract/presentations";
import { parseJsonRecord, withLockedJsonFile } from "../../shared/node/locked-json-file";

const validId = new RegExp(presentationIdPattern);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export function validatePresentation(value: unknown): Presentation {
  if (!Check(deckSchema, value)) throw new Error("Invalid presentation document.");
  const deck = value as Presentation;
  const ids = new Set<string>();
  let imageData = 0;
  for (const slide of deck.slides) {
    if (ids.has(slide.id)) throw new Error("Duplicate slide identifier.");
    ids.add(slide.id);
    for (const element of slide.elements) {
      if (ids.has(element.id) || element.x + element.w > SLIDE_WIDTH || element.y + element.h > SLIDE_HEIGHT)
        throw new Error("Invalid slide element bounds or identifier.");
      ids.add(element.id);
      if (element.kind === "image") imageData += element.data.length;
    }
  }
  if (imageData > MAX_DECK_IMAGE_DATA) throw new Error("This presentation exceeds the image storage limit.");
  return deck;
}

function savedRecord(record: Record<string, unknown>): SavedPresentation {
  if (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 1)
    throw new Error("Invalid saved presentation revision.");
  return { revision: record.revision, deck: validatePresentation(record.deck) };
}

export class PresentationStore {
  constructor(private readonly dataRoot: string) {}

  private folder(cwd: string | null): string {
    if (cwd !== null && (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd.length > 32767 || cwd.includes("\0")))
      throw new Error("Invalid presentation workspace.");
    const normalized = cwd === null ? null : path.resolve(cwd);
    const key = process.platform === "win32" ? (normalized?.toLowerCase() ?? null) : normalized;
    return path.join(this.dataRoot, createHash("sha256").update(JSON.stringify(key)).digest("hex"));
  }

  private filename(cwd: string | null, id: string): string {
    if (typeof id !== "string" || !validId.test(id)) throw new Error("Invalid presentation identifier.");
    return path.join(this.folder(cwd), id + ".json");
  }

  async list(cwd: string | null): Promise<PresentationSummary[]> {
    const folder = this.folder(cwd);
    const names = await readdir(folder).catch((error: unknown) => {
      if (missing(error)) return [];
      throw error;
    });
    const entries: PresentationSummary[] = [];
    for (const filename of names) {
      const id = path.basename(filename, ".json");
      if (!validId.test(id) || filename !== id + ".json") continue;
      const fullPath = this.filename(cwd, id);
      const [info, text] = await Promise.all([stat(fullPath), readFile(fullPath, "utf8")]);
      const { deck } = savedRecord(parseJsonRecord(text));
      entries.push({ id, title: deck.title, updatedAt: info.mtimeMs });
    }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(cwd: string | null, id: string): Promise<SavedPresentation> {
    const value = savedRecord(parseJsonRecord(await readFile(this.filename(cwd, id), "utf8")));
    if (value.deck.id !== id) throw new Error("Saved presentation identifier does not match.");
    return value;
  }

  async save(cwd: string | null, value: unknown, expectedRevision: number): Promise<number> {
    const deck = validatePresentation(value);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("Invalid presentation revision.");
    return withLockedJsonFile(this.filename(cwd, deck.id), async (current, save, text) => {
      const revision = text === null ? 0 : savedRecord(current).revision;
      if (revision !== expectedRevision)
        throw new Error("This presentation was changed elsewhere. Reopen it before saving.");
      await save({ revision: revision + 1, deck });
      return revision + 1;
    });
  }
}
