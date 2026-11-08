import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { TurnChanges } = await importTestBundle("turn-changes-ui", {
  entryPoints: [path.join(import.meta.dirname, "TurnChanges.tsx")],
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "turn-changes-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "changes-i18n" }));
        build.onLoad({ filter: /.*/, namespace: "changes-i18n" }, () => ({
          contents: "export const useI18n=()=>({language:'en',t:(_key,fallback)=>fallback??_key});",
        }));
        build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: "icons", namespace: "changes-icons" }));
        build.onLoad({ filter: /.*/, namespace: "changes-icons" }, () => ({
          contents:
            "export const ChevronDown=()=>null;export const ChevronUp=()=>null;export const ExternalLink=()=>null;export const FileCode=()=>null;",
        }));
        build.onResolve({ filter: /^@\/components\/FileIcons$/ }, () => ({
          path: "fileicons",
          namespace: "changes-fileicons",
        }));
        build.onLoad({ filter: /.*/, namespace: "changes-fileicons" }, () => ({
          contents: "export const getFileIcon=()=>null;",
        }));
      },
    },
  ],
});

/** One diff line as the collector produces it. */
const line = (kind, text) => ({ kind, text });

function file(name, added = 2, deleted = 1) {
  return {
    path: `/repo/${name}`,
    display: name,
    added,
    deleted,
    diff: [line("hunk", "@@ -1 +1 @@"), line("remove", "old"), line("add", "new")],
    approximate: false,
    truncated: false,
  };
}

const buttons = (root, className) =>
  root.findAll((node) => node.type === "button" && String(node.props.className).includes(className));
const text = (node) => node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");

test("a single changed file opens its diff from the header", async () => {
  let opened = null;
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(TurnChanges, { files: [file("src/a.ts")], onOpenFile: (value) => (opened = value) }),
    );
  });
  const header = renderer.root.find(
    (node) => node.type === "button" && String(node.props.className).includes("turn-changes-header"),
  );
  assert.equal(header.props["aria-expanded"], false);
  assert.equal(text(renderer.root.findAll((node) => node.props.className === "turn-changes-title")[0]), "a.ts");
  const stat = text(renderer.root.findAll((node) => node.props.className === "turn-changes-stat")[0]);
  assert.equal(stat, "+2−1");

  await act(async () => header.props.onClick());
  const diffLines = renderer.root
    .findAll((node) => typeof node.props.className === "string" && node.props.className.includes("turn-changes-line"))
    .map((node) => text(node));
  assert.deepEqual(diffLines, ["@@ -1 +1 @@", "−old", "+new"]);

  const open = buttons(renderer.root, "turn-changes-open")[0];
  await act(async () => open.props.onClick());
  assert.equal(opened, "/repo/src/a.ts");
  await act(async () => renderer.unmount());
});

test("a long file list folds to four rows and expands on demand", async () => {
  const files = ["a", "b", "c", "d", "e", "f"].map((name) => file(`src/${name}.ts`));
  let renderer;
  await act(async () => {
    renderer = create(createElement(TurnChanges, { files }));
  });
  assert.equal(buttons(renderer.root, "turn-changes-row").length, 4);
  const title = renderer.root.findAll((node) => node.props.className === "turn-changes-title")[0];
  assert.equal(text(title), "6 files changed");

  const toggle = buttons(renderer.root, "turn-changes-toggle")[0];
  await act(async () => toggle.props.onClick());
  assert.equal(buttons(renderer.root, "turn-changes-row").length, 6);

  const row = buttons(renderer.root, "turn-changes-row")[5];
  await act(async () => row.props.onClick());
  const paths = renderer.root
    .findAll((node) => node.props.className === "turn-changes-diff-path")
    .map((node) => text(node));
  assert.deepEqual(paths, ["src/f.ts"]);
  await act(async () => renderer.unmount());
});

test("an approximate diff says so and a truncated one notes the cap", async () => {
  const written = { ...file("README.md", 40, 0), approximate: true, truncated: true };
  let renderer;
  await act(async () => {
    renderer = create(createElement(TurnChanges, { files: [written] }));
  });
  const notes = renderer.root.findAll((node) => node.props.className === "turn-changes-note").map((node) => text(node));
  assert.deepEqual(notes, []);

  const header = renderer.root.find(
    (node) => node.type === "button" && String(node.props.className).includes("turn-changes-header"),
  );
  await act(async () => header.props.onClick());
  const expandedNotes = renderer.root
    .findAll((node) => node.props.className === "turn-changes-note")
    .map((node) => text(node));
  assert.deepEqual(expandedNotes, [
    "The previous content is unavailable; this shows the written result.",
    "Diff truncated",
  ]);
  await act(async () => renderer.unmount());
});
