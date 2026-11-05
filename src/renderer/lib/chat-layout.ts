/**
 * Horizontal geometry shared by the conversation view and the composer dock.
 *
 * The chat view keeps a fixed gutter at its right edge for the timeline
 * minimap (`32px` rail plus a `20px` right margin), and the message column is
 * centered inside the remaining width. The dock must reserve that same gutter:
 * centering it in the full width instead moves it away from the message
 * column, which is why both surfaces read from these constants.
 */
export const CHAT_MINIMAP_WIDTH = 52;

/** Symmetric gutter around the centered chat column. */
export const CHAT_COLUMN_PADDING = 16;

/** Right gutter for the dock: the column gutter plus the minimap gutter. */
export const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;
