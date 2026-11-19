import { createEffect, onCleanup, onMount } from "solid-js";
import { createPixelToggleRuntime } from "../../src/renderer/components/pixel-toggle/motion-runtime";
import type { PixelToggleOptions } from "../../src/renderer/components/pixel-toggle/PixelToggleEngine.js";

export function PixelToggle(props: PixelToggleOptions) {
  let host!: HTMLDivElement;
  const runtime = createPixelToggleRuntime();

  createEffect(() => runtime.update({ ...props }));
  onMount(() => {
    runtime.update({ ...props });
    runtime.mount(host);
  });
  onCleanup(runtime.destroy);

  return <div ref={host} />;
}
