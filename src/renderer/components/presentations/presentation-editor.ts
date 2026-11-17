import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type AgentSlide,
  type Presentation,
  type PresentationElement,
  type Slide,
} from "@contract/presentations";
import { fitSlideElement } from "@shared/presentation-model";

export type SlideLayout = "blank" | "cover" | "content" | "data" | "closing";
export type ElementPatch = Partial<Omit<PresentationElement, "kind" | "id">> & Record<string, unknown>;

export function createDeck(title: string, slides: Slide[]): Presentation {
  return { version: 1, id: crypto.randomUUID(), title, slides };
}

export function fromAgentSlide(slide: AgentSlide): Slide {
  return {
    ...slide,
    id: crypto.randomUUID(),
    elements: slide.elements.map((element) => ({ ...element, id: crypto.randomUUID() })),
  };
}

export function createElement(kind: Exclude<PresentationElement["kind"], "image">, label: string): PresentationElement {
  const base = { id: crypto.randomUUID(), x: 100, y: 100, w: 400, h: 140 };
  if (kind === "text") return { ...base, kind, text: label, size: 38, color: "#22304B", bold: false, align: "left" };
  if (kind === "chart")
    return {
      ...base,
      kind,
      w: 800,
      h: 330,
      name: label,
      fill: "#3D62AD",
      items: ["A", "B", "C"].map((item, index) => ({ label: item, value: (index + 1) * 10 })),
    };
  return { ...base, kind, w: 240, fill: "#3D62AD" };
}

export function createSlide(layout: SlideLayout, title: string, body: string): Slide {
  const slide: Slide = { id: crypto.randomUUID(), title, background: "#FFFFFF", elements: [] };
  if (layout === "blank") return slide;
  const useDark = layout === "cover" || layout === "closing";
  if (useDark) slide.background = "#152439";
  const heading = createElement("text", title) as Extract<PresentationElement, { kind: "text" }>;
  slide.elements = [
    { id: crypto.randomUUID(), kind: "rect", x: 84, y: useDark ? 180 : 55, w: 64, h: 24, fill: "#6486CF" },
    {
      ...heading,
      x: 84,
      y: useDark ? 244 : 110,
      w: 1110,
      h: 150,
      size: useDark ? 76 : 56,
      bold: true,
      color: useDark ? "#FFFFFF" : "#22304B",
    },
    layout === "data"
      ? { ...createElement("chart", body), x: 84, y: 266, w: 1110, h: 400 }
      : {
          ...heading,
          id: crypto.randomUUID(),
          x: 84,
          y: useDark ? 416 : 290,
          w: 1020,
          h: 180,
          size: 36,
          color: useDark ? "#CFD9EB" : "#4C5C75",
        },
  ];
  const last = slide.elements[2];
  if (last.kind === "text") last.text = body;
  return slide;
}

export function copySlide(slide: Slide): Slide {
  return {
    ...slide,
    id: crypto.randomUUID(),
    elements: slide.elements.map((element) => ({ ...element, id: crypto.randomUUID() })),
  };
}

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length || index >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function updateElement<T extends PresentationElement>(element: T, patch: ElementPatch): T {
  return fitSlideElement({ ...element, ...patch });
}

export function moveElement<T extends PresentationElement>(element: T, dx: number, dy: number): T {
  return {
    ...element,
    x: Math.round(Math.min(SLIDE_WIDTH - element.w, Math.max(0, element.x + dx))),
    y: Math.round(Math.min(SLIDE_HEIGHT - element.h, Math.max(0, element.y + dy))),
  };
}
