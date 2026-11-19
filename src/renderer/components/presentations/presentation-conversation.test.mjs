import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";

const root = path.resolve(import.meta.dirname, "../../../..");
const components = "src/renderer/components/";
const conversation = components + "presentations/conversation/";

async function dependencies(entry) {
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: [components + entry],
    tsconfig: "tsconfig.renderer.json",
    bundle: true,
    packages: "external",
    loader: { ".css": "empty", ".png": "empty" },
    write: false,
    metafile: true,
  });
  return new Set(Object.keys(metafile.inputs));
}

test("the PPT workspace and the main chat load independent conversation components", async () => {
  const [ppt, main] = await Promise.all([
    dependencies("presentations/PresentationSkillWorkspace.tsx"),
    dependencies("ChatWindow.tsx"),
  ]);
  for (const file of [
    "ChatInput.tsx",
    "MessageView.tsx",
    "composer/ComposerToolbar.tsx",
    "chat/ReasoningRow.tsx",
    "chat/ToolCallRow.tsx",
    "ProcessDetailsGroup.tsx",
  ]) {
    assert.ok(ppt.has(conversation + file), file);
    assert.ok(!ppt.has(components + file), file);
    assert.ok(main.has(components + file), file);
  }
  assert.ok(!Array.from(main).some((file) => file.startsWith(conversation)));
});

test("PPT conversation CSS only targets PPT elements, including menus mounted on document.body", async () => {
  const css = postcss.parse(await readFile(path.join(root, conversation, "PresentationConversation.css"), "utf8"));
  css.walkRules((rule) => {
    if (rule.parent.type === "atrule" && rule.parent.name === "keyframes") return;
    for (const selector of rule.selectors) assert.match(selector, /\.ppt-/, selector);
  });
  css.walkAtRules("keyframes", (rule) => assert.match(rule.params, /^ppt-/));
});
