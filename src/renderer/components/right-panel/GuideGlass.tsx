import { useId, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

gsap.registerPlugin(useGSAP);

type Point = { x: number; y: number };

function corners(card: HTMLElement): Point[] {
  const x = card.offsetLeft;
  const y = card.offsetTop;
  const right = x + card.offsetWidth;
  const bottom = y + card.offsetHeight;
  return [
    { x, y },
    { x: right, y },
    { x: right, y: bottom },
    { x, y: bottom },
  ];
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function nearCorner(corner: Point, neighbor: Point, radius: number): Point {
  const length = Math.hypot(neighbor.x - corner.x, neighbor.y - corner.y);
  return mix(corner, neighbor, Math.min(0.45, radius / Math.max(1, length)));
}

function outline(points: Point[], pinch: number): string {
  const center = mix(points[0], points[2], 0.5);
  const radius = 17 + pinch * 36;
  const start = nearCorner(points[0], points[3], radius);
  let path = `M ${start.x} ${start.y}`;
  for (let i = 0; i < 4; i++) {
    const corner = points[i];
    const next = points[(i + 1) % 4];
    const after = nearCorner(corner, next, radius);
    const before = nearCorner(next, corner, radius);
    const mid = mix(after, before, 0.5);
    const depth = Math.hypot(center.x - mid.x, center.y - mid.y);
    const middle = mix(mid, center, pinch * Math.min(1, 42 / Math.max(1, depth)));
    path += ` Q ${corner.x} ${corner.y} ${after.x} ${after.y} Q ${middle.x} ${middle.y} ${before.x} ${before.y}`;
  }
  return path + " Z";
}

/** A single meniscus crosses the gutters. Its leading corners arrive before its trailing edge. */
export function GuideGlass({ visible }: { visible: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const lightRef = useRef<SVGRadialGradientElement>(null);
  const id = useId();
  useGSAP(
    () => {
      const svg = svgRef.current;
      const path = pathRef.current;
      const light = lightRef.current;
      const grid = svg?.parentElement;
      if (!visible || !svg || !path || !light || !grid) return;
      const media = gsap.matchMedia();
      media.add(
        "(prefers-reduced-motion: no-preference) and (forced-colors: none)",
        () => {
          let active: HTMLElement | null = null;
          let displayed: Point[] = [];
          let from: Point[] = [];
          let to: Point[] = [];
          let lags: number[] = [];
          let stretch = 0;
          const phase = { value: 0 };
          const ease = gsap.parseEase("back.out(0.85)");
          const fade = gsap.quickTo(svg, "opacity", { duration: 0.24, ease: "power2.out" });
          const hotspot = { x: 0, y: 0 };
          const lightMotion = {
            duration: 0.35,
            ease: "power2.out",
            onUpdate: () => {
              light.setAttribute("cx", String(hotspot.x));
              light.setAttribute("cy", String(hotspot.y));
            },
          };
          const lightX = gsap.quickTo(hotspot, "x", lightMotion);
          const lightY = gsap.quickTo(hotspot, "y", lightMotion);
          const flow = gsap.fromTo(
            phase,
            { value: 0 },
            {
              value: 1,
              duration: 0.64,
              ease: "none",
              paused: true,
              immediateRender: false,
              onUpdate: () => {
                if (!to.length) return;
                displayed = to.map((corner, i) => {
                  const t = Math.max(0, (phase.value - lags[i]) / (1 - lags[i]));
                  return mix(from[i], corner, ease(t));
                });
                path.setAttribute("d", outline(displayed, stretch * Math.sin(Math.PI * phase.value) ** 2));
              },
            },
          );

          const select = (card: HTMLElement | null) => {
            if (card === active) return;
            active = card;
            if (!card) {
              fade(0);
              return;
            }
            to = corners(card);
            const center = mix(to[0], to[2], 0.5);
            lightX(center.x);
            lightY(to[0].y + 8);
            from = displayed.length ? displayed : to.map((point) => mix(center, point, 0.83));
            const previous = mix(from[0], from[2], 0.5);
            const dx = center.x - previous.x;
            const dy = center.y - previous.y;
            const span = Math.abs(dx) * card.offsetWidth + Math.abs(dy) * card.offsetHeight;
            // Project each corner onto the travel direction so diagonal transfers also stretch along their path.
            lags = to.map((p) => (span ? 0.3 * (0.5 - ((p.x - center.x) * dx + (p.y - center.y) * dy) / span) : 0));
            stretch = Math.min(0.52, Math.hypot(dx, dy) / 260);
            path.setAttribute("d", outline(from, 0));
            flow.restart();
            fade(1);
          };

          const cardFor = (target: EventTarget | null) => {
            const card =
              target instanceof Element ? target.closest<HTMLElement>("[data-right-panel-guide-entry]") : null;
            return card && grid.contains(card) && card.querySelector("button:enabled") ? card : null;
          };
          const enter = (event: Event) => {
            const card = cardFor(event.target);
            if (card) select(card);
          };
          const leave = () => select(cardFor(grid.querySelector(":focus-visible")));
          const followLight = (event: PointerEvent) => {
            if (!active || event.pointerType === "touch") return;
            const box = svg.getBoundingClientRect();
            lightX(event.clientX - box.left);
            lightY(event.clientY - box.top);
          };
          const blur = (event: FocusEvent) => {
            select(cardFor(event.relatedTarget) ?? cardFor(grid.querySelector(".rp-guide-entry:hover")));
          };
          const resize = new ResizeObserver(() => {
            if (active) {
              flow.pause();
              displayed = corners(active);
              path.setAttribute("d", outline(displayed, 0));
            } else {
              flow.pause();
              displayed = [];
            }
          });
          resize.observe(grid);
          grid.addEventListener("pointerover", enter);
          grid.addEventListener("pointermove", followLight);
          grid.addEventListener("pointerleave", leave);
          grid.addEventListener("focusin", enter);
          grid.addEventListener("focusout", blur);
          select(cardFor(grid.querySelector(":focus-visible, .rp-guide-entry:hover")));
          return () => {
            resize.disconnect();
            grid.removeEventListener("pointerover", enter);
            grid.removeEventListener("pointermove", followLight);
            grid.removeEventListener("pointerleave", leave);
            grid.removeEventListener("focusin", enter);
            grid.removeEventListener("focusout", blur);
          };
        },
        svg,
      );
      return () => media.revert();
    },
    { scope: svgRef, dependencies: [visible], revertOnUpdate: true },
  );

  return (
    <svg ref={svgRef} className="rp-guide-liquid" aria-hidden="true" focusable="false">
      <defs>
        <path id={id} ref={pathRef} />
        <linearGradient id={`${id}-glass`} x2=".85" y2="1">
          <stop stopColor="var(--rp-glass-light)" />
          <stop offset=".28" stopColor="var(--rp-glass-amber)" />
          <stop offset=".68" stopColor="var(--rp-glass-clear)" />
          <stop offset="1" stopColor="var(--rp-glass-ember)" />
        </linearGradient>
        <radialGradient ref={lightRef} id={`${id}-light`} gradientUnits="userSpaceOnUse" r="80">
          <stop stopColor="#fff9e9" stopOpacity=".84" />
          <stop offset=".39" stopColor="#ffcf85" stopOpacity=".48" />
          <stop offset="1" stopColor="#ff9b46" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x2=".9" y2="1">
          <stop stopColor="#fff7dc" />
          <stop offset=".22" stopColor="#ffad45" />
          <stop offset=".5" stopColor="#ffe6b1" />
          <stop offset=".78" stopColor="#fa612c" />
          <stop offset="1" stopColor="#ffa02e" />
        </linearGradient>
      </defs>
      <use href={`#${id}`} className="rp-guide-liquid-halo" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="7" />
      <use href={`#${id}`} fill={`url(#${id}-glass)`} stroke={`url(#${id}-rim)`} strokeWidth="1.6" />
      <use
        href={`#${id}`}
        fill={`url(#${id}-light)`}
        fillOpacity=".28"
        stroke={`url(#${id}-light)`}
        strokeWidth="2.5"
      />
    </svg>
  );
}
