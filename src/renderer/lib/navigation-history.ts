export interface NavigationHistory<T> {
  entries: T[];
  index: number;
}

export function recordNavigation<T>(
  history: NavigationHistory<T>,
  entry: T,
  same: (a: T, b: T) => boolean,
  replace = false,
): NavigationHistory<T> {
  const current = history.entries[history.index];
  if (replace || (current !== undefined && same(current, entry))) {
    const entries = history.entries.slice();
    entries[history.index] = entry;
    return { entries, index: history.index };
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry];
  return { entries, index: entries.length - 1 };
}
