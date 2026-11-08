/**
 * Geometry for the conversation's overlay scrollbar. The native bar cannot sit
 * at the far right of the column (the timeline rail owns that gutter) and stops
 * above the composer, so the transcript draws its own bar over the full column
 * height and maps pointer motion back to `scrollTop` here.
 */

export interface ScrollbarThumb {
  /** Visible thumb height, never smaller than the minimum affordance. */
  thumbHeight: number;
  /** Thumb offset inside the track. */
  thumbTop: number;
  /** Largest scroll offset the transcript can reach. */
  maxScroll: number;
}

/** Smallest thumb that stays easy to grab. */
export const MIN_THUMB_HEIGHT = 28;

/**
 * Compute the thumb for one scrollport, or `null` while it cannot scroll.
 * @param input - track and scrollport measurements.
 * @returns the thumb geometry, or null when the content fits.
 */
export function computeScrollbarThumb(input: {
  trackHeight: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  minThumbHeight?: number;
}): ScrollbarThumb | null {
  const { trackHeight, clientHeight, scrollHeight, scrollTop } = input;
  const maxScroll = scrollHeight - clientHeight;
  if (trackHeight <= 0 || clientHeight <= 0 || maxScroll <= 1) return null;
  const minThumb = input.minThumbHeight ?? MIN_THUMB_HEIGHT;
  const thumbHeight = Math.max(minThumb, Math.min(trackHeight, (trackHeight * clientHeight) / scrollHeight));
  const travel = Math.max(0, trackHeight - thumbHeight);
  const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
  return { thumbHeight, thumbTop: progress * travel, maxScroll };
}

/**
 * Convert a pointer position on the track into a thumb offset.
 * @param input - pointer offset from the track top and the current geometry.
 * @returns a clamped thumb offset.
 */
export function thumbTopFromPointer(input: { pointerY: number; thumbHeight: number; trackHeight: number }): number {
  const travel = Math.max(0, input.trackHeight - input.thumbHeight);
  return Math.min(travel, Math.max(0, input.pointerY - input.thumbHeight / 2));
}

/**
 * Convert a thumb offset back into the transcript's `scrollTop`.
 * @param input - thumb offset and current geometry.
 * @returns a clamped scroll offset.
 */
export function scrollTopFromThumb(input: {
  thumbTop: number;
  thumbHeight: number;
  trackHeight: number;
  maxScroll: number;
}): number {
  const travel = Math.max(1, input.trackHeight - input.thumbHeight);
  return Math.min(input.maxScroll, Math.max(0, (input.thumbTop / travel) * input.maxScroll));
}
