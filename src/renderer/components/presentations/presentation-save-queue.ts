import type { Presentation } from "@contract/presentations";

export type SaveStatus = { kind: "saved" | "saving" } | { kind: "failed"; message: string };

export function createPresentationSaveQueue(
  revision: number,
  save: (deck: Presentation, revision: number) => Promise<number>,
  onStatus: (status: SaveStatus) => void,
) {
  let latest: Presentation | undefined;
  let current: Promise<boolean> | undefined;
  const flush = (): Promise<boolean> => {
    if (current) return current;
    if (!latest) return Promise.resolve(true);
    onStatus({ kind: "saving" });
    current = Promise.resolve()
      .then(async () => {
        while (latest) {
          const snapshot = latest;
          latest = undefined;
          try {
            revision = await save(snapshot, revision);
          } catch (error) {
            latest ??= snapshot;
            onStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
            return false;
          }
        }
        onStatus({ kind: "saved" });
        return true;
      })
      .finally(() => {
        current = undefined;
      });
    return current;
  };
  return {
    submit(deck: Presentation) {
      latest = deck;
      void flush();
    },
    flush,
  };
}
