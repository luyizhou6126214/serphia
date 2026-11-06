/** Human-readable elapsed time for a completed or running turn. */
export function formatTurnDuration(ms: number | undefined, language: string): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (language.startsWith("zh")) {
    if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  }
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
