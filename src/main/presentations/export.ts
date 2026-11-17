import PptxGenJS from "pptxgenjs";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Presentation } from "../../contract/presentations";
import { chartMaximum, PRESENTATION_FONT } from "../../shared/presentation-model";

const inch = (pixels: number) => pixels / 96;
const hex = (color: string) => color.slice(1);
const xmlText = (text: string) =>
  text.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "");

export async function renderPptx(deck: Presentation): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SERPHIA_WIDE", width: inch(SLIDE_WIDTH), height: inch(SLIDE_HEIGHT) });
  pptx.layout = "SERPHIA_WIDE";
  pptx.title = xmlText(deck.title);
  pptx.author = "Serphia";
  pptx.theme = { headFontFace: PRESENTATION_FONT, bodyFontFace: PRESENTATION_FONT };
  for (const page of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(page.background) };
    for (const element of page.elements) {
      const bounds = { x: inch(element.x), y: inch(element.y), w: inch(element.w), h: inch(element.h) };
      if (element.kind === "text") {
        slide.addText(xmlText(element.text), {
          ...bounds,
          fontFace: PRESENTATION_FONT,
          fontSize: element.size * 0.75,
          color: hex(element.color),
          bold: element.bold,
          align: element.align,
          valign: "top",
          margin: 0,
          lineSpacingMultiple: 1.18,
          wrap: true,
        });
      } else if (element.kind === "image") {
        slide.addImage({ ...bounds, data: element.data, altText: xmlText(element.alt) });
      } else if (element.kind === "chart") {
        slide.addChart(
          pptx.ChartType.bar,
          [
            {
              name: xmlText(element.name),
              labels: element.items.map(({ label }) => xmlText(label)).reverse(),
              values: element.items.map(({ value }) => value).reverse(),
            },
          ],
          {
            ...bounds,
            barDir: "bar",
            chartColors: [hex(element.fill)],
            catAxisLabelFontFace: PRESENTATION_FONT,
            catAxisLabelFontSize: 10,
            valAxisMinVal: 0,
            valAxisMaxVal: chartMaximum(element.items),
            valAxisLabelFontSize: 9,
            showValue: true,
            dataLabelPosition: "outEnd",
            dataLabelFormatCode: "General",
            showLegend: false,
          },
        );
      } else {
        const fill = hex(element.fill);
        slide.addShape(element.kind === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, {
          ...bounds,
          fill: { color: fill },
          line: { transparency: 100 },
        });
      }
    }
  }
  return Buffer.from((await pptx.write({ outputType: "nodebuffer", compression: true })) as Uint8Array);
}
