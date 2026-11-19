"use client";

import { mountDeepAgentComposer, type DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";
import { useMotionInstance } from "./motion-runtime";

export type { DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";

export function DeepAgentComposer({ options, className }: { options?: DeepAgentComposerOptions; className?: string }) {
  const host = useMotionInstance(mountDeepAgentComposer, options);
  return <div ref={host} className={className} data-motion-component="deep-agent-composer" />;
}
