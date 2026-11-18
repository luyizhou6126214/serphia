import { Check } from "typebox/value";
import { agentSlideSchema, type AgentSlide } from "../contract/presentations";
import { fitSlideElement } from "../shared/presentation-model";

/** Decode only complete objects from a streamed JSON elements array. Never repair incomplete strings. */
export function partialSlide(text: string): AgentSlide | null {
  const start = text.indexOf("{");
  const array = /"elements"\s*:\s*\[/u.exec(text);
  if (start < 0 || !array) return null;
  const end = array.index + array[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let complete = -1;
  for (let i = end; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) complete = i + 1;
    } else if (char === "]" && depth === 0) break;
  }
  if (complete < 0) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, complete) + "]}");
    if (!Check(agentSlideSchema, value)) return null;
    const slide = value as AgentSlide;
    return { ...slide, elements: slide.elements.map(fitSlideElement) };
  } catch {
    return null;
  }
}
