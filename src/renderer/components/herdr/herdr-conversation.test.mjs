import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { importTestBundle } from "#test-bundle";

const root = path.resolve(import.meta.dirname, "../../../..");
const directory = "src/renderer/components/";
const buildOptions = {
  absWorkingDir: root,
  packages: "external",
  format: "esm",
  tsconfig: "tsconfig.renderer.json",
  loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
  alias: { "@lobehub/icons": path.join(root, "node_modules/@lobehub/icons") },
};

test("Herdr owns its message renderer and composer", async () => {
  const { metafile } = await build({
    ...buildOptions,
    entryPoints: [directory + "herdr/HerdrPaneView.tsx"],
    bundle: true,
    write: false,
    metafile: true,
  });
  for (const [local, main] of [
    ["HerdrChatInput", "ChatInput"],
    ["HerdrMessage", "MessageView"],
    ["MarkdownBody", "MarkdownBody"],
    ["HerdrComposerSurface", "composer/ComposerFocusSurface"],
    ["HerdrProcessGroup", "ProcessDetailsGroup"],
    ["ReasoningRow", "chat/ReasoningRow"],
    ["ToolCallRow", "chat/ToolCallRow"],
  ]) {
    assert.ok(metafile.inputs[directory + "herdr/conversation/" + local + ".tsx"], local);
    assert.ok(!metafile.inputs[directory + main + ".tsx"], main);
  }
});

test("Herdr drafts stay editable when the transport cannot send", async () => {
  const { HerdrChatInput } = await importTestBundle("herdr-chat-input", {
    ...buildOptions,
    entryPoints: [directory + "herdr/conversation/HerdrChatInput.tsx"],
  });
  for (const canSend of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(HerdrChatInput, {
        value: "多行\n草稿",
        onChange() {},
        onSend() {},
        onInterrupt() {},
        canSend,
        canInterrupt: false,
        working: false,
        agent: "pi",
        agentName: "Pi",
        state: "idle",
      }),
    );
    const textarea = html.match(/<textarea[^>]*>/)?.[0];
    assert.ok(textarea);
    assert.doesNotMatch(textarea, /disabled|readOnly/i);
    assert.match(html, /多行\n草稿<\/textarea>/u);
    assert.match(html, /data-agent="pi"/);
    assert.match(html, /class="hd-compose-agent-name">Pi</);
    assert.equal(/disabled/.test(html.match(/<button type="submit"[^>]*>/)[0]), !canSend);
  }
});
