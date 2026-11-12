import type { ReviewActivityEntry, ReviewActivityStats } from "../../contract/code-review";

function count(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class ReviewActivityTotals {
  private totals: ReviewActivityStats = { modelCalls: 0, toolCalls: 0 };
  private missingCache = false;
  private contextId = 0;

  record(entry: ReviewActivityEntry, previous?: ReviewActivityEntry) {
    const totals = this.totals;
    if (entry.kind === "tool") {
      if (!previous) totals.toolCalls++;
      const duration = count(entry.durationMs);
      if (duration !== undefined) {
        const oldDuration = previous?.kind === "tool" ? count(previous.durationMs) : undefined;
        totals.toolDurationMs = (totals.toolDurationMs ?? 0) + duration - (oldDuration ?? 0);
      }
      return;
    }
    if (entry.kind !== "model") return;
    if (!previous) totals.modelCalls++;
    if (entry.status === "running" || (previous?.kind === "model" && previous.status !== "running")) return;
    const duration = count(entry.durationMs);
    if (duration !== undefined) totals.modelDurationMs = (totals.modelDurationMs ?? 0) + duration;
    const input = count(entry.inputTokens);
    const output = count(entry.outputTokens);
    if (input === undefined && output === undefined) return;
    if (input !== undefined) totals.inputTokens = (totals.inputTokens ?? 0) + input;
    if (output !== undefined) totals.outputTokens = (totals.outputTokens ?? 0) + output;
    const read = count(entry.cacheReadTokens);
    const write = count(entry.cacheWriteTokens);
    this.missingCache ||= input === undefined || read === undefined || write === undefined || read + write > input;
    if (!this.missingCache) {
      totals.cacheReadTokens = (totals.cacheReadTokens ?? 0) + (read ?? 0);
      totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + (write ?? 0);
    } else {
      delete totals.cacheReadTokens;
      delete totals.cacheWriteTokens;
    }
    const window = count(entry.contextWindow);
    if (
      entry.status === "done" &&
      input !== undefined &&
      input + (output ?? 0) > 0 &&
      window &&
      entry.id > this.contextId
    ) {
      totals.context = { tokens: input + (output ?? 0), window };
      this.contextId = entry.id;
    }
  }

  snapshot(): ReviewActivityStats {
    return { ...this.totals };
  }
}

export function summarizeReviewActivity(entries: readonly ReviewActivityEntry[]) {
  const totals = new ReviewActivityTotals();
  for (const entry of entries) totals.record(entry);
  return totals.snapshot();
}
