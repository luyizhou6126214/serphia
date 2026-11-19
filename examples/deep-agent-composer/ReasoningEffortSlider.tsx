"use client";

import { mountReasoningEffortSlider, type ReasoningEffortSliderOptions } from "./DeepAgentComposerEngine.js";
import { useMotionInstance } from "./motion-runtime";

export type { ReasoningEffortSliderOptions } from "./DeepAgentComposerEngine.js";

export function ReasoningEffortSlider({
  options,
  className,
}: {
  options?: ReasoningEffortSliderOptions;
  className?: string;
}) {
  const host = useMotionInstance(mountReasoningEffortSlider, options);
  return <div ref={host} className={className} data-motion-component="reasoning-effort-slider" />;
}
