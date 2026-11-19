import { useLayoutEffect, useRef, useState } from "react";
import { createPixelToggleRuntime } from "./motion-runtime";
import type { PixelToggleOptions } from "./PixelToggleEngine.js";

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

  return <div ref={host} />;
}
