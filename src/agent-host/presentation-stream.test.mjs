import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
const { partialSlide } = await importTestBundle("presentation-stream", {
  stdin: {
    contents: 'export { partialSlide } from "./presentation-stream.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});
const a = {
  kind: "text",
  text: 'quoted " and } ] \\ characters',
  x: 30,
  y: 30,
  w: 300,
  h: 100,
  size: 30,
  color: "#123456",
  bold: true,
  align: "left",
};
const b = {
  kind: "chart",
  x: 40,
  y: 150,
  w: 400,
  h: 300,
  name: "Sales",
  fill: "#123456",
  items: [{ label: "A", value: 2 }],
};
const prefix = '{"title":"Test","background":"#FFFFFF","elements":[';
test("streaming retains complete elements, handles escapes and nested chart arrays", () => {
  const json = prefix + JSON.stringify(a) + "," + JSON.stringify(b) + "]}";
  const firstEnd = prefix.length + JSON.stringify(a).length;
  for (let i = 0; i < firstEnd; i++) assert.equal(partialSlide(json.slice(0, i)), null);
  for (let i = firstEnd; i < json.length - 2; i++) assert.deepEqual(partialSlide(json.slice(0, i)).elements, [a]);
  assert.deepEqual(partialSlide(json).elements, [a, b]);
  assert.equal(partialSlide(prefix + '{"kind":"script"}'), null);
  assert.equal(partialSlide(prefix + JSON.stringify({ ...a, extra: "unsupported" })), null);
});
