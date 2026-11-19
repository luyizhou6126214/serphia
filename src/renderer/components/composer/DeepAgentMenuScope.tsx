import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { createDeepAgentMenuScope } from "../../../../examples/deep-agent-composer/DeepAgentComposerEngine.js";

type MenuScope = ReturnType<typeof createDeepAgentMenuScope>;

export function DeepAgentMenuScope({ children }: { children: (parts: MenuScope["parts"]) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<MenuScope | null>(null);

  useLayoutEffect(() => {
    const target = host.current;
    if (!target?.ownerDocument?.defaultView) return;
    let instance: MenuScope | undefined;
    let disposed = false;
    void import("../../../../examples/deep-agent-composer/DeepAgentComposerEngine.js").then(
      ({ createDeepAgentMenuScope }) => {
        if (disposed) return;
        instance = createDeepAgentMenuScope(target);
        setScope(instance);
      },
    );
    return () => {
      disposed = true;
      instance?.destroy();
    };
  }, []);

  return (
    <div ref={host} className="composer-deep-agent-control">
      {scope && createPortal(children(scope.parts), scope.mountPoint)}
    </div>
  );
}
