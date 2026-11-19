<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { createPixelToggleRuntime } from "../../src/renderer/components/pixel-toggle/motion-runtime";
import type { PixelToggleOptions } from "../../src/renderer/components/pixel-toggle/PixelToggleEngine.js";

const props = withDefaults(defineProps<PixelToggleOptions>(), {
  checked: undefined,
  sound: undefined,
  reducedMotion: undefined,
  embedded: undefined,
});
const host = ref<HTMLDivElement>();
const runtime = createPixelToggleRuntime();

watchEffect(() => runtime.update({ ...props }));
onMounted(() => {
  if (host.value) runtime.mount(host.value);
});
onBeforeUnmount(runtime.destroy);
</script>

<template><div ref="host"></div></template>
