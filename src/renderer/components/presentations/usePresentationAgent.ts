import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api-client";
import { RpcError } from "@contract/types";
import type { Outline, OutlineRequest, Slide } from "@contract/presentations";
import { fromAgentSlide } from "./presentation-editor";

type OutlineBrief = Omit<OutlineRequest, "id">;
type SlideBrief = Omit<OutlineBrief, "count">;
type Run = { id: string; stopped: boolean };
type AgentError = { message: string; noModel: boolean };
const problem = (error: unknown): AgentError => ({
  message: error instanceof Error ? error.message : String(error),
  noModel: error instanceof RpcError && error.code === "PRESENTATION_NO_MODEL",
});

export function usePresentationAgent() {
  const operation = useRef<Run | null>(null);
  const savedBrief = useRef<SlideBrief | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [phase, setPhase] = useState<"idle" | "outline" | "slides">("idle");
  const [error, setError] = useState<AgentError | null>(null);

  function cancel(active: Run) {
    active.stopped = true;
    return call("presentations.stop", { id: active.id });
  }

  useEffect(
    () => () => {
      if (operation.current) void cancel(operation.current).catch(() => undefined);
    },
    [],
  );

  async function generateOutline({ count, ...brief }: OutlineBrief) {
    if (operation.current) return;
    const run = { id: crypto.randomUUID(), stopped: false };
    operation.current = run;
    setError(null);
    setPhase("outline");
    try {
      const result = await call("presentations.outline", { ...brief, count, id: run.id });
      if (!run.stopped) {
        savedBrief.current = brief;
        setOutline(result);
        setSlides([]);
      }
    } catch (error) {
      if (!run.stopped) setError(problem(error));
    } finally {
      operation.current = null;
      setPhase("idle");
    }
  }

  async function generatePages() {
    if (operation.current || !outline || !savedBrief.current) return;
    const brief = savedBrief.current;
    const run = { id: crypto.randomUUID(), stopped: false };
    operation.current = run;
    setPhase("slides");
    setError(null);
    try {
      for (let index = slides.length; index < outline.pages.length && !run.stopped; index++) {
        run.id = crypto.randomUUID();
        const page = await call("presentations.page", { ...brief, id: run.id, outline, index });
        if (!run.stopped) setSlides((previous) => [...previous, fromAgentSlide(page)]);
      }
    } catch (error) {
      if (!run.stopped) setError(problem(error));
    } finally {
      operation.current = null;
      setPhase("idle");
    }
  }

  return {
    outline,
    setOutline,
    slides,
    phase,
    error,
    generateOutline,
    generatePages,
    stop: () => {
      if (operation.current) void cancel(operation.current).catch((error) => setError(problem(error)));
    },
    reset: () => {
      if (operation.current) return;
      savedBrief.current = null;
      setOutline(null);
      setSlides([]);
      setError(null);
    },
  };
}
