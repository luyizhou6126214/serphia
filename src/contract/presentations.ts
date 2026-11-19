import { Type, type Static } from "typebox";

export const PRESENTATION_WORKFLOW_SKILL = "ppt-master";
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
export const MAX_SLIDES = 40;
export const MAX_ELEMENTS = 40;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DECK_IMAGE_DATA = 24 * 1024 * 1024;
export const MAX_SOURCE_LENGTH = 16_000;

const closed = { additionalProperties: false } as const;
export const presentationIdPattern = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
const id = Type.String({ pattern: presentationIdPattern });
const color = Type.String({ pattern: "^#[a-fA-F0-9]{6}$" });
const name = Type.String({ minLength: 1, maxLength: 120 });
const geometry = {
  x: Type.Integer({ minimum: 0, maximum: SLIDE_WIDTH - 24 }),
  y: Type.Integer({ minimum: 0, maximum: SLIDE_HEIGHT - 24 }),
  w: Type.Integer({ minimum: 24, maximum: SLIDE_WIDTH }),
  h: Type.Integer({ minimum: 24, maximum: SLIDE_HEIGHT }),
};

const textFields = {
  kind: Type.Literal("text"),
  text: Type.String({ maxLength: 1600 }),
  size: Type.Integer({ minimum: 12, maximum: 128 }),
  color,
  bold: Type.Boolean(),
  align: Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")]),
};
const shapeFields = {
  kind: Type.Union([Type.Literal("rect"), Type.Literal("ellipse")]),
  fill: color,
};
const chartFields = {
  kind: Type.Literal("chart"),
  name,
  fill: color,
  items: Type.Array(
    Type.Object(
      { label: Type.String({ minLength: 1, maxLength: 48 }), value: Type.Number({ minimum: 0, maximum: 1e12 }) },
      closed,
    ),
    { minItems: 1, maxItems: 8 },
  ),
};
const imageFields = {
  kind: Type.Literal("image"),
  data: Type.String({
    pattern: "^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$",
    maxLength: Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32,
  }),
  alt: Type.String({ maxLength: 120 }),
};

export const agentElementSchema = Type.Union([
  Type.Object({ ...geometry, ...textFields }, closed),
  Type.Object({ ...geometry, ...shapeFields }, closed),
  Type.Object({ ...geometry, ...chartFields }, closed),
]);
const slideElementSchema = Type.Union([
  Type.Object({ id, ...geometry, ...textFields }, closed),
  Type.Object({ id, ...geometry, ...shapeFields }, closed),
  Type.Object({ id, ...geometry, ...chartFields }, closed),
  Type.Object({ id, ...geometry, ...imageFields }, closed),
]);
const slideSchema = Type.Object(
  {
    id,
    title: name,
    background: color,
    elements: Type.Array(slideElementSchema, { maxItems: MAX_ELEMENTS }),
  },
  closed,
);
export const deckSchema = Type.Object(
  {
    version: Type.Literal(1),
    id,
    title: name,
    slides: Type.Array(slideSchema, { minItems: 1, maxItems: MAX_SLIDES }),
  },
  closed,
);
export const outlinePageSchema = Type.Object(
  {
    title: name,
    summary: name,
    layout: Type.Union([Type.Literal("cover"), Type.Literal("content"), Type.Literal("data"), Type.Literal("closing")]),
  },
  closed,
);
export const outlineSchema = Type.Object(
  {
    title: name,
    accent: color,
    pages: Type.Array(outlinePageSchema, { minItems: 1, maxItems: 12 }),
  },
  closed,
);
export const agentSlideSchema = Type.Object(
  {
    title: name,
    background: color,
    elements: Type.Array(agentElementSchema, { minItems: 1, maxItems: 18 }),
  },
  closed,
);
const requestFields = {
  id,
  cwd: Type.Union([Type.String({ minLength: 1, maxLength: 32767 }), Type.Null()]),
  language: Type.Union([Type.Literal("en-US"), Type.Literal("zh-CN"), Type.Literal("zh-TW")]),
  prompt: Type.String({ minLength: 1, maxLength: 2000 }),
  source: Type.String({ maxLength: MAX_SOURCE_LENGTH }),
};
export const outlineRequestSchema = Type.Object(
  {
    ...requestFields,
    count: Type.Integer({ minimum: 1, maximum: 12 }),
  },
  closed,
);
export const pageRequestSchema = Type.Object(
  {
    ...requestFields,
    outline: outlineSchema,
    index: Type.Integer({ minimum: 0, maximum: 11 }),
  },
  closed,
);

export type PresentationElement = Static<typeof slideElementSchema>;
export type Slide = Static<typeof slideSchema>;
export type Presentation = Static<typeof deckSchema>;
export type Outline = Static<typeof outlineSchema>;
export type AgentSlide = Static<typeof agentSlideSchema>;
export type OutlineRequest = Static<typeof outlineRequestSchema>;
export type PageRequest = Static<typeof pageRequestSchema>;
export type SavedPresentation = { revision: number; deck: Presentation };
export type PresentationSummary = { id: string; title: string; updatedAt: number };

/** Public execution receipts only; provider-private reasoning is never forwarded. */
export type PresentationEvent = {
  runId: string;
  at: number;
  index: number | null;
  type: "started" | "summary" | "tool_start" | "tool_end" | "render" | "complete" | "error";
  message?: string;
  tool?: string;
  callId?: string;
  detail?: string;
  slide?: AgentSlide;
};

export type PresentationWorkflow = {
  sessionId: string;
  cwd: string;
  directory: string;
};
export type PresentationFile = { name: string; path: string; updatedAt: number };
export type PresentationArtifactSnapshot = {
  exports: PresentationFile[];
  confirmationPort?: number;
  designConfirmed?: boolean;
};
