import { useId } from "react";
import { ArrowDown, ArrowUp, AlignCenterHorizontal, AlignCenterVertical, Trash2, Plus } from "lucide-react";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type PresentationElement, type Slide } from "@contract/presentations";
import { useI18n } from "@/i18n";
import type { ElementPatch } from "./presentation-editor";

type Chart = Extract<PresentationElement, { kind: "chart" }>;
type Props = {
  slide: Slide;
  element: PresentationElement | undefined;
  patchSlide: (patch: Partial<Pick<Slide, "title" | "background">>) => void;
  patchElement: (patch: ElementPatch) => void;
  moveLayer: (delta: number) => void;
  remove: () => void;
  disabled: boolean;
};

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ppt-field">
      {label}
      <input
        key={value}
        aria-label={label}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        onBlur={(event) => {
          const number = event.currentTarget.valueAsNumber;
          const next = Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : value;
          event.currentTarget.value = String(next);
          if (next !== value) onChange(next);
        }}
      />
    </label>
  );
}

function ChartFields({ element, change }: { element: Chart; change: (patch: ElementPatch) => void }) {
  const { t } = useI18n();
  const replaceRow = (index: number, next: Chart["items"][number]) => {
    change({ items: element.items.map((item, row) => (row === index ? next : item)) });
  };
  return (
    <>
      <label className="ppt-field">
        {t("pptChartSeries", "Series")}
        <input
          key={element.name}
          maxLength={120}
          defaultValue={element.name}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim() || element.name;
            event.currentTarget.value = name;
            if (name !== element.name) change({ name });
          }}
        />
      </label>
      <div className="ppt-chart-data">
        {element.items.map((item, index) => (
          <div className="ppt-chart-data-row" key={index}>
            <input
              aria-label={`${t("pptChartLabel", "Category")} ${index + 1}`}
              key={`label-${item.label}`}
              maxLength={48}
              defaultValue={item.label}
              onBlur={(event) => {
                const label = event.currentTarget.value.trim() || item.label;
                event.currentTarget.value = label;
                if (label !== item.label) replaceRow(index, { ...item, label });
              }}
            />
            <input
              aria-label={`${t("pptChartValue", "Value")} ${index + 1}`}
              key={`value-${item.value}`}
              type="number"
              min={0}
              max={1e12}
              defaultValue={item.value}
              onBlur={(event) => {
                const number = event.currentTarget.valueAsNumber;
                const value = Number.isFinite(number) ? Math.max(0, Math.min(1e12, number)) : item.value;
                event.currentTarget.value = String(value);
                if (value !== item.value) replaceRow(index, { ...item, value });
              }}
            />
            <button
              type="button"
              className="ppt-icon"
              aria-label={`${t("pptRemove", "Remove")} ${index + 1}`}
              disabled={element.items.length === 1}
              onClick={() => change({ items: element.items.filter((_, row) => row !== index) })}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="ppt-button"
        disabled={element.items.length >= 8}
        onClick={() => change({ items: [...element.items, { label: String(element.items.length + 1), value: 0 }] })}
      >
        <Plus />
        {t("pptChartRow", "Add data row")}
      </button>
    </>
  );
}

export function PresentationInspector(props: Props) {
  const { t } = useI18n();
  const { slide, element, patchSlide, patchElement, moveLayer, remove, disabled } = props;
  const chartHeading = useId();
  if (!element) {
    return (
      <fieldset className="ppt-fields" disabled={disabled}>
        <label className="ppt-field">
          {t("pptSlideTitle", "Slide title")}
          <input
            key={slide.title}
            defaultValue={slide.title}
            maxLength={120}
            onBlur={(event) => {
              const title = event.currentTarget.value.trim() || slide.title;
              event.currentTarget.value = title;
              if (title !== slide.title) patchSlide({ title });
            }}
          />
        </label>
        <label className="ppt-field ppt-color-field">
          {t("pptBackground", "Slide background")}
          <input
            type="color"
            value={slide.background}
            onChange={(event) => patchSlide({ background: event.currentTarget.value })}
          />
        </label>
      </fieldset>
    );
  }
  const index = slide.elements.findIndex(({ id }) => id === element.id);
  return (
    <fieldset className="ppt-fields" disabled={disabled}>
      {element.kind === "text" && (
        <>
          <label className="ppt-field">
            {t("pptInsertText", "Text")}
            <textarea
              key={element.text}
              defaultValue={element.text}
              maxLength={1600}
              rows={4}
              onBlur={(event) => {
                if (element.text !== event.currentTarget.value) patchElement({ text: event.currentTarget.value });
              }}
            />
          </label>
          <div className="ppt-field-grid">
            <NumberField
              label={t("pptFontSize", "Font size")}
              value={element.size}
              min={12}
              max={128}
              onChange={(size) => patchElement({ size })}
            />
            <label className="ppt-field">
              {t("pptAlignment", "Alignment")}
              <select value={element.align} onChange={(event) => patchElement({ align: event.currentTarget.value })}>
                <option value="left">{t("pptLeft", "Left")}</option>
                <option value="center">{t("pptCenter", "Center")}</option>
                <option value="right">{t("pptRight", "Right")}</option>
              </select>
            </label>
          </div>
          <label className="ppt-field ppt-color-field">
            {t("pptTextColor", "Text color")}
            <input
              type="color"
              value={element.color}
              onChange={(event) => patchElement({ color: event.currentTarget.value })}
            />
          </label>
          <label className="ppt-check">
            <input
              type="checkbox"
              checked={element.bold}
              onChange={(event) => patchElement({ bold: event.currentTarget.checked })}
            />
            {t("pptBold", "Bold")}
          </label>
        </>
      )}
      {"fill" in element && (
        <label className="ppt-field ppt-color-field">
          {t("pptFill", "Fill")}
          <input
            type="color"
            value={element.fill}
            onChange={(event) => patchElement({ fill: event.currentTarget.value })}
          />
        </label>
      )}
      {element.kind === "chart" && (
        <div className="ppt-fields" role="group" aria-labelledby={chartHeading}>
          <span className="ppt-field-title" id={chartHeading}>
            {t("pptData", "Data")}
          </span>
          <ChartFields element={element} change={patchElement} />
        </div>
      )}
      {element.kind === "image" && (
        <label className="ppt-field">
          {t("pptImageAlt", "Image description")}
          <input
            key={element.alt}
            defaultValue={element.alt}
            maxLength={120}
            onBlur={(event) => {
              if (element.alt !== event.currentTarget.value) patchElement({ alt: event.currentTarget.value });
            }}
          />
        </label>
      )}
      <div className="ppt-field-grid">
        <NumberField
          label="X"
          value={element.x}
          min={0}
          max={SLIDE_WIDTH - element.w}
          onChange={(x) => patchElement({ x })}
        />
        <NumberField
          label="Y"
          value={element.y}
          min={0}
          max={SLIDE_HEIGHT - element.h}
          onChange={(y) => patchElement({ y })}
        />
        <NumberField
          label={t("pptWidth", "Width")}
          value={element.w}
          min={24}
          max={SLIDE_WIDTH - element.x}
          onChange={(w) => patchElement({ w })}
        />
        <NumberField
          label={t("pptHeight", "Height")}
          value={element.h}
          min={24}
          max={SLIDE_HEIGHT - element.y}
          onChange={(h) => patchElement({ h })}
        />
      </div>
      <div className="ppt-controls">
        <button
          type="button"
          className="ppt-icon"
          title={t("pptAlignHorizontal", "Center horizontally")}
          aria-label={t("pptAlignHorizontal", "Center horizontally")}
          onClick={() => patchElement({ x: (SLIDE_WIDTH - element.w) / 2 })}
        >
          <AlignCenterHorizontal />
        </button>
        <button
          type="button"
          className="ppt-icon"
          title={t("pptAlignVertical", "Center vertically")}
          aria-label={t("pptAlignVertical", "Center vertically")}
          onClick={() => patchElement({ y: (SLIDE_HEIGHT - element.h) / 2 })}
        >
          <AlignCenterVertical />
        </button>
        <button
          type="button"
          className="ppt-icon"
          title={t("pptFront", "Bring forward")}
          aria-label={t("pptFront", "Bring forward")}
          disabled={index === slide.elements.length - 1}
          onClick={() => moveLayer(1)}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          className="ppt-icon"
          title={t("pptBack", "Send backward")}
          aria-label={t("pptBack", "Send backward")}
          disabled={index === 0}
          onClick={() => moveLayer(-1)}
        >
          <ArrowDown />
        </button>
        <button
          type="button"
          className="ppt-icon ppt-delete"
          title={t("pptRemove", "Remove")}
          aria-label={t("pptRemove", "Remove")}
          onClick={remove}
        >
          <Trash2 />
        </button>
      </div>
    </fieldset>
  );
}
