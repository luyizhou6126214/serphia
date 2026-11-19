export interface PixelToggleOptions {
  /** True selects day. An omitted value leaves the selection to the switch. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  sound?: boolean;
  height?: number | string;
  reducedMotion?: boolean;
  /** Fit toolbar-sized hosts and composite over the host background. */
  embedded?: boolean;
  label?: string;
  onRendererChange?: (renderer: "webgl2" | "canvas2d" | "css") => void;
}

export interface PixelToggleInstance {
  update(options?: PixelToggleOptions): void;
  destroy(): void;
}

export function mountPixelToggle(host: HTMLElement, options?: PixelToggleOptions): PixelToggleInstance;
