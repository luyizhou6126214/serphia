import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zhCN } from "../i18n-dictionaries.ts";

const settingsSource = readFileSync(new URL("./SettingsConfig.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
const chatWindowSource = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatLayoutSource = readFileSync(new URL("../lib/chat-layout.ts", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("./composer/ComposerToolbar.tsx", import.meta.url), "utf8");
const messageViewSource = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("General settings exposes complete accessible chat appearance controls", () => {
  for (const id of ["chatFontSizeControlId", "chatLayoutControlId"]) assert.match(settingsSource, new RegExp(id));
  for (const value of ["small", "standard", "large", "extra-large", "fixed", "wide"]) {
    assert.match(settingsSource, new RegExp(`<option value="${value}">`));
  }
  assert.match(settingsSource, /chatLayoutFixed", "Comfortable width"/);
  assert.match(settingsSource, /chatLayoutWide", "Expanded width"/);
  assert.equal(zhCN.chatLayoutFixed, "舒适宽度");
  assert.equal(zhCN.chatLayoutWide, "扩展宽度");
  assert.doesNotMatch(settingsSource, /chatAssistantWidthControlId/);
  assert.match(settingsSource, /disabled=\{chatAppearanceSaving\}/);
  assert.match(settingsSource, /role="alert"[\s\S]*?chatAppearanceSaveFailed/);
  assert.match(settingsSource, /onChatAppearanceChange\(next\)/);
});

test("assistant replies fill the same content column as the composer, including legacy saved width preferences", () => {
  assert.match(cssSource, /\.chat-message-assistant\s*\{\s*width:\s*100%/);
  assert.doesNotMatch(cssSource, /--chat-assistant-max-width/);
  assert.doesNotMatch(messageViewSource, /--chat-assistant-max-width/);
});

test("chat appearance CSS defines scoped font scales and both width modes", () => {
  assert.match(cssSource, /\.chat-appearance-scope\s*\{[\s\S]*?--chat-font-scale:\s*1/);
  assert.match(cssSource, /data-chat-font-size="small"[\s\S]*?--chat-font-scale:\s*0\.9/);
  assert.match(cssSource, /data-chat-font-size="large"[\s\S]*?--chat-font-scale:\s*1\.15/);
  assert.match(cssSource, /data-chat-font-size="extra-large"[\s\S]*?--chat-font-scale:\s*1\.3/);
  assert.match(cssSource, /data-chat-layout="wide"[\s\S]*?--chat-content-max-width:\s*clamp\(760px,\s*74%,\s*960px\)/);
  assert.doesNotMatch(cssSource, /data-chat-layout="full"|--chat-content-max-width:\s*100%/);
  assert.match(cssSource, /\.chat-content-column\s*\{[\s\S]*?max-width:\s*var\(--chat-content-max-width\)/);
  assert.doesNotMatch(cssSource, /var\(--chat-font-scale\)(?!\s*:)/);
});

test("the full-width dock applies the chat width once after reserving the minimap gutter", () => {
  assert.equal((chatWindowSource.match(/className="chat-content-column/g) ?? []).length, 4);
  assert.equal((chatInputSource.match(/className="chat-content-column"/g) ?? []).length, 1);
  assert.match(chatWindowSource, /className="chat-input-transition-dock[^\n]*w-full/);
  assert.doesNotMatch(chatWindowSource, /className="chat-content-column chat-input-transition-dock/);
  assert.match(
    chatWindowSource,
    /ref=\{scrollContainerRef\}[\s\S]*?paddingLeft:\s*CHAT_COLUMN_PADDING,[\s\S]*?paddingRight:\s*CHAT_COLUMN_PADDING/,
  );
  assert.match(chatWindowSource, /paddingRight:\s*isMobile \? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING/);
  assert.doesNotMatch(chatWindowSource, /maxWidth:\s*"var\(--chat-content-max-width\)"/);
  assert.doesNotMatch(chatInputSource, /maxWidth:\s*"var\(--chat-content-max-width\)"/);
});

test("the composer dock reserves the same minimap gutter as the message column", () => {
  const minimapWidth = Number(/CHAT_MINIMAP_WIDTH = (\d+)/.exec(chatLayoutSource)?.[1]);
  const columnPadding = Number(/CHAT_COLUMN_PADDING = (\d+)/.exec(chatLayoutSource)?.[1]);
  const timelineBlock = /\.chat-timeline \{([^}]*)\}/.exec(cssSource)?.[1] ?? "";
  const timelineRail = Number(/width: (\d+)px;/.exec(timelineBlock)?.[1]);
  const timelineMargin = Number(/margin-right: (\d+)px;/.exec(timelineBlock)?.[1]);

  assert.match(chatLayoutSource, /CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING \+ CHAT_MINIMAP_WIDTH/);
  // The shared constants must keep tracking the real `.chat-timeline` rail, or the composer drifts again.
  assert.equal(minimapWidth, timelineRail + timelineMargin);
  assert.equal(columnPadding, 16);
  assert.match(
    chatInputSource,
    /paddingRight: isMobile \|\| welcome \? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING/,
  );
  assert.doesNotMatch(chatInputSource, /paddingRight: isMobile \|\| welcome \? 16 : 48/);
});

test("chat text uses the shared scale while glyph-only icons remain fixed", () => {
  assert.match(chatWindowSource, /className="chat-welcome-heading"/);
  assert.match(cssSource, /\.chat-welcome-heading\s*\{[^}]*font-size:\s*calc\(24px \* var\(--chat-font-scale, 1\)\)/);
  assert.match(chatInputSource, /fontSize:\s*scaledChatFont\(14\)/);
  // The transcript's text sizes come from the DSH token ladder, not inline props.
  assert.match(cssSource, /\.dsh-user-bubble\s*\{[^}]*font-size:\s*var\(--dsh-content-font-size/);
  assert.match(cssSource, /--dsh-content-font-size:\s*calc\(14px \* var\(--chat-font-scale, 1\)\)/);
  assert.doesNotMatch(messageViewSource, /scaledChatFont/);
  assert.deepEqual(chatInputSource.match(/fontSize:\s*[0-9]+(?:\.[0-9]+)?/g) ?? [], []);
  assert.deepEqual(toolbarSource.match(/fontSize:\s*[0-9]+(?:\.[0-9]+)?/g) ?? [], []);
  assert.deepEqual(messageViewSource.match(/fontSize:\s*[0-9]+(?:\.[0-9]+)?/g) ?? [], []);
});
