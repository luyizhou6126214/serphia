/** Persisted width of the centered conversation/composer column. */
export const CHAT_WIDTH_STORAGE_KEY = "serphia.chat.contentWidth";
/** Smallest draggable content width; matches the readable chat column floor. */
export const CHAT_WIDTH_MIN = 560;
/** Horizontal room kept for both handles and the outer safe zones. */
export const CHAT_WIDTH_EDGE_BUDGET = 64;
/** Breathing room between the content column and each handle line. */
export const CHAT_WIDTH_HANDLE_GAP = 16;

type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): WidthStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Read a finite positive persisted width, or null when absent/corrupt. */
export function readChatWidthPreference(storage: WidthStorage | null = defaultStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHAT_WIDTH_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeChatWidthPreference(width: number, storage: WidthStorage | null = defaultStorage()): void {
  if (!storage || !Number.isFinite(width) || width <= 0) return;
  try {
    storage.setItem(CHAT_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    /* storage can be unavailable in restricted renderer contexts */
  }
}

export function clearChatWidthPreference(storage: WidthStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CHAT_WIDTH_STORAGE_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

/** Clamp a requested column width to the chat area while leaving handle room. */
export function clampChatWidth(width: number, rootWidth: number): number {
  const max = Math.max(320, Math.floor(rootWidth - CHAT_WIDTH_EDGE_BUDGET));
  const min = Math.min(CHAT_WIDTH_MIN, max);
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.min(Math.max(width, min), max));
}

/**
 * Convert a pointer delta into a centered-column width. Dragging either handle
 * outward expands both sides, so the column grows by twice the horizontal delta.
 */
export function draggedChatWidth(baseWidth: number, deltaX: number, side: "left" | "right", rootWidth: number): number {
  const outward = side === "right" ? deltaX : -deltaX;
  return clampChatWidth(baseWidth + outward * 2, rootWidth);
}
