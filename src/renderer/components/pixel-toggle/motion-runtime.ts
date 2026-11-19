import { mountPixelToggle, type PixelToggleInstance, type PixelToggleOptions } from "./PixelToggleEngine.js";

export function createPixelToggleRuntime(): PixelToggleInstance & { mount(host: HTMLElement): void } {
  let instance: PixelToggleInstance | undefined;
  let options: PixelToggleOptions = {};

  return {
    mount(host) {
      instance?.destroy();
      instance = mountPixelToggle(host, options);
    },
    update(next = {}) {
      options = next;
      instance?.update(options);
    },
    destroy() {
      instance?.destroy();
      instance = undefined;
    },
  };
}
