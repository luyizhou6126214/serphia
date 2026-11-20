export type ProjectFolderIconProps = {
  size?: number;
  open?: boolean;
  strokeWidth?: number;
  className?: string;
};

export function ProjectFolderIcon({ size = 16, open = false, strokeWidth = 1.5, className }: ProjectFolderIconProps) {
  return (
    <svg
      className={["project-folder-icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {open ? (
        <>
          <path d="M2.25 14.5v-9a1.75 1.75 0 0 1 1.75-1.75h3.25L9.5 6H14a1.75 1.75 0 0 1 1.75 1.75v1" />
          <path
            className="sidebar-icon-body"
            d="m2.35 14.5 1.7-4.65a1.7 1.7 0 0 1 1.6-1.1h11.1a1 1 0 0 1 .95 1.33l-1.8 5.05a1.75 1.75 0 0 1-1.65 1.12H4a1.75 1.75 0 0 1-1.65-1.75Z"
          />
        </>
      ) : (
        <path
          className="sidebar-icon-body"
          d="M2.25 5.5A1.75 1.75 0 0 1 4 3.75h3.25L9.5 6H16a1.75 1.75 0 0 1 1.75 1.75v6.75A1.75 1.75 0 0 1 16 16.25H4a1.75 1.75 0 0 1-1.75-1.75Z"
        />
      )}
    </svg>
  );
}
