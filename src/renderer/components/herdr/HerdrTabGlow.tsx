import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export function HerdrTabGlow({ active }: { active: boolean }) {
  const glow = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const element = glow.current;
      if (!active || !element) return;

      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline()
          .fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: "power2.out" })
          .to(element, { opacity: 0, duration: 0.85, ease: "sine.inOut" });

        gsap.fromTo(element, { scaleX: 0.58 }, { scaleX: 1, duration: 0.75, ease: "power3.out" });
      });
      return () => motion.revert();
    },
    { scope: glow, dependencies: [active], revertOnUpdate: true },
  );

  return <span ref={glow} className="hd-tab-glow" aria-hidden="true" />;
}
