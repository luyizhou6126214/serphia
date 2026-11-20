import { useId, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { animateOrbExpressions, restingEye, restingMouth } from "./orb-expressions";

gsap.registerPlugin(useGSAP);

export function WelcomeOrb({ replayLabel }: { replayLabel: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const replay = useRef<(() => void) | null>(null);
  const id = useId();
  const paint = (name: string) => `url(#${id}-${name})`;

  useGSAP(
    () => {
      const element = stage.current!;
      const media = gsap.matchMedia();
      media.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          const lift = "[data-orb-lift]";
          const slit = "[data-orb-slit]";

          const arrival = gsap.timeline({ defaults: { ease: "power3.out" } });
          arrival
            .set(lift, { svgOrigin: "240 112", y: 194, scale: 0.66, rotation: -9 })
            .set(slit, { svgOrigin: "240 226", opacity: 0, scaleX: 0.06, scaleY: 0.28 })
            .set("[data-orb-shadow]", { svgOrigin: "240 225", scaleX: 0.6, opacity: 0 })
            .set("[data-orb-eyes]", { svgOrigin: "234 105", scaleY: 0.12 })
            .to(slit, { opacity: 1, scaleX: 1, scaleY: 1, duration: 0.48 })
            .addLabel("launch", 0.24)
            .to(lift, { y: -11, scale: 1.035, rotation: 3, duration: 0.87, ease: "power3.inOut" }, "launch")
            .to("[data-orb-eyes]", { scaleY: 1, duration: 0.28, ease: "back.out(1.4)" }, "launch+=0.52")
            .to("[data-orb-shadow]", { scaleX: 1, opacity: 1, duration: 0.92 }, "launch+=0.42")
            .to(slit, { scaleX: 0.48, scaleY: 0.07, opacity: 0, duration: 0.73 }, "launch+=0.64")
            .to(lift, { y: 0, scale: 1, rotation: 0, duration: 0.9, ease: "sine.inOut" }, "launch+=0.87");

          const drift = gsap.to("[data-orb-drift]", {
            y: -4,
            duration: 2.6,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
          });
          const expressions = animateOrbExpressions();
          replay.current = () => {
            arrival.restart();
            expressions.restart();
          };
          const face = element.querySelector("[data-orb-face]")!;
          const gazeX = gsap.quickTo(face, "x", { duration: 0.42, ease: "power3.out" });
          const gazeY = gsap.quickTo(face, "y", { duration: 0.42, ease: "power3.out" });
          const surface = element.closest<HTMLElement>(".chat-appearance-scope") ?? element;
          const track = (event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            const box = element.getBoundingClientRect();
            const x = (event.clientX - box.left - box.width * 0.5) / box.width;
            const y = (event.clientY - box.top - box.height * 0.42) / box.height;
            gazeX(gsap.utils.clamp(-8, 8, x * 15));
            gazeY(gsap.utils.clamp(-5, 6, y * 10));
          };
          const center = () => {
            gazeX(0);
            gazeY(0);
          };
          surface.addEventListener("pointermove", track, { passive: true });
          surface.addEventListener("pointerleave", center);

          let inView = true;
          const syncPlayback = () => {
            const paused = document.hidden || !inView;
            arrival.paused(paused);
            drift.paused(paused);
            expressions.timeline.paused(paused);
          };
          const observer = new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            syncPlayback();
          });
          observer.observe(element);
          document.addEventListener("visibilitychange", syncPlayback);
          return () => {
            replay.current = null;
            observer.disconnect();
            document.removeEventListener("visibilitychange", syncPlayback);
            surface.removeEventListener("pointermove", track);
            surface.removeEventListener("pointerleave", center);
          };
        },
        stage,
      );
      return () => media.revert();
    },
    { scope: stage },
  );

  return (
    <div ref={stage} className="welcome-orb">
      <svg viewBox="120 0 240 250" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-cream`} cx=".39" cy=".36" r=".73">
            <stop offset=".34" stopColor="var(--orb-light)" />
            <stop offset=".65" stopColor="var(--orb-midtone)" />
            <stop offset=".9" stopColor="var(--orb-shade)" />
            <stop offset="1" stopColor="var(--orb-edge)" />
          </radialGradient>
          <radialGradient id={`${id}-blush`}>
            <stop offset=".58" stopColor="var(--orb-blush)" />
            <stop offset="1" stopColor="var(--orb-blush)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-shade`}>
            <stop stopColor="var(--orb-shadow)" stopOpacity=".44" />
            <stop offset=".42" stopColor="var(--orb-shadow)" stopOpacity=".19" />
            <stop offset="1" stopColor="var(--orb-shadow)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-aperture`}>
            <stop stopColor="var(--orb-slit-depth)" />
            <stop offset=".57" stopColor="var(--orb-slit-wall)" />
            <stop offset=".89" stopColor="var(--orb-slit-lip)" />
            <stop offset="1" stopColor="var(--orb-slit-edge)" />
          </radialGradient>
          <clipPath id={`${id}-surface`}>
            <path d="M-100 -150 H580 V222 Q240 238 -100 222Z" />
          </clipPath>
        </defs>
        <g data-orb-shadow="">
          <ellipse cx="240" cy="225" rx="88" ry="10" fill={paint("shade")} />
        </g>
        <g data-orb-slit="" opacity="0">
          <ellipse cx="240" cy="226" rx="96" ry="9" fill={paint("aperture")} />
          <path d="M144 226 C160 237 321 240 336 226 C310 235 172 232 144 226Z" fill="var(--orb-slit-glint)" />
        </g>
        <g clipPath={paint("surface")}>
          <g data-orb-lift="">
            <g data-orb-drift="">
              <circle cx="240" cy="112" r="87" fill={paint("cream")} />
              <g data-orb-face="" color="var(--orb-ink)">
                <g data-orb-expression="">
                  <g data-orb-cheeks="" fill={paint("blush")} opacity="0">
                    <ellipse cx="203" cy="119" rx="12" ry="6" />
                    <ellipse cx="266" cy="118" rx="12" ry="6" />
                  </g>
                  <g data-orb-eyes="">
                    <g data-orb-blink="" fill="none" stroke="currentColor" strokeLinecap="round">
                      <path
                        data-orb-eye=""
                        transform="translate(215 104)"
                        d={restingEye.d}
                        strokeWidth={restingEye.width}
                      />
                      <path
                        data-orb-eye=""
                        transform="translate(254 103)"
                        d={restingEye.d}
                        strokeWidth={restingEye.width}
                      />
                    </g>
                  </g>
                  <path
                    data-orb-mouth=""
                    transform="translate(235 124)"
                    d={restingMouth}
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      <button
        type="button"
        className="welcome-orb-replay"
        aria-label={replayLabel}
        onClick={() => replay.current?.()}
      />
    </div>
  );
}
