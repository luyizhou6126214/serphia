/** Pure display formatting for the composer statistics dock. */

/** Format a token count the way the reference dock does: 517 / 12.2K / 1.2M. */
export function formatStatTokens(value: number): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`;
  return `${scaled(value / 1_000_000)}M`;
}

/** Throughput keeps one decimal below 10 tok/s and whole numbers above it. */
export function formatStatTokensPerSecond(value: number): string {
  const clamped = Math.max(0, value);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/**
 * Cache-hit share of prompt-side billing. A partial hit never rounds up to
 * 100%: one decimal is shown once the ordinary reading would reach 99%.
 */
export function formatStatCacheHit(cacheReadTokens: number, promptTokens: number): string | null {
  if (promptTokens <= 0) return null;
  if (cacheReadTokens >= promptTokens) return "100";
  const percent = (Math.max(0, cacheReadTokens) / promptTokens) * 100;
  if (percent >= 99.95) return "99.9";
  if (percent >= 99) return percent.toFixed(1);
  return String(Math.round(percent));
}
