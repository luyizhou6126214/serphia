import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { createElasticPanelRuntime } from "../../src/renderer/components/elastic-panel-resize/motion-runtime";
import type { ElasticPanelResizeOptions } from "../../src/renderer/components/elastic-panel-resize/ElasticPanelResizeEngine.js";

export function ElasticPanelResize({ height, reducedMotion }: ElasticPanelResizeOptions = {}) {
  const host = useRef<HTMLDivElement>(null);
  const [runtime] = useState(createElasticPanelRuntime);

  useEffect(() => {
    runtime.update({ height, reducedMotion });
  }, [runtime, height, reducedMotion]);

  useEffect(() => {
    if (host.current) runtime.mount(host.current);
    return runtime.destroy;
  }, [runtime]);

  return h("div", { ref: host });
}
