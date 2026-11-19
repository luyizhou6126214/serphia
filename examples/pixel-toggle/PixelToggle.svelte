<script lang="ts">
  import { onMount } from "svelte";
  import { createPixelToggleRuntime } from "../../src/renderer/components/pixel-toggle/motion-runtime";
  import type { PixelToggleOptions } from "../../src/renderer/components/pixel-toggle/PixelToggleEngine.js";

  const props: PixelToggleOptions = $props();
  let host: HTMLDivElement;
  const runtime = createPixelToggleRuntime();

  $effect(() => runtime.update({ ...props }));
  onMount(() => {
    runtime.update({ ...props });
    runtime.mount(host);
    return runtime.destroy;
  });
</script>

<div bind:this={host}></div>
