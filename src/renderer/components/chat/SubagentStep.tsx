import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useI18n } from "@/i18n";
import type { SubagentActivityStatus } from "@/lib/types";

gsap.registerPlugin(useGSAP);

export function SubagentStatus({ status }: { status: SubagentActivityStatus }) {
  const { t } = useI18n();
  const labels: Record<SubagentActivityStatus, string> = {
    queued: t("subagentActivityQueued", "Queued"),
    running: t("subagentActivityRunning", "Running"),
    completed: t("subagentActivityCompleted", "Completed"),
    stopped: t("subagentActivityStopped", "Stopped"),
    aborted: t("subagentActivityAborted", "Aborted"),
    paused: t("subagentActivityPaused", "Paused"),
    partial: t("subagentActivityPartial", "Partially completed"),
    error: t("subagentActivityFailed", "Failed"),
  };
  return (
    <span className="dsh-subagent-status" data-state={status}>
      {labels[status]}
    </span>
  );
}

export function SubagentStep({ state, children }: { state?: SubagentActivityStatus; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const running = state === "running";

  useGSAP(
    () => {
      const element = surface.current;
      if (!running || !element || !glow.current) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const pulse = gsap.to(glow.current, {
          opacity: 0.95,
          scale: 1.18,
          duration: 1.6,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          paused: typeof IntersectionObserver !== "undefined",
        });
        if (typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(([entry]) => {
          pulse.paused(!entry.isIntersecting);
        });
        observer.observe(element);
        return () => observer.disconnect();
      });
      return () => media.revert();
    },
    { scope: surface, dependencies: [running], revertOnUpdate: true },
  );

  return (
    <div ref={surface} className="dsh-subagent-step" data-state={state}>
      {running && <span ref={glow} className="dsh-subagent-glow" aria-hidden="true" />}
      {children}
    </div>
  );
}
