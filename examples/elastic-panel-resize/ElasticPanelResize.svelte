<script lang="ts">
  import { onMount } from "svelte";
  import { createElasticPanelRuntime } from "../../src/renderer/components/elastic-panel-resize/motion-runtime";
  import type { ElasticPanelResizeOptions } from "../../src/renderer/components/elastic-panel-resize/ElasticPanelResizeEngine.js";

  let { height, reducedMotion }: ElasticPanelResizeOptions = $props();
  let host: HTMLDivElement;
  const runtime = createElasticPanelRuntime();

  $effect(() => runtime.update({ height, reducedMotion }));
  onMount(() => {
    runtime.update({ height, reducedMotion });
    runtime.mount(host);
    return runtime.destroy;
  });
</script>

<div bind:this={host}></div>
