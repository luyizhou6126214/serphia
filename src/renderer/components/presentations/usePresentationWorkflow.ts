import { useEffect, useRef, useState } from "react";
import { call, getSession, listModels, subscribeAgentEvents } from "@/lib/api-client";
import { readLastModel, readLastThinkingLevel } from "@/lib/last-session-selection";
import type { PresentationArtifactSnapshot, PresentationWorkflow } from "@contract/presentations";
import type { SessionInfo } from "@contract/types";

const empty: PresentationArtifactSnapshot = { pages: [], exports: [] };
export function usePresentationWorkflow(cwd: string | null) {
  const [workflow, setWorkflow] = useState<PresentationWorkflow | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [artifacts, setArtifacts] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const starting = useRef(false);
  const key = `serphia:ppt-workflow:${cwd ?? "local"}`;

  useEffect(() => {
    const token = ++generation.current;
    setWorkflow(null);
    setSession(null);
    setArtifacts(empty);
    setError("");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      /* Storage is optional. */
    }
    if (saved)
      void Promise.all([call("presentations.workflow", { sessionId: saved }), getSession(saved)])
        .then(([workflow, detail]) => {
          if (generation.current !== token) return;
          setWorkflow(workflow);
          setSession(detail.info);
        })
        .catch((error) => {
          if (generation.current === token) setError(String(error));
        });
    return () => {
      generation.current = token + 1;
    };
  }, [key]);

  useEffect(() => {
    if (!workflow) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    let off: (() => void) | undefined;
    const refresh = async () => {
      if (!active || fetching) return;
      fetching = true;
      try {
        const result = await call("presentations.artifacts", { sessionId: workflow.sessionId });
        if (active)
          setArtifacts((previous) =>
            previous.pages.length === result.pages.length &&
            previous.pages.every(
              (page, index) => page.path === result.pages[index].path && page.revision === result.pages[index].revision,
            ) &&
            JSON.stringify(previous.exports) === JSON.stringify(result.exports)
              ? previous
              : result,
          );
      } catch (error) {
        if (active) setError(String(error));
      } finally {
        fetching = false;
      }
    };
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void poll(), 1400);
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
  }, [workflow]);

  async function start(brief: string, source: string, count: number, language: string) {
    if (starting.current || !brief.trim()) return false;
    starting.current = true;
    setBusy(true);
    setError("");
    const token = generation.current;
    try {
      const savedModel = readLastModel();
      const catalog = savedModel ? await listModels(cwd ?? undefined) : null;
      if (token !== generation.current) return false;
      const model = catalog?.models.some(
        (model) => model.provider === savedModel?.provider && model.id === savedModel.modelId,
      )
        ? savedModel
        : null;
      const thinkingLevel = readLastThinkingLevel();
      const next = await call("presentations.prepare", {
        cwd,
        brief: brief.trim(),
        source,
        count,
        language,
        ...(model ? { model } : {}),
        ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
      });
      if (token !== generation.current) return false;
      const detail = await getSession(next.sessionId);
      if (token !== generation.current) return false;
      setWorkflow(next);
      setSession(detail.info);
      setArtifacts(empty);
      try {
        localStorage.setItem(key, next.sessionId);
      } catch {
        /* Session still exists in the main history. */
      }
      // ChatWindow submits the initial prompt after connecting its normal event stream.
      return true;
    } catch (error) {
      if (token === generation.current) setError(String(error));
      return false;
    } finally {
      starting.current = false;
      if (token === generation.current) setBusy(false);
    }
  }
  return {
    workflow,
    session,
    artifacts,
    busy,
    error,
    start,
    dismissError: () => setError(""),
  };
}
