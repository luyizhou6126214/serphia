import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, type RefObject } from "react";

gsap.registerPlugin(useGSAP);

const motion = "(prefers-reduced-motion: no-preference)";

export function useReviewMotion(
  scope: RefObject<HTMLElement | null>,
  active: boolean,
  complete: boolean,
  docked: boolean,
  readyPanelVisible: boolean,
) {
  const launchPosition = useRef<DOMRect | null>(null);

  function captureLaunchPosition() {
    const controls = scope.current?.querySelector("[data-review-launch-controls]");
    launchPosition.current = controls?.getBoundingClientRect() ?? null;
  }

  useGSAP(
    () => {
      if (!docked) return;
      const initialPosition = launchPosition.current;
      launchPosition.current = null;
      const media = gsap.matchMedia();
      media.add(
        motion,
        () => {
          const controls = scope.current?.querySelector("[data-review-launch-controls]");
          if (controls && initialPosition) {
            const position = controls.getBoundingClientRect();
            gsap.from(controls, {
              x: initialPosition.right - position.right,
              y: initialPosition.top - position.top,
              duration: 0.55,
              ease: "power4.out",
              clearProps: "transform",
            });
          }
          gsap.from("[data-review-transcript]", {
            autoAlpha: 0,
            y: 12,
            duration: 0.42,
            ease: "power2.out",
            clearProps: "opacity,visibility,transform",
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
          gsap.from("[data-review-controls]", {
            autoAlpha: 0,
            y: 14,
            scale: 0.975,
            duration: 0.48,
            ease: "power3.out",
            clearProps: "opacity,visibility,transform",
          });
          gsap.from("[data-review-launch-copy] > *", {
            autoAlpha: 0,
            y: 8,
            stagger: 0.055,
            duration: 0.38,
            ease: "power2.out",
            clearProps: "opacity,visibility,transform",
          });
          gsap.to("[data-review-mark]", {
            y: -6,
            duration: 2.6,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
          });
          gsap.to("[data-review-halo]", {
            xPercent: (index) => (index === 0 ? 27 : -29),
            yPercent: (index) => (index === 0 ? -11 : 13),
            opacity: 0.94,
            duration: (index) => (index === 0 ? 3.2 : 4.4),
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
          });
          gsap.to('[data-review-orbit="inner"]', {
            rotation: "+=360",
            duration: 6,
            ease: "none",
            repeat: -1,
          });
          gsap.to('[data-review-orbit="outer"]', {
            rotation: "-=360",
            duration: 10,
            ease: "none",
            repeat: -1,
          });
          gsap.to("[data-review-edge]", {
            rotation: "+=360",
            duration: 9,
            ease: "none",
            repeat: -1,
          });
        },
        scope.current ?? undefined,
      );
      return () => media.revert();
    },
    { scope, dependencies: [readyPanelVisible], revertOnUpdate: true },
  );

  return captureLaunchPosition;
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
