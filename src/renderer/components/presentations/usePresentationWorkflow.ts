import { useCallback, useEffect, useRef, useState } from "react";
import { call, getSession, subscribeAgentEvents, type newAgent } from "@/lib/api-client";
import type { PresentationArtifactSnapshot, PresentationWorkflow } from "@contract/presentations";
import type { SessionInfo } from "@contract/types";

function savedSession(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePresentationWorkflow(cwd: string | null, visible: boolean) {
  const key = `serphia:ppt-workflow:${cwd ?? "local"}`;
  const [restoreId] = useState(() => savedSession(key));
  const [restoring, setRestoring] = useState(Boolean(restoreId));
  const [workflow, setWorkflow] = useState<PresentationWorkflow | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [artifacts, setArtifacts] = useState<PresentationArtifactSnapshot>({ exports: [] });
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!restoreId) return;
    let active = true;
    void Promise.all([call("presentations.workflow", { sessionId: restoreId }), getSession(restoreId)])
      .then(([saved, detail]) => {
        if (active) {
          setWorkflow(saved);
          setSession(detail.info);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [restoreId]);

  useEffect(() => {
    if (!workflow || !visible) return;
    let active = true;
    let fetching = false;
    let off: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!active || fetching) return;
      fetching = true;
      try {
        const result = await call("presentations.artifacts", { sessionId: workflow.sessionId });
        if (active)
          setArtifacts((previous) => (JSON.stringify(previous) === JSON.stringify(result) ? previous : result));
      } catch (error) {
        if (active) setError(String(error));
      } finally {
        fetching = false;
      }
    };
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void poll(), 3500);
    };
    void poll();
    void subscribeAgentEvents(workflow.sessionId, (event) => {
      if (event.type === "tool_execution_end" || event.type === "agent_end") void refresh();
    })
      .then((unsubscribe) => {
        if (active) off = unsubscribe;
        else unsubscribe();
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
      clearTimeout(timer);
      off?.();
    };
  }, [visible, workflow]);

  const createSession: typeof newAgent = useCallback(
    async (params) => {
      const token = generation.current;
      const next = await call("presentations.prepare", {
        cwd,
        model: params.provider && params.modelId ? { provider: params.provider, modelId: params.modelId } : undefined,
        modelSelectionExplicit: params.modelSelectionExplicit,
        thinkingLevel: params.thinkingLevel,
        toolNames: params.toolNames,
      });
      if (token !== generation.current) throw new Error("Presentation conversation changed");
      setWorkflow(next);
      return next;
    },
    [cwd],
  );
  function promote(info: SessionInfo) {
    setSession(info);
    try {
      localStorage.setItem(key, info.id);
    } catch {
      /* The session remains in history. */
    }
  }
  function newDeck() {
    generation.current++;
    setDraft((old) => old + 1);
    setWorkflow(null);
    setSession(null);
    setArtifacts({ exports: [] });
    setError("");
    try {
      localStorage.removeItem(key);
    } catch {
      /* Storage is optional. */
    }
  }
  return {
    workflow,
    session,
    files: artifacts.exports,
    confirmationPort: artifacts.confirmationPort,
    designConfirmed: artifacts.designConfirmed,
    error,
    restoring,
    draft,
    createSession,
    promote,
    newDeck,
    setError,
  };
}
