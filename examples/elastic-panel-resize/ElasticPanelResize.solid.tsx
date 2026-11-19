import { createEffect, onCleanup, onMount } from "solid-js";
import { createElasticPanelRuntime } from "../../src/renderer/components/elastic-panel-resize/motion-runtime";
import type { ElasticPanelResizeOptions } from "../../src/renderer/components/elastic-panel-resize/ElasticPanelResizeEngine.js";

export function ElasticPanelResize(props: ElasticPanelResizeOptions) {
  let host!: HTMLDivElement;
  const runtime = createElasticPanelRuntime();

  onMount(() => {
    runtime.update({ height: props.height, reducedMotion: props.reducedMotion });
    runtime.mount(host);
  });
  createEffect(() => runtime.update({ height: props.height, reducedMotion: props.reducedMotion }));
  onCleanup(runtime.destroy);

  return <div ref={host} />;
}
