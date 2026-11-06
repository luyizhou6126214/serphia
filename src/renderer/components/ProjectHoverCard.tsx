import { createPortal } from "react-dom";

/**
 * Hover card shown for a project row in the sidebar, mirroring the card the
 * DeepSeek Harness workspace list shows on hover: a dark 244px surface with the
 * project name, its full path and when it was first opened.
 */

export const PROJECT_HOVER_CARD_WIDTH = 244;

export type ProjectHoverCardState = {
  label: string;
  path: string;
  /** Pre-formatted "created at" line; omitted when the project has no sessions. */
  createdLabel: string | null;
  top: number;
  left: number;
};

export function ProjectHoverCard({ card }: { card: ProjectHoverCardState | null }) {
  if (!card) return null;
  return createPortal(
    <div
      className="project-hover-card"
      role="tooltip"
      style={{ top: card.top, left: card.left, width: PROJECT_HOVER_CARD_WIDTH }}
    >
      <div className="project-hover-card-title">{card.label}</div>
      <div className="project-hover-card-path">{card.path}</div>
      {card.createdLabel ? <div className="project-hover-card-meta">{card.createdLabel}</div> : null}
    </div>,
    document.body,
  );
}
