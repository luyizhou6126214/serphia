import { gsap } from "gsap";
import { useEffect, type RefObject } from "react";

/** Headless tests and reduced-motion users get the final state without tweens. */
function stillMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function isMotionReduced(): boolean {
  return stillMotion();
}

/** Short hover lift shared by marketplace cards. */
export function hoverLift(element: HTMLElement | null, y: number): void {
  if (!element || stillMotion()) return;
  gsap.to(element, {
    y,
    duration: 0.18,
    ease: "power2.out",
    overwrite: "auto",
    ...(y === 0 ? { clearProps: "transform" } : {}),
  });
}

const CLEAR = "transform,opacity,visibility";

export interface StaggerOptions {
  y?: number;
  duration?: number;
  stagger?: number;
}

/** Stagger descendant entrances whenever `version` changes (list, search results). */
export function useStaggerIn(
  root: RefObject<HTMLElement | null>,
  selector: string,
  version: string | number,
  options: StaggerOptions = {},
): void {
  const y = options.y ?? 8;
  const duration = options.duration ?? 0.26;
  const stagger = options.stagger ?? 0.035;
  useEffect(() => {
    const element = root.current;
    if (!element || stillMotion()) return;
    const targets = Array.from(element.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;
    const tween = gsap.fromTo(
      targets,
      { autoAlpha: 0, y },
      { autoAlpha: 1, y: 0, duration, stagger, ease: "power2.out", overwrite: "auto", clearProps: CLEAR },
    );
    return () => {
      tween.kill();
    };
  }, [root, selector, version, y, duration, stagger]);
}

/** Soft swap for a panel whose identity changed (selected package, add mode). */
export function useRiseIn(root: RefObject<HTMLElement | null>, key: string | null): void {
  useEffect(() => {
    const element = root.current;
    if (!element || !key || stillMotion()) return;
    const tween = gsap.fromTo(
      element,
      { autoAlpha: 0, y: 6 },
      { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out", overwrite: "auto", clearProps: CLEAR },
    );
    return () => {
      tween.kill();
    };
  }, [root, key]);
}

/** Subtle confirmation pulse, used when an install lands. */
export function usePulse(ref: RefObject<HTMLElement | null>, trigger: string | null): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !trigger || stillMotion()) return;
    const tween = gsap.fromTo(
      element,
      { scale: 0.97 },
      { scale: 1, duration: 0.4, ease: "back.out(2.2)", overwrite: "auto", clearProps: "transform" },
    );
    return () => {
      tween.kill();
    };
  }, [ref, trigger]);
}

/**
 * Move a shared pill indicator to a seat index. The pill is exactly one seat
 * wide, so one seat equals 100% of its own width (xPercent).
 */
export function movePill(pill: HTMLElement | null, index: number): void {
  if (!pill || stillMotion()) return;
  gsap.to(pill, { xPercent: index * 100, duration: 0.28, ease: "power3.out", overwrite: "auto" });
}

/** Move the scope pill between its two seats. */
export function moveScopePill(pill: HTMLElement | null, project: boolean): void {
  movePill(pill, project ? 1 : 0);
}
