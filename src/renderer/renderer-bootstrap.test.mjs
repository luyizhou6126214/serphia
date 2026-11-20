import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

test("Renderer boot mounts without replacing browser networking", async (t) => {
  const previous = new Map(
    ["window", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const fetch = globalThis.fetch;
  class EventSource {}
  const root = { id: "root" };
  globalThis.window = { fetch, EventSource };
  globalThis.document = { getElementById: (id) => (id === "root" ? root : null) };
  t.after(() => {
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  const { mounted } = await importTestBundle("renderer-bootstrap", {
    stdin: {
      contents: 'import "./main.tsx"; export {mounted} from "react-dom/client";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    tsconfig: path.join(import.meta.dirname, "../../tsconfig.renderer.json"),
    external: ["react", "react/jsx-runtime"],
    plugins: [
      {
        name: "bootstrap-fixture",
        setup(build) {
          build.onResolve({ filter: /(?:\.css$|^\.\/App$|^react-dom\/client$)/ }, ({ path }) => ({
            path,
            namespace: "bootstrap-test",
          }));
          build.onLoad({ filter: /.*/, namespace: "bootstrap-test" }, ({ path }) => ({
            contents: path.endsWith(".css")
              ? ""
              : path === "./App"
                ? "export const App = () => null;"
                : "export const mounted = []; export function createRoot(root) {return {render: (element) => mounted.push({root, element})};}",
          }));
        },
      },
    ],
  });
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].root, root);
  assert.equal(globalThis.window.fetch, fetch);
  assert.equal(globalThis.window.EventSource, EventSource);
});
