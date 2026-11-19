/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";
import { mountDeepAgentComposer, type DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";
import type { MotionController } from "./motion-runtime";

export function DeepAgentComposer({ options, className }: { options?: DeepAgentComposerOptions; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<MotionController | null>(null);
  useEffect(() => {
    const instance = mountDeepAgentComposer(host.current!, options);
    controller.current = instance;
    return () => {
      instance.destroy();
      controller.current = null;
    };
    // Options are updated below without remounting the state machine.
  }, []);
  useEffect(() => {
    controller.current?.update(options ?? {});
  }, [options]);
  return <div ref={host} className={className} data-motion-component="deep-agent-composer" />;
}
