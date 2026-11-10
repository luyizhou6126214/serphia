import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalFileReference } from "@/lib/file-url";

export interface PendingComposerMessage {
  id: string;
  text: string;
  files: LocalFileReference[];
}

const cache = new Map<string, PendingComposerMessage[]>();
const prefix = "serphia:pending-composer:";

function readPending(owner: string): PendingComposerMessage[] {
  if (cache.has(owner)) return cache.get(owner)!;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(prefix + owner) ?? "[]");
    if (Array.isArray(saved)) {
      const messages = saved.filter(
        (item): item is PendingComposerMessage =>
          item &&
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          Array.isArray(item.files) &&
          item.files.every(
            (file: unknown) =>
              file &&
              typeof file === "object" &&
              "name" in file &&
              typeof file.name === "string" &&
              "path" in file &&
              typeof file.path === "string",
          ),
      );
      cache.set(owner, messages);
      return messages;
    }
  } catch {
    // Keep the in-memory draft usable when storage is unavailable.
  }
  cache.set(owner, []);
  return [];
}

function writePending(owner: string, messages: PendingComposerMessage[]) {
  cache.set(owner, messages);
  try {
    if (messages.length) localStorage.setItem(prefix + owner, JSON.stringify(messages));
    else localStorage.removeItem(prefix + owner);
    return true;
  } catch {
    // Keep pending messages in memory for this app session.
    return false;
  }
}

/** Pending choices belong to a session, even across navigation and remounts. */
export function usePendingComposerMessages(draftKey: string | undefined) {
  const fallback = useRef(`anonymous:${Math.random().toString(36).slice(2)}`);
  const owner = draftKey ?? fallback.current;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [snapshot, setSnapshot] = useState(() => ({ owner, messages: readPending(owner) }));
  const messages = snapshot.owner === owner ? snapshot.messages : readPending(owner);
  useEffect(() => {
    setSnapshot({ owner, messages: readPending(owner) });
  }, [owner]);
  const update = useCallback((target: string, fn: (items: PendingComposerMessage[]) => PendingComposerMessage[]) => {
    const next = fn(readPending(target));
    const persisted = writePending(target, next);
    if (ownerRef.current === target) setSnapshot({ owner: target, messages: next });
    return persisted;
  }, []);
  return { owner, ownerRef, messages, update };
}
