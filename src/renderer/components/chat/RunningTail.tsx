/**
 * A quiet swimming mark inside the running status row: an overflow-clipped box
 * whose wave drifts sideways while the Turn is producing output, and rests
 * still when reduced motion is requested.
 */
export function RunningTail() {
  return (
    <span className="dsh-running-tail" aria-hidden="true">
      <svg className="dsh-running-tail-still" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M1.4 9.1c1.4 0 1.4-1.5 2.8-1.5s1.4 1.5 2.8 1.5S8.4 7.6 9.8 7.6s1.4 1.5 2.8 1.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path d="M7 5.2V2.1l2.4 1.55L7 5.2Z" fill="currentColor" />
      </svg>
      <span className="dsh-running-tail-swim">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M1.4 9.1c1.4 0 1.4-1.5 2.8-1.5s1.4 1.5 2.8 1.5S8.4 7.6 9.8 7.6s1.4 1.5 2.8 1.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path d="M7 5.2V2.1l2.4 1.55L7 5.2Z" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}
