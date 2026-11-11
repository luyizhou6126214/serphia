import { useEffect, useRef, useState } from "react";
import type { ReviewActivityEntry, ReviewHistoryRef } from "@contract/code-review";
import { call } from "@/lib/api-client";

type Snapshot = {
  id: string;
  entries: ReviewActivityEntry[];
  truncated: boolean;
  more?: boolean;
  connectionError: boolean;
};

export function useReviewActivity(
  id: string,
  finished: boolean,
  enabled: boolean,
  historyRef?: ReviewHistoryRef,
  limit?: number,
) {
  const key = historyRef ? JSON.stringify(historyRef) : id;
  const cache = useRef<{ id: string; cursor: number; rows: Map<number, ReviewActivityEntry> } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (cache.current?.id !== key) cache.current = { id: key, cursor: 0, rows: new Map() };
    const current = cache.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        let page;
        if (historyRef) {
          const reply = await call("codeReview.history.activity", { ref: historyRef, after: current.cursor });
          page = reply.ok ? reply.value : null;
        } else {
          page = await call("codeReview.activity", { id, after: current.cursor });
        }
        if (disposed) return;
        if (!page) {
          setSnapshot((previous) =>
            previous?.id === current.id
              ? { ...previous, connectionError: true }
              : { id: current.id, entries: [], truncated: false, connectionError: true },
          );
          if (!finished) timer = setTimeout(() => void refresh(), 1000);
          return;
        }
        current.cursor = page.cursor;
        for (const entry of page.entries) current.rows.set(entry.id, entry);
        const rows = current.rows;
        if (page.firstId !== undefined)
          for (const key of rows.keys()) {
            if (key < page.firstId) rows.delete(key);
          }
        while (!historyRef && rows.size > 2000) rows.delete(rows.keys().next().value!);
        setSnapshot((previous) =>
          previous?.id === current.id &&
          !page.entries.length &&
          previous.truncated === page.truncated &&
          previous.more === page.more &&
          !previous.connectionError
            ? previous
            : {
                id: current.id,
                entries: [...rows.values()].sort((a, b) => a.id - b.id),
                truncated: page.truncated,
                more: page.more,
                connectionError: false,
              },
        );
        const continuePaging = page.more && (!historyRef || rows.size < (limit ?? 80));
        if (continuePaging || !finished) timer = setTimeout(() => void refresh(), continuePaging ? 0 : 350);
      } catch {
        if (!disposed) {
          setSnapshot((previous) =>
            previous?.id === current.id
              ? { ...previous, connectionError: true }
              : { id: current.id, entries: [], truncated: false, connectionError: true },
          );
          if (!finished) timer = setTimeout(() => void refresh(), 1000);
        }
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id, key, finished, enabled, historyRef, limit]);
  return snapshot?.id === key ? snapshot : null;
}
