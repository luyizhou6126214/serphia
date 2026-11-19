import { h } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { createPixelToggleRuntime } from "../../src/renderer/components/pixel-toggle/motion-runtime";
import type { PixelToggleOptions } from "../../src/renderer/components/pixel-toggle/PixelToggleEngine.js";

export function PixelToggle({
  checked,
  onCheckedChange,
  height,
  sound,
  reducedMotion,
  embedded,
  label,
  onRendererChange,
}: PixelToggleOptions = {}) {
  const host = useRef<HTMLDivElement>(null);
  const [runtime] = useState(createPixelToggleRuntime);

  useLayoutEffect(() => {
    runtime.update({ checked, onCheckedChange, height, sound, reducedMotion, embedded, label, onRendererChange });
  }, [runtime, checked, onCheckedChange, height, sound, reducedMotion, embedded, label, onRendererChange]);
  useLayoutEffect(() => {
    if (host.current) runtime.mount(host.current);
    return runtime.destroy;
  }, [runtime]);

  return h("div", { ref: host });
}
