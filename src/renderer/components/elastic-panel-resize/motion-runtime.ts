import {
  mountElasticPanelResize,
  type ElasticPanelResizeInstance,
  type ElasticPanelResizeOptions,
} from "./ElasticPanelResizeEngine.js";

export function createElasticPanelRuntime(): ElasticPanelResizeInstance & {
  mount(host: HTMLElement): void;
} {
  let instance: ElasticPanelResizeInstance | undefined;
  let options: ElasticPanelResizeOptions = {};

  return {
    mount(host) {
      instance?.destroy();
      instance = mountElasticPanelResize(host, options);
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
