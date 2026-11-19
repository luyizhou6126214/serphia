/** @jsxImportSource solid-js */
import { onMount, onCleanup, createEffect } from "solid-js";
import { mountDeepAgentComposer, type DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";
import type { MotionController } from "./motion-runtime";

export function DeepAgentComposer(props: { options?: DeepAgentComposerOptions; class?: string }) {
  let host!: HTMLDivElement;
  let controller: MotionController | undefined;
  onMount(() => {
    controller = mountDeepAgentComposer(host, props.options);
  });
  createEffect(() => {
    const options = props.options;
    controller?.update(options ?? {});
  });
  onCleanup(() => controller?.destroy());
  return <div ref={host} class={props.class} data-motion-component="deep-agent-composer" />;
}
