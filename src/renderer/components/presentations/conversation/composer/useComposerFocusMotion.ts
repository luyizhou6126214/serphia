import { useEffect, useRef, type RefObject } from "react";

/** Lift applied to the composer while it owns focus. */
const FOCUSED_LIFT = -2.5;
/** Brief scale the card takes on its way to rest; it returns to 1 so text stays crisp. */
const FOCUSED_SCALE = 1.01;

type Gsap = typeof import("gsap").gsap;
type Timeline = ReturnType<Gsap["timeline"]>;

let gsapLoader: Promise<Gsap> | null = null;

/**
 * The renderer already carries GSAP through the app shell, so this resolves from
 * the module graph instead of fetching a chunk. Importing it lazily keeps the
 * composer's module graph free of the animation ticker for DOM-less renderers.
 */
function loadGsap(): Promise<Gsap> {
  gsapLoader ??= import("gsap").then((module) => module.gsap);
  return gsapLoader;
}

/**
 * Choreographs the composer's focus moment: the card lifts and breathes, the
 * aurora blooms behind it and two light ripples scatter outward and dissolve.
 * The aurora then keeps a slow CSS breathing cycle for as long as the composer
 * owns focus — that cycle is a compositor-only animation, so typing costs nothing.
 *
 * The entrance is deliberately one-shot. With `prefers-reduced-motion` the end
 * states are applied without a timeline and the breathing cycle is disabled by CSS.
 */
export function useComposerFocusMotion(
  cardRef: RefObject<HTMLDivElement | null>,
  auraRef: RefObject<HTMLDivElement | null>,
  rippleARef: RefObject<HTMLDivElement | null>,
  rippleBRef: RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  const engagedRef = useRef(false);
  const timelineRef = useRef<Timeline | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const card = cardRef.current;
    const aura = auraRef.current;
    const rippleA = rippleARef.current;
    const rippleB = rippleBRef.current;
    // Refs stay null in DOM-less renderers; the composer then simply keeps its CSS state.
    if (!card || !aura || !rippleA || !rippleB) return;
    // The first passive render should not play the release animation.
    if (!active && !engagedRef.current) return;
    engagedRef.current = true;

    const request = ++requestRef.current;
    let disposed = false;

    const reducedMotion =
      typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);

    void loadGsap()
      .then((gsap) => {
        // A newer focus change (or unmount) superseded this one while it loaded.
        if (disposed || request !== requestRef.current) return;
        timelineRef.current?.kill();
        timelineRef.current = null;

        if (reducedMotion) {
          gsap.set(card, { y: active ? FOCUSED_LIFT : 0, scale: 1 });
          gsap.set(aura, { autoAlpha: active ? 1 : 0 });
          gsap.set([rippleA, rippleB], { autoAlpha: 0 });
          return;
        }

        const timeline = gsap.timeline({ defaults: { overwrite: "auto" } });
        timelineRef.current = timeline;

        if (active) {
          timeline
            .to(card, { y: FOCUSED_LIFT, duration: 0.55, ease: "expo.out" }, 0)
            .to(card, { scale: FOCUSED_SCALE, duration: 0.4, ease: "power2.out" }, 0)
            .to(card, { scale: 1, duration: 0.6, ease: "power2.inOut" }, 0.45)
            .fromTo(
              aura,
              { autoAlpha: 0, scale: 0.92 },
              { autoAlpha: 1, scale: 1, duration: 0.6, ease: "power3.out" },
              0.02,
            )
            // Ripples start visible and dissolve as they spread: light scattering.
            .fromTo(
              rippleA,
              { autoAlpha: 0.55, scale: 0.97 },
              { autoAlpha: 0, scale: 1.22, duration: 1.25, ease: "power2.out", immediateRender: false },
              0.05,
            )
            .fromTo(
              rippleB,
              { autoAlpha: 0.42, scale: 0.97 },
              { autoAlpha: 0, scale: 1.32, duration: 1.4, ease: "power2.out", immediateRender: false },
              0.24,
            );
        } else {
          timeline
            .to(aura, { autoAlpha: 0, duration: 0.35, ease: "power2.inOut" }, 0)
            .to([rippleA, rippleB], { autoAlpha: 0, duration: 0.25, ease: "power2.in" }, 0)
            .to(card, { y: 0, scale: 1, duration: 0.34, ease: "power3.out" }, 0);
        }
      })
      .catch(() => {
        // Without the animation engine the composer keeps its CSS focus state.
      });

    return () => {
      disposed = true;
      timelineRef.current?.kill();
      timelineRef.current = null;
    };
  }, [active, cardRef, auraRef, rippleARef, rippleBRef]);
}
