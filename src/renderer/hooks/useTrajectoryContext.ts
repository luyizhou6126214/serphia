import { useEffect, useRef, useState } from "react";
import type { TrajectoryContextEntry } from "@contract/types";
import { getSessionTrajectoryContext } from "@/lib/api-client";

/**
 * Load context-only session records for the trajectory view. The request is
 * scoped to the active branch and superseded when the branch or session
 * changes. Failures degrade to an empty context section instead of breaking
 * the trajectory.
 */
export function useTrajectoryContext(
  sessionId: string | null | undefined,
  leafId: string | null | undefined,
  active: boolean,
  refreshKey: string | number,
): readonly TrajectoryContextEntry[] {
  const [entries, setEntries] = useState<readonly TrajectoryContextEntry[]>([]);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!active || !sessionId) {
      requestRef.current += 1;
      setEntries([]);
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    void getSessionTrajectoryContext(sessionId, leafId ?? undefined)
      .then((result) => {
        if (requestRef.current === request) setEntries(result.entries);
      })
      .catch(() => {
        if (requestRef.current === request) setEntries([]);
      });
    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
  }, [active, leafId, refreshKey, sessionId]);

  return entries;
}
