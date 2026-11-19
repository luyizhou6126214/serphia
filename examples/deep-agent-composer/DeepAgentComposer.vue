<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { mountDeepAgentComposer, type DeepAgentComposerOptions } from "./DeepAgentComposerEngine.js";
import type { MotionController } from "./motion-runtime";
const props = defineProps<{ options?: DeepAgentComposerOptions }>();
const host = ref<HTMLDivElement | null>(null);
let controller: MotionController | undefined;
onMounted(() => {
  controller = mountDeepAgentComposer(host.value!, props.options);
});
watch(
  () => props.options,
  (value) => controller?.update(value ?? {}),
  { deep: true },
);
onBeforeUnmount(() => controller?.destroy());
</script>

<template><div ref="host" data-motion-component="deep-agent-composer" /></template>
