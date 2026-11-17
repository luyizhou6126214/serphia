import { SLIDE_HEIGHT, SLIDE_WIDTH, type PresentationElement } from "../contract/presentations";

export const PRESENTATION_FONT = "Microsoft YaHei";

export function fitSlideElement<T extends Pick<PresentationElement, "x" | "y" | "w" | "h">>(element: T): T {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  const x = clamp(element.x, 0, SLIDE_WIDTH - 24);
  const y = clamp(element.y, 0, SLIDE_HEIGHT - 24);
  return { ...element, x, y, w: clamp(element.w, 24, SLIDE_WIDTH - x), h: clamp(element.h, 24, SLIDE_HEIGHT - y) };
}

export function chartMaximum(items: readonly { value: number }[]): number {
  return Math.max(1, ...items.map(({ value }) => value)) * 1.2;
}
