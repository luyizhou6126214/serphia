<script lang="ts">
import { onMount } from "svelte";
import { mountDeepAgentComposer, type DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";
import type { MotionController } from "./motion-runtime";
export let options: DeepAgentComposerOptions = {};
let host: HTMLDivElement;
let controller: MotionController | undefined;
onMount(() => {
  const instance = mountDeepAgentComposer(host, options);
  controller = instance;
  return () => { instance.destroy(); controller = undefined; };
});
$: controller?.update(options);
</script>

<div bind:this={host} data-motion-component="deep-agent-composer"></div>
