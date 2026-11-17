import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type PresentationElement, type Slide } from "@contract/presentations";
import { chartMaximum } from "@shared/presentation-model";
import { useI18n } from "@/i18n";
import { moveElement, updateElement } from "./presentation-editor";

type Edit = {
  selected: string | null;
  select: (id: string | null) => void;
  change: (element: PresentationElement) => void;
  remove: () => void;
};

function textStyle(element: Extract<PresentationElement, { kind: "text" }>): CSSProperties {
  return {
    color: element.color,
    fontSize: `${(element.size * 100) / SLIDE_WIDTH}cqw`,
    fontWeight: element.bold ? 700 : 400,
    textAlign: element.align,
  };
}

function ElementContent({ element }: { element: PresentationElement }) {
  switch (element.kind) {
    case "text":
      return (
        <div className="ppt-slide-text" style={textStyle(element)}>
          {element.text}
        </div>
      );
    case "image":
      return <img className="ppt-slide-image" src={element.data} alt={element.alt} draggable={false} />;
    case "chart": {
      const maximum = chartMaximum(element.items);
      return (
        <div
          className="ppt-slide-chart"
          role="img"
          aria-label={element.name}
          style={{ "--chart-fill": element.fill } as CSSProperties}
        >
          {element.items.map((item, index) => (
            <div className="ppt-chart-bar" key={index}>
              <span>{item.label}</span>
              <div>
                <i style={{ width: `${(item.value / maximum) * 100}%` }} />
              </div>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      );
    }
    case "rect":
    case "ellipse":
      return (
        <div
          className="ppt-slide-shape"
          style={{ backgroundColor: element.fill, borderRadius: element.kind === "ellipse" ? "50%" : undefined }}
        />
      );
  }
}

function elementLabel(element: PresentationElement): string {
  switch (element.kind) {
    case "text":
      return element.text.slice(0, 100);
    case "chart":
      return element.name;
    case "image":
      return element.alt;
    default:
      return "";
  }
}

type Gesture = {
  source: PresentationElement;
  startX: number;
  startY: number;
  pointer: number;
  scale: number;
  resize: boolean;
  moved?: PresentationElement;
};

export function SlideCanvas({ slide, edit }: { slide: Slide; edit?: Edit }) {
  const { t } = useI18n();
  const paper = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [moving, setMoving] = useState<PresentationElement | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  function begin(event: PointerEvent<HTMLButtonElement>, source: PresentationElement, resize: boolean) {
    if (!edit || !paper.current || event.button !== 0 || gesture.current) return;
    edit.select(source.id);
    gesture.current = {
      source,
      startX: event.clientX,
      startY: event.clientY,
      pointer: event.pointerId,
      scale: SLIDE_WIDTH / paper.current.getBoundingClientRect().width,
      resize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = (event.clientX - active.startX) * active.scale;
    const dy = (event.clientY - active.startY) * active.scale;
    if (!active.moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
    const next = active.resize
      ? updateElement(active.source, { w: active.source.w + dx, h: active.source.h + dy })
      : moveElement(active.source, dx, dy);
    active.moved = next;
    setMoving(next);
  }

  function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    setMoving(null);
    if (commit && active.moved) edit?.change(active.moved);
  }

  return (
    <div
      className={`ppt-slide-canvas${edit ? " is-editable" : ""}`}
      ref={paper}
      style={{ backgroundColor: slide.background }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) edit?.select(null);
      }}
      onPointerMove={edit ? move : undefined}
      onPointerUp={edit ? (event) => finish(event, true) : undefined}
      onPointerCancel={edit ? (event) => finish(event, false) : undefined}
      onLostPointerCapture={edit ? (event) => finish(event, false) : undefined}
      aria-label={edit ? t("pptCanvas", "Slide canvas") : undefined}
      role={edit ? "group" : undefined}
    >
      {slide.elements.map((original) => {
        const element = moving?.id === original.id ? moving : original;
        const selected = edit?.selected === element.id;
        const label =
          elementLabel(element) ||
          (element.kind === "image"
            ? t("pptInsertImage", "Image")
            : element.kind === "ellipse"
              ? t("pptInsertEllipse", "Ellipse")
              : element.kind === "rect"
                ? t("pptInsertRect", "Rectangle")
                : t("pptInsertText", "Text"));
        return (
          <div
            key={element.id}
            className={`ppt-slide-element${selected ? " is-selected" : ""}`}
            style={{
              left: `${(element.x / SLIDE_WIDTH) * 100}%`,
              top: `${(element.y / SLIDE_HEIGHT) * 100}%`,
              width: `${(element.w / SLIDE_WIDTH) * 100}%`,
              height: `${(element.h / SLIDE_HEIGHT) * 100}%`,
            }}
          >
            {edit && element.kind === "text" && editingTextId === element.id ? (
              <textarea
                className="ppt-slide-text ppt-inline-text-editor"
                style={textStyle(element)}
                aria-label={t("pptInsertText", "Text")}
                defaultValue={element.text}
                maxLength={1600}
                autoFocus
                onBlur={(event) => {
                  setEditingTextId(null);
                  const text = event.currentTarget.value;
                  if (text !== element.text) edit.change({ ...element, text });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.value = element.text;
                    event.currentTarget.blur();
                  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <ElementContent element={element} />
            )}
            {edit && editingTextId !== element.id && (
              <button
                type="button"
                className="ppt-element-hit"
                aria-label={label}
                aria-pressed={selected}
                onClick={() => edit.select(element.id)}
                onPointerDown={(event) => begin(event, original, false)}
                onDoubleClick={element.kind === "text" ? () => setEditingTextId(element.id) : undefined}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 1;
                  const arrows: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0],
                    ArrowRight: [step, 0],
                    ArrowUp: [0, -step],
                    ArrowDown: [0, step],
                  };
                  if (event.key === "F2" && element.kind === "text") {
                    event.preventDefault();
                    edit.select(element.id);
                    setEditingTextId(element.id);
                  } else if (event.key === "Delete" && selected) {
                    event.preventDefault();
                    edit.remove();
                  } else if (arrows[event.key]) {
                    event.preventDefault();
                    edit.select(element.id);
                    edit.change(moveElement(original, ...arrows[event.key]));
                  }
                }}
              />
            )}
            {edit && selected && editingTextId !== element.id && (
              <button
                type="button"
                className="ppt-resize"
                aria-label={t("pptResize", "Drag to resize")}
                onPointerDown={(event) => begin(event, original, true)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
