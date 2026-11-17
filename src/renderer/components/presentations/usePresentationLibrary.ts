import { useCallback, useEffect, useRef, useState } from "react";
import type { Presentation, PresentationSummary, SavedPresentation } from "@contract/presentations";
import { createPresentationSaveQueue, type SaveStatus } from "./presentation-save-queue";

type OpenDeck = {
  deck: Presentation;
  queue: ReturnType<typeof createPresentationSaveQueue>;
  undo: Presentation[];
  redo: Presentation[];
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const historyLimit = 30;

export function usePresentationLibrary(cwd: string | null) {
  const open = useRef<OpenDeck | null>(null);
  const loading = useRef(false);
  const resident = useRef(true);
  const [deck, setDeck] = useState<Presentation | null>(null);
  const [summaries, setSummaries] = useState<PresentationSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });

  const display = useCallback(
    (saved: SavedPresentation) => {
      const entry: OpenDeck = {
        deck: saved.deck,
        undo: [],
        redo: [],
        queue: createPresentationSaveQueue(
          saved.revision,
          (snapshot, revision) => window.piBridge.savePresentation(cwd, snapshot, revision),
          (next) => {
            if (resident.current && open.current === entry) setStatus(next);
          },
        ),
      };
      open.current = entry;
      setDeck(saved.deck);
      setStatus({ kind: "saved" });
      return entry;
    },
    [cwd],
  );

  const initialize = useCallback(
    async (isCurrent: () => boolean = () => resident.current) => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      setError("");
      try {
        const results = await window.piBridge.listPresentations(cwd);
        if (!isCurrent()) return;
        setSummaries(results);
        if (results[0]) {
          const saved = await window.piBridge.loadPresentation(cwd, results[0].id);
          if (isCurrent()) display(saved);
        }
      } catch (error) {
        if (isCurrent()) setError(errorMessage(error));
      } finally {
        loading.current = false;
        if (isCurrent()) setBusy(false);
      }
    },
    [cwd, display],
  );

  useEffect(() => {
    resident.current = true;
    // Defer until the active mount, including development Strict Mode's replay.
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return initialize(() => active);
    });
    return () => {
      active = false;
      resident.current = false;
    };
  }, [initialize]);

  const mark = (next: Presentation) => {
    setSummaries((previous) => [
      { id: next.id, title: next.title, updatedAt: Date.now() },
      ...previous.filter(({ id }) => id !== next.id),
    ]);
  };

  const switchDeck = async (operation: () => Promise<SavedPresentation>, discard = false) => {
    if (loading.current) return false;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      if (!discard && open.current && !(await open.current.queue.flush())) return false;
      const next = await operation();
      if (!resident.current) return false;
      display(next);
      return true;
    } catch (error) {
      if (resident.current) setError(errorMessage(error));
      return false;
    } finally {
      loading.current = false;
      if (resident.current) setBusy(false);
    }
  };

  const selectDeck = (id: string) => switchDeck(() => window.piBridge.loadPresentation(cwd, id));
  const create = async (next: Presentation) => {
    const created = await switchDeck(async () => ({
      deck: next,
      revision: await window.piBridge.savePresentation(cwd, next, 0),
    }));
    if (created) mark(next);
    return created;
  };

  const publish = (entry: OpenDeck, next: Presentation) => {
    entry.deck = next;
    setDeck(next);
    mark(next);
    entry.queue.submit(next);
  };

  const change = (update: (current: Presentation) => Presentation) => {
    const entry = open.current;
    if (!entry || loading.current) return;
    const next = update(entry.deck);
    if (next === entry.deck) return;
    entry.undo = [...entry.undo.slice(1 - historyLimit), entry.deck];
    entry.redo = [];
    publish(entry, next);
  };

  const restore = (from: "undo" | "redo", to: "undo" | "redo") => {
    const entry = open.current;
    if (!entry || loading.current) return;
    const next = entry[from].pop();
    if (!next) return;
    entry[to].push(entry.deck);
    publish(entry, next);
  };

  return {
    deck,
    summaries,
    busy,
    error,
    status,
    initialize,
    selectDeck,
    create,
    change,
    undo: () => restore("undo", "redo"),
    redo: () => restore("redo", "undo"),
    canUndo: Boolean(open.current?.undo.length),
    canRedo: Boolean(open.current?.redo.length),
    flush: () => open.current?.queue.flush() ?? Promise.resolve(true),
    reload: () => deck && switchDeck(() => window.piBridge.loadPresentation(cwd, deck.id), true),
  };
}
