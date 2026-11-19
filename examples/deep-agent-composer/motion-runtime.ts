import { useEffect, useRef } from "react";

export interface MotionOptions {
  height?: number;
  reducedMotion?: boolean;
}

export interface MotionController<Options extends MotionOptions = MotionOptions> {
  element: HTMLElement;
  root: ShadowRoot;
  update(options: Options): void;
  destroy(): void;
}

export function useMotionInstance<Options extends MotionOptions>(
  mount: (target: HTMLElement, options?: Options) => MotionController<Options>,
  options: Options | undefined,
) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<MotionController<Options> | null>(null);
  const latestOptions = useRef(options);
  useEffect(() => {
    latestOptions.current = options;
    instance.current?.update(options ?? ({} as Options));
  }, [options]);
  useEffect(() => {
    if (!host.current) return;
    const controller = mount(host.current, latestOptions.current);
    instance.current = controller;
    return () => {
      instance.current = null;
      controller.destroy();
    };
  }, [mount]);
  return host;
}
