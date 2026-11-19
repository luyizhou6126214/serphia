import type { Presentation } from "@contract/presentations";

export type SaveStatus = { kind: "saved" | "saving" } | { kind: "failed"; message: string };

export function createPresentationSaveQueue<Deck = Presentation, Revision = number>(
  revision: Revision,
  save: (deck: Deck, revision: Revision) => Promise<Revision>,
  onStatus: (status: SaveStatus) => void,
) {
  let latest: Deck | undefined;
  let current: Promise<boolean> | undefined;
  const flush = (): Promise<boolean> => {
    if (current) return current;
    if (latest === undefined) return Promise.resolve(true);
    onStatus({ kind: "saving" });
    current = Promise.resolve()
      .then(async () => {
        while (latest !== undefined) {
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
    submit(deck: Deck) {
      latest = deck;
      void flush();
    },
    flush,
  };
}
