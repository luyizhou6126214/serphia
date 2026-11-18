import { useEffect, useRef, useState } from "react";
import { call, subscribe } from "@/lib/api-client";
import { RpcError } from "@contract/types";
import type { Outline, OutlineRequest, PresentationEvent, Slide } from "@contract/presentations";

type OutlineBrief = Omit<OutlineRequest, "id">;
type SlideBrief = Omit<OutlineBrief, "count">;
type Run = { ids: Set<string>; stopped: boolean };
type AgentError = { message: string; noModel: boolean };
export type PageState = "queued" | "running" | "complete" | "error";
const problem = (error: unknown): AgentError => ({
  message: error instanceof Error ? error.message : String(error),
  noModel: error instanceof RpcError && error.code === "PRESENTATION_NO_MODEL",
});

export function usePresentationAgent() {
  const operation = useRef<Run | null>(null);
  const mounted = useRef(true);
  const savedBrief = useRef<SlideBrief | null>(null);
  const completed = useRef(new Set<number>());
  const [outline, setOutline] = useState<Outline | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [pageStates, setPageStates] = useState<PageState[]>([]);
  const [events, setEvents] = useState<PresentationEvent[]>([]);
  const [phase, setPhase] = useState<"idle" | "outline" | "slides">("idle");
  const [error, setError] = useState<AgentError | null>(null);

  async function cancel(active: Run) {
    active.stopped = true;
    await Promise.all([...active.ids].map((id) => call("presentations.stop", { id })));
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) void cancel(operation.current).catch(() => undefined);
    };
  }, []);

  function receive(run: Run, event: PresentationEvent) {
    if (!mounted.current || run.stopped || operation.current !== run) return;
    setEvents((previous) =>
      [
        ...previous.filter((item) => event.type !== "render" || item.type !== "render" || item.runId !== event.runId),
        event,
      ].slice(-400),
    );
    if (event.type === "render" && event.slide && event.index !== null) {
      const frame = event.slide;
      setSlides((previous) =>
        previous.map((slide, index) =>
          index === event.index
            ? {
                ...frame,
                id: slide.id,
                elements: frame.elements.map((element, position) => ({
                  ...element,
                  id: slide.elements[position]?.id ?? crypto.randomUUID(),
                })),
              }
            : slide,
        ),
      );
    }
  }

  async function generateOutline({ count, ...brief }: OutlineBrief) {
    if (operation.current) return;
    const id = crypto.randomUUID();
    const run: Run = { ids: new Set([id]), stopped: false };
    operation.current = run;
    setError(null);
    setEvents([]);
    setPhase("outline");
    let off: (() => void) | undefined;
    try {
      off = await subscribe("presentations.events", id, (event) => receive(run, event));
      if (run.stopped) return;
      const result = await call("presentations.outline", { ...brief, count, id });
      if (!run.stopped && mounted.current) {
        savedBrief.current = brief;
        completed.current.clear();
        setOutline(result);
        setSlides([]);
        setPageStates(result.pages.map(() => "queued"));
      }
    } catch (error) {
      if (!run.stopped && mounted.current) setError(problem(error));
    } finally {
      off?.();
      operation.current = null;
      if (mounted.current) setPhase("idle");
    }
  }

  async function generatePages() {
    if (operation.current || !outline || !savedBrief.current) return;
    const brief = savedBrief.current;
    const run: Run = { ids: new Set(), stopped: false };
    operation.current = run;
    setPhase("slides");
    setError(null);
    setSlides((previous) =>
      outline.pages.map(
        (page, index) =>
          previous[index] ?? {
            id: crypto.randomUUID(),
            title: page.title,
            background: "#F6F7FB",
            elements: [],
          },
      ),
    );
    const queue = outline.pages.map((_, index) => index).filter((index) => !completed.current.has(index));
    const updateState = (index: number, state: PageState) => {
      if (mounted.current) setPageStates((previous) => previous.map((value, i) => (i === index ? state : value)));
    };
    async function worker() {
      while (queue.length && !run.stopped) {
        const index = queue.shift()!;
        const id = crypto.randomUUID();
        run.ids.add(id);
        updateState(index, "running");
        let off: (() => void) | undefined;
        try {
          off = await subscribe("presentations.events", id, (event) => receive(run, event));
          if (run.stopped) {
            updateState(index, "queued");
            return;
          }
          const page = await call("presentations.page", { ...brief, id, outline: outline!, index });
          if (!run.stopped && mounted.current) {
            receive(run, { runId: id, at: Date.now(), index, type: "render", slide: page });
            completed.current.add(index);
            updateState(index, "complete");
          } else updateState(index, "queued");
        } catch (error) {
          updateState(index, run.stopped ? "queued" : "error");
          if (!run.stopped && mounted.current) setError(problem(error));
        } finally {
          off?.();
          run.ids.delete(id);
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
    } finally {
      operation.current = null;
      if (mounted.current) setPhase("idle");
    }
  }

  return {
    outline,
    setOutline,
    slides,
    phase,
    error,
    events,
    pageStates,
    completedCount: pageStates.filter((state) => state === "complete").length,
    generateOutline,
    generatePages,
    stop: () => {
      if (operation.current)
        void cancel(operation.current).catch((error) => mounted.current && setError(problem(error)));
    },
    reset: (keepHistory = false) => {
      if (operation.current) return;
      savedBrief.current = null;
      completed.current.clear();
      setOutline(null);
      setSlides([]);
      if (!keepHistory) {
        setPageStates([]);
        setEvents([]);
      }
      setError(null);
    },
  };
}
