export interface ElasticPanelResizeOptions {
  height?: number | string;
  reducedMotion?: boolean;
}

export interface ElasticPanelResizeInstance {
  update(options?: ElasticPanelResizeOptions): void;
  destroy(): void;
}

export interface ElasticRange {
  min: number;
  max: number;
  initial: number;
}

export interface ElasticDividerUpdate {
  reducedMotion?: boolean;
  position?: number;
  label?: string;
}

export interface ElasticDividerOptions extends ElasticDividerUpdate {
  reference: HTMLElement;
  panel: HTMLElement;
  anchored?: boolean;
  restingThickness?: number;
  side?: "left" | "right";
  getRange(width: number): ElasticRange;
  getValue?(
    position: number,
    width: number,
    range: ElasticRange,
  ): {
    min: number;
    max: number;
    now: number;
    text?: string;
  };
  onPosition(position: number, width: number): void;
  onCommit?(position: number, width: number): void;
  onDragChange?(dragging: boolean): void;
}

export function mountElasticDivider(
  host: HTMLElement,
  options: ElasticDividerOptions,
): {
  update(options?: ElasticDividerUpdate): void;
  destroy(): void;
};

export function mountElasticPanelResize(
  host: HTMLElement,
  options?: ElasticPanelResizeOptions,
): ElasticPanelResizeInstance;
