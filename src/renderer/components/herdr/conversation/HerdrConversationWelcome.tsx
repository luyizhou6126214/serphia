import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { HerdrAgentKindDisplay } from "@contract/herdr";
import { useI18n } from "@/i18n";
import { HerdrAgentIcon } from "../HerdrAgentIcon";

gsap.registerPlugin(useGSAP);

export function HerdrConversationWelcome({ kind, name }: { kind: HerdrAgentKindDisplay; name: string }) {
  const { t } = useI18n();
  const mark = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const element = mark.current;
      if (!element) return;

      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(element, { y: 8, scale: 0.82, opacity: 0.25, duration: 0.55, ease: "back.out(1.5)" });
      });
      return () => motion.revert();
    },
    { scope: mark },
  );

  return (
    <div className="hd-first-message">
      <div className="hd-welcome-mark" ref={mark} aria-hidden="true">
        <HerdrAgentIcon kind={kind} size={34} />
      </div>
      <h2>{t("hdTalkTo", "Message {agent}").replace("{agent}", () => name)}</h2>
    </div>
  );
}
