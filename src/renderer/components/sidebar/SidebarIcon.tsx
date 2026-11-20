const glyphs = {
  sessions: (
    <path
      className="sidebar-icon-body"
      d="M2.75 8.7c0-.55.24-1.07.66-1.43l5.5-4.63a1.7 1.7 0 0 1 2.18 0l5.5 4.63c.42.36.66.88.66 1.43v7.05c0 .97-.78 1.75-1.75 1.75h-3.25v-5a1 1 0 0 0-1-1h-2.5a1 1 0 0 0-1 1v5H4.5c-.97 0-1.75-.78-1.75-1.75Z"
    />
  ),
  schedule: (
    <>
      <rect className="sidebar-icon-body" x="2.75" y="4.25" width="14.5" height="13.25" rx="2.5" />
      <path d="M6.5 2.5v3.25m7-3.25v3.25" />
      <path className="sidebar-icon-detail" d="M3.5 8.25h13M6.5 12h3.25" />
    </>
  ),
  herdr: (
    <>
      <path
        className="sidebar-icon-body"
        d="m3 6.6 6.25-3.35a1.6 1.6 0 0 1 1.5 0L17 6.6a.7.7 0 0 1 0 1.25l-6.25 3.35a1.6 1.6 0 0 1-1.5 0L3 7.85a.7.7 0 0 1 0-1.25Z"
      />
      <path d="m2.75 11.2 6.5 3.45a1.6 1.6 0 0 0 1.5 0l6.5-3.45" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 6h3m5.5 0h6.5m-15 8h8m5.5 0h1.5" />
      <circle className="sidebar-icon-body" cx="8.25" cy="6" r="2.75" />
      <circle className="sidebar-icon-body" cx="13.25" cy="14" r="2.75" />
    </>
  ),
  newChat: (
    <>
      <path
        className="sidebar-icon-body"
        d="M6 2.75h8a3.25 3.25 0 0 1 3.25 3.25v6.25A3.25 3.25 0 0 1 14 15.5H8l-4.5 2.25V14.4a3.2 3.2 0 0 1-.75-2.15V6A3.25 3.25 0 0 1 6 2.75Z"
      />
      <path className="sidebar-icon-detail" d="M7 9.25h6m-3-3v6" />
    </>
  ),
};

export function SidebarIcon({ name, size = 20 }: { name: keyof typeof glyphs; size?: number }) {
  return (
    <svg
      className="sidebar-icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}
