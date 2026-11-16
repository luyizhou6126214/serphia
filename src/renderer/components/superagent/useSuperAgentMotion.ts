import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

export function useSuperAgentEntrance(
  scope: RefObject<HTMLElement | null>,
  trigger: string | boolean | undefined,
  mode: "view" | "message",
) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!trigger || !root) return;
      const motion = gsap.matchMedia();
      motion.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          const targets = mode === "view" ? root.querySelectorAll<HTMLElement>("[data-sa-enter]") : [root];
          if (!targets.length) return;
          gsap.from(targets, {
            opacity: 0.7,
            y: mode === "view" ? 6 : 4,
            duration: mode === "view" ? 0.24 : 0.16,
            ease: "power3.out",
            clearProps: "opacity,transform",
          });
        },
        root,
      );
      return () => motion.revert();
    },
    { scope, dependencies: [trigger, mode], revertOnUpdate: true },
  );
}
