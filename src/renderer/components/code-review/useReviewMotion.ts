import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

const motion = "(prefers-reduced-motion: no-preference)";

export function useReviewMotion(
  scope: RefObject<HTMLElement | null>,
  active: boolean,
  complete: boolean,
  docked: boolean,
  readyPanelVisible: boolean,
) {
  useGSAP(
    () => {
      if (!docked) return;
      const media = gsap.matchMedia();
      media.add(
        motion,
        () => {
          gsap.from("[data-review-controls]", {
            y: -14,
            duration: 0.24,
            ease: "power2.out",
            clearProps: "transform",
          });
          gsap.from("[data-review-transcript]", {
            opacity: 0.65,
            duration: 0.2,
            ease: "power2.out",
            clearProps: "opacity",
          });
        },
        scope.current ?? undefined,
      );
      return () => media.revert();
    },
    { scope, dependencies: [docked], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      if (!active && !complete) return;
      const media = gsap.matchMedia();
      media.add(
        motion,
        () => {
          if (active) {
            gsap.fromTo(
              "[data-review-scan]",
              { xPercent: -110 },
              {
                xPercent: 390,
                repeat: -1,
                duration: 1.65,
                ease: "sine.inOut",
              },
            );
            gsap.fromTo(
              "[data-review-signal]",
              { opacity: 0.65, scale: 0.9 },
              {
                opacity: 1,
                scale: 1.15,
                repeat: -1,
                yoyo: true,
                duration: 0.8,
                ease: "sine.inOut",
              },
            );
          } else {
            gsap.from("[data-review-signal]", {
              scale: 1.7,
              duration: 0.48,
              ease: "power3.out",
              clearProps: "transform",
            });
          }
        },
        scope.current ?? undefined,
      );
      return () => media.revert();
    },
    { scope, dependencies: [active, complete], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      if (!readyPanelVisible) return;
      const media = gsap.matchMedia();
      media.add(
        motion,
        () => {
          gsap.fromTo(
            "[data-review-halo]",
            { xPercent: -13, yPercent: 6, opacity: 0.48 },
            {
              xPercent: 17,
              yPercent: -4,
              opacity: 0.86,
              duration: 3.6,
              ease: "sine.inOut",
              repeat: -1,
              yoyo: true,
            },
          );
        },
        scope.current ?? undefined,
      );
      return () => media.revert();
    },
    { scope, dependencies: [readyPanelVisible], revertOnUpdate: true },
  );
}

export function useReviewEntrance(target: RefObject<HTMLElement | null>, open: boolean) {
  useGSAP(
    () => {
      if (!open || !target.current) return;
      const media = gsap.matchMedia();
      media.add(motion, () => {
        gsap.from(target.current, {
          y: -5,
          autoAlpha: 0,
          duration: 0.2,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        });
      });
      return () => media.revert();
    },
    { dependencies: [open], revertOnUpdate: true },
  );
}
