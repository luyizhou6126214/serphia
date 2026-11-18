import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Layers, Radio, RotateCcw } from "lucide-react";
import type { Slide } from "@contract/presentations";
import { useI18n } from "@/i18n";
import { SlideCanvas } from "./SlideCanvas";

gsap.registerPlugin(useGSAP);

export function PresentationLiveCanvas({ slide, running }: { slide: Slide; running: boolean }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const count = cursor === null ? slide.elements.length : Math.min(cursor, slide.elements.length);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const elements = root.current?.querySelectorAll(".ppt-slide-element");
        const targets = elements ? Array.from(elements).slice(previous.current <= count ? previous.current : 0) : [];
        if (targets.length) gsap.from(targets, { opacity: 0, y: 9, duration: 0.4, stagger: 0.035, ease: "power2.out" });
      });
      previous.current = count;
      return () => media.revert();
    },
    { scope: root, dependencies: [count], revertOnUpdate: true },
  );
  return (
    <div className="ppt-live-canvas" ref={root}>
      <div className="ppt-live-heading">
        <span>
          <Radio size={14} />
          {running ? t("pptLiveRender", "Live rendering") : t("pptNativeCanvas", "Native slide canvas")}
        </span>
        <span>
          {count} / {slide.elements.length} {t("pptObjects", "objects")}
        </span>
      </div>
      <div className="ppt-paper">
        <SlideCanvas slide={{ ...slide, elements: slide.elements.slice(0, count) }} />
        {slide.elements.length === 0 && (
          <div className="ppt-render-placeholder">
            <Layers size={30} />
            <strong>{slide.title}</strong>
            <p>{t("pptWaitingElements", "Elements appear as the designer builds this page.")}</p>
            <div className="ppt-skeleton-lines">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
      <div className="ppt-render-controls">
        <button
          className="ppt-icon"
          type="button"
          aria-label={t("pptReplay", "Review construction")}
          title={t("pptReplay", "Review construction")}
          disabled={!slide.elements.length}
          onClick={() => setCursor(0)}
        >
          <RotateCcw size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={slide.elements.length || 1}
          value={count}
          disabled={!slide.elements.length}
          aria-label={t("pptRenderPosition", "Visible elements")}
          onChange={(event) => setCursor(Number(event.target.value))}
        />
        <button type="button" className="ppt-button" aria-pressed={cursor === null} onClick={() => setCursor(null)}>
          {t("pptFollowLive", "Follow live")}
        </button>
      </div>
    </div>
  );
}
