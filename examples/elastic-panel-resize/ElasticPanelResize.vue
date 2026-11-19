<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { createElasticPanelRuntime } from "../../src/renderer/components/elastic-panel-resize/motion-runtime";

const props = defineProps({
  height: [String, Number],
  reducedMotion: { type: Boolean, default: undefined },
});
const host = ref<HTMLDivElement>();
const runtime = createElasticPanelRuntime();

watchEffect(() => runtime.update({ height: props.height, reducedMotion: props.reducedMotion }));
onMounted(() => {
  if (host.value) runtime.mount(host.value);
});
onBeforeUnmount(runtime.destroy);
</script>

<template><div ref="host"></div></template>
