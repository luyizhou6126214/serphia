import { useEffect, useRef, useState } from "react";
import { createElasticPanelRuntime } from "./motion-runtime";
import type { ElasticPanelResizeOptions } from "./ElasticPanelResizeEngine.js";

export function ElasticPanelResize({ height, reducedMotion }: ElasticPanelResizeOptions = {}) {
  const host = useRef<HTMLDivElement>(null);
  const [runtime] = useState(createElasticPanelRuntime);

  useEffect(() => {
    runtime.update({ height, reducedMotion });
  }, [runtime, height, reducedMotion]);

  useEffect(() => {
    if (host.current) runtime.mount(host.current);
    return () => runtime.destroy();
  }, [runtime]);

  return <div ref={host} />;
}
