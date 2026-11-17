import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import yauzl from "yauzl";
import { importTestBundle } from "#test-bundle";

const { PresentationStore, renderPptx, createPresentationSaveQueue } = await importTestBundle("presentations", {
  packages: "external",
  stdin: {
    contents: [
      'export { PresentationStore } from "./store.ts";',
      'export { renderPptx } from "./export.ts";',
      'export { createPresentationSaveQueue } from "../../renderer/components/presentations/presentation-save-queue.ts";',
    ].join("\n"),
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

function fixture() {
  const bounds = { x: 64, y: 72, w: 440, h: 175 };
  const elements = [
    {
      id: randomUUID(),
      ...bounds,
      kind: "text",
      text: "收入 & 关键指标\n连续增长",
      color: "#112233",
      bold: true,
      align: "left",
      size: 32,
    },
    { id: randomUUID(), ...bounds, kind: "ellipse", fill: "#4477CC" },
    {
      id: randomUUID(),
      ...bounds,
      kind: "image",
      alt: "Icon & preview",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3sAAAAASUVORK5CYII=",
    },
    {
      id: randomUUID(),
      ...bounds,
      kind: "chart",
      name: "收入",
      fill: "#4477CC",
      items: [
        { label: "7 月", value: 82 },
        { label: "8 月", value: 96 },
      ],
    },
  ];
  return {
    version: 1,
    id: randomUUID(),
    title: "业务复盘",
    slides: [{ id: randomUUID(), title: "表现", background: "#FFFFFF", elements }],
  };
}

async function unzip(buffer) {
  const zip = await yauzl.fromBufferPromise(buffer);
  const files = new Map();
  for await (const entry of zip.eachEntry()) {
    if (entry.fileName.endsWith("/")) continue;
    const stream = await zip.openReadStreamPromise(entry);
    const bytes = [];
    for await (const chunk of stream) bytes.push(chunk);
    files.set(entry.fileName, Buffer.concat(bytes));
  }
  return files;
}

test("PowerPoint export keeps the editable objects, chart workbook and 16:9 dimensions", async () => {
  const files = await unzip(await renderPptx(fixture()));
  const xml = (filename) => files.get(filename).toString("utf8");
  const slide = xml("ppt/slides/slide1.xml");
  assert.match(slide, /<a:t>收入 &amp; 关键指标<\/a:t>/);
  assert.match(slide, /<a:t>连续增长<\/a:t>/);
  assert.match(slide, /<a:ea typeface="Microsoft YaHei"/);
  assert.match(slide, /<a:prstGeom prst="ellipse"/);
  assert.match(slide, /<p:pic>/);
  assert.match(slide, /<c:chart\b/);
  assert.match(xml("ppt/presentation.xml"), /<p:sldSz cx="12192000" cy="6858000"/);
  const chart = xml("ppt/charts/chart1.xml");
  assert.match(chart, /<c:barDir val="bar"/);
  assert.match(chart, /<c:v>82<\/c:v>/);
  assert.match(chart, /<c:externalData\b/);
  const workbook = [...files.entries()].find(([name]) => /^ppt\/embeddings\/.*\.xlsx$/.test(name))?.[1];
  assert.ok(workbook);
  const sheet = (await unzip(workbook)).get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.match(sheet, /<v>96<\/v>/);
});

test("documents survive reopening, stay project-scoped and reject overlapping revisions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "serphia-presentations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const deck = fixture();
  const first = new PresentationStore(root);
  const reopened = new PresentationStore(root);
  assert.equal(await first.save(project, deck, 0), 1);
  assert.deepEqual(await reopened.list(null), []);
  assert.deepEqual(await reopened.load(project, deck.id), { deck, revision: 1 });
  const results = await Promise.allSettled([
    first.save(project, { ...deck, title: "First edit" }, 1),
    reopened.save(project, { ...deck, title: "Second edit" }, 1),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal((await reopened.load(project, deck.id)).revision, 2);
  await assert.rejects(() => reopened.load(project, "../outside"), /identifier/);
});

test("autosave serializes revisions and retries the latest edit after a save failure", async () => {
  const deck = fixture();
  const calls = [];
  let fail = true;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queue = createPresentationSaveQueue(
    0,
    async (snapshot, revision) => {
      calls.push([snapshot.title, revision]);
      if (fail) {
        await gate;
        throw new Error("Temporary write failure");
      }
      return revision + 1;
    },
    () => {},
  );
  queue.submit(deck);
  const first = queue.flush();
  await Promise.resolve();
  queue.submit({ ...deck, title: "Latest edit" });
  release();
  assert.equal(await first, false);
  fail = false;
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, [
    ["业务复盘", 0],
    ["Latest edit", 0],
  ]);
});
