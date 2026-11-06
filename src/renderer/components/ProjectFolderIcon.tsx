/**
 * Project glyph shared by the sidebar project rows and the collapsed rail.
 *
 * The outline mirrors the folder icon shipped in the DeepSeek Harness web UI
 * (16x16 grid, rounded tab, mid crease) so the two apps read the same: a
 * neutral outline while the project is closed and a tinted accent folder once
 * it is opened.
 */

const PROJECT_FOLDER_BODY =
  "M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z";
const PROJECT_FOLDER_CREASE = "M3.63501 7.66614H12.3647";

export type ProjectFolderIconProps = {
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /** Tinted accent state, used while the project is open. */
  open?: boolean;
  strokeWidth?: number;
  className?: string;
};

export function ProjectFolderIcon({ size = 16, open = false, strokeWidth = 1.3, className }: ProjectFolderIconProps) {
  const classes = ["project-folder-icon", open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
    >
      <path className="project-folder-icon-body" d={PROJECT_FOLDER_BODY} stroke="currentColor" />
      <path className="project-folder-icon-crease" d={PROJECT_FOLDER_CREASE} stroke="currentColor" />
    </svg>
  );
}
