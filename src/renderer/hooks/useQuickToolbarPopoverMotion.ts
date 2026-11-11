import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

export function useQuickToolbarPopoverMotion(dialogRef: RefObject<HTMLDivElement | null>, open: boolean) {
  useGSAP(
    () => {
      const dialog = dialogRef.current;
      if (!open || !dialog) return;

      const motion = gsap.matchMedia();
      motion.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          gsap.from(dialog, {
            y: dialog.dataset.placement === "top" ? 6 : -6,
            opacity: 0.5,
            duration: 0.24,
            ease: "power3.out",
            clearProps: "transform,opacity",
          });
          const rows = dialog.querySelectorAll("[data-quick-toolbar-row]");
          if (rows.length > 0) {
            gsap.from(rows, {
              y: 6,
              opacity: 0.55,
              duration: 0.28,
              stagger: { amount: 0.12 },
              ease: "power3.out",
              clearProps: "transform,opacity",
            });
          }
          gsap.to(".quick-toolbar-halo", {
            "--quick-halo-angle": "+=360deg",
            duration: 12,
            ease: "none",
            repeat: -1,
          });
        },
        dialog,
      );
      return () => motion.revert();
    },
    { dependencies: [dialogRef, open], revertOnUpdate: true },
  );
}
