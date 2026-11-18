import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { usePresentationAgent, api } = await importTestBundle("ppt-agent-hook", {
  stdin: {
    contents:
      'export { usePresentationAgent } from "./usePresentationAgent.ts"; export * as api from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  tsconfig: path.resolve(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "ppt-api",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          loader: "js",
          contents: `
      export const pending = []; export const listeners = new Map(); export const stopped = [];
      export let outline;
      export function setOutline(value) { outline = value; }
      export async function subscribe(topic, id, fn) { listeners.set(id, fn); return () => listeners.delete(id); }
      export async function call(method, args) {
        if (method === "presentations.outline") return outline;
        if (method === "presentations.stop") { stopped.push(args.id); pending.find(p => p.args.id === args.id)?.reject(new Error("stopped")); return; }
        return new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
      }
      export function frame(index, slide) { const p = pending.find(p => p.args.index === index); listeners.get(p.args.id)?.({ runId: p.args.id, index, at: Date.now(), type: "render", slide }); }
    `,
        }));
      },
    },
  ],
});
const page = (index) => ({
  title: "Page " + index,
  background: "#FFFFFF",
  elements: [{ kind: "rect", x: 30, y: 30, w: 100, h: 100, fill: "#112233" }],
});

test("parallel pages retain outline order, stream before completion, stop and retry only unfinished pages", async () => {
  const before = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let agent;
  let renderer;
  function Harness() {
    agent = usePresentationAgent();
    return null;
  }
  try {
    api.setOutline({
      title: "Deck",
      accent: "#112233",
      pages: [0, 1, 2, 3].map((i) => ({ title: "Page " + i, summary: "Content", layout: "content" })),
    });
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () =>
      agent.generateOutline({ cwd: null, language: "en-US", prompt: "test", source: "", count: 4 }),
    );
    let generation;
    await act(async () => {
      generation = agent.generatePages();
    });
    assert.equal(api.pending.length, 3);
    assert.equal(agent.completedCount, 0);
    await act(async () => api.frame(1, page(1)));
    assert.equal(agent.slides[1].elements.length, 1);
    const identity = agent.slides[1].elements[0].id;
    await act(async () => api.pending[1].resolve(page(1)));
    assert.equal(agent.slides[1].elements[0].id, identity);
    assert.equal(api.pending.length, 4);
    assert.equal(agent.completedCount, 1);
    await act(async () => {
      agent.stop();
      await generation;
    });
    assert.equal(api.stopped.length, 3);
    assert.equal(agent.phase, "idle");
    assert.equal(api.listeners.size, 0);
    await act(async () => {
      generation = agent.generatePages();
    });
    assert.deepEqual(
      api.pending.slice(4).map((p) => p.args.index),
      [0, 2, 3],
    );
    await act(async () => {
      for (const p of api.pending.slice(4).reverse()) p.resolve(page(p.args.index));
      await generation;
    });
    assert.deepEqual(
      agent.slides.map((p) => p.title),
      ["Page 0", "Page 1", "Page 2", "Page 3"],
    );
    assert.equal(agent.completedCount, 4);
    assert.equal(api.listeners.size, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = before;
  }
});
