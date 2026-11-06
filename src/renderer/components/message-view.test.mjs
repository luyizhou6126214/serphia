import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";

const { MessageView, withGeneratedImageReply } = await importTestBundle("src/renderer/components/message-view", {
  mainFields: ["module", "main"],
  stdin: {
    contents:
      'export { MessageView } from "./MessageView.tsx"; export { withGeneratedImageReply } from "../lib/generated-image-reply.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "message-view-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "stub-markdown-body",
      setup(buildApi) {
        // MessageView, the reasoning row, and the tool row all render prose
        // through MarkdownBody; one stub keeps the KaTeX stylesheet out of the
        // test bundle.
        buildApi.onResolve({ filter: /(^|\/)MarkdownBody$/ }, () => ({
          path: "markdown-body",
          namespace: "message-view-test",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "message-view-test" }, () => ({
          contents:
            'import { createElement } from "react"; export function MarkdownBody({ children }) { return createElement("div", null, children); }',
          loader: "js",
        }));
      },
    },
  ],
});

test("MessageView is memoized to preserve unchanged historical messages", () => {
  assert.equal(MessageView.$$typeof, Symbol.for("react.memo"));
});

test("a historical tool without a canonical result is not displayed as still running", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "interrupted", toolName: "fixture", input: {} }],
      },
      runningToolCallIds: new Set(),
    }),
  );
  assert.match(html, /data-state="stopped"/);
  assert.match(html, /Stopped/);
  assert.doesNotMatch(html, /dsh-shimmer-decoration/);
  assert.doesNotMatch(html, /stream-caret/);
});

test("work-step modes control settled reasoning previews but never auto-expand rows", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "reasoning fixture" },
      { type: "toolCall", toolCallId: "fixture-call", toolName: "read", input: { path: "fixture.ts" } },
      { type: "text", text: "answer" },
    ],
    model: "fixture-model",
    provider: "fixture-provider",
    usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10, cost: { total: 0.01 } },
  };

  const compact = renderToStaticMarkup(createElement(MessageView, { message, workStepDisplay: "compact" }));
  assert.match(compact, /fixture\.ts/);
  // The preview text is always in the DOM; the policy decides whether it paints.
  assert.doesNotMatch(compact, /data-preview/);
  assert.doesNotMatch(compact, /&quot;path&quot;/);

  for (const mode of ["standard", "detailed", "verbose"]) {
    const html = renderToStaticMarkup(createElement(MessageView, { message, workStepDisplay: mode }));
    assert.match(html, /fixture\.ts/);
    assert.match(html, /data-preview="true"/);
    assert.match(html, /reasoning fixture/);
    // Every mode keeps an unopened row folded: argument JSON appears on demand only.
    assert.doesNotMatch(html, /&quot;path&quot;/);
  }
});

test("intermediate process messages do not render the assistant copy action", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "assistant", content: [{ type: "text", text: "intermediate process text" }] },
      hideCopy: true,
    }),
  );
  assert.doesNotMatch(html, /data-tooltip="Copy message"/);
  assert.match(html, /intermediate process text/);
});

test("keeps the user copy action without timestamp or branch actions", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "user", content: "copy me" },
    }),
  );

  assert.match(html, /data-tooltip="Copy message"/);
});

test("channel attachment placeholders expose meaningful copy text", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "user",
        channelSource: "telegram",
        channelAttachments: [{ kind: "file", name: "report.pdf", mime: "application/pdf" }],
        content: [{ type: "text", text: "\uFFFC" }],
      },
    }),
  );

  assert.match(html, /Attachment: report\.pdf \(application\/pdf\)/);
  assert.match(html, /data-tooltip="Copy message"/);
});

test("legacy attachment placeholders without metadata disable copy", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "user", channelSource: "weixin", content: "\uFFFC" },
    }),
  );

  assert.match(html, /data-tooltip="Nothing to copy"/);
  assert.match(html, /disabled=""/);
});

test("renders persisted skill invocations collapsed without exposing their instructions", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "user",
        content: `<skill name="review" location="/home/test/.pi/skills/review/SKILL.md">
References are relative to /home/test/.pi/skills/review.

# Review

Private implementation instructions.
</skill>

Check the current change`,
      },
    }),
  );

  assert.match(html, /data-testid="skill-invocation"/);
  assert.match(html, /data-skill-name="review"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Check the current change/);
  assert.doesNotMatch(html, /Private implementation instructions/);
  assert.doesNotMatch(html, /\/home\/test\/\.pi\/skills/);
});

function assistant(overrides = {}) {
  return {
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    ...overrides,
  };
}

test("renders an empty provider failure as a persistent alert", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({ stopReason: "error", errorMessage: "401: invalid API key" }),
    }),
  );

  assert.match(html, /data-testid="assistant-error-message"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Model request failed/);
  assert.match(html, /401: invalid API key/);
});

test("renders actionable fallback text when a failed response has no provider detail", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({ stopReason: "error" }),
    }),
  );

  assert.match(html, /Check the API key, service URL, and model configuration/);
});

test("an aborted response keeps partial text and shows a neutral stopped status instead of a provider error", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({
        stopReason: "aborted",
        errorMessage: "This operation was aborted",
        content: [{ type: "text", text: "Partial reply" }],
      }),
    }),
  );
  assert.match(html, /Partial reply/);
  assert.match(html, /Response stopped/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Model request failed|Check the API key|role="alert"/);
  const empty = renderToStaticMarkup(createElement(MessageView, { message: assistant({ stopReason: "aborted" }) }));
  assert.match(empty, /Response stopped/);
});

test("continues to hide a completed empty non-error assistant message", () => {
  assert.equal(renderToStaticMarkup(createElement(MessageView, { message: assistant() })), "");
});

test("renders compaction summaries collapsed by default", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "custom",
        customType: "compaction",
        content: "First line of the summary.\nSecond line stays behind the disclosure.",
        display: true,
      },
    }),
  );

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Context compacted/);
  assert.match(html, /First line of the summary\./);
  assert.doesNotMatch(html, /Second line stays behind the disclosure/);
});

function renderToolResult(result) {
  return renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({
        content: [{ type: "toolCall", toolCallId: result.toolCallId, toolName: result.toolName, input: {} }],
      }),
      toolResults: new Map([[result.toolCallId, result]]),
    }),
  );
}

function persistedHerdrResult(isError = false, output = "PRIVATE_FIXTURE_OUTPUT") {
  const code = isError && output.includes("HERDR_REQUEST_TIMEOUT") ? "HERDR_REQUEST_TIMEOUT" : null;
  return {
    role: "toolResult",
    toolCallId: "herdr-result",
    toolName: "herdr_list",
    content: [
      {
        type: "text",
        text: code
          ? `[Herdr tool failed: ${code}. Live Herdr content was not saved.]`
          : "[Sensitive Herdr result was not saved. Ask Pi to inspect the live Herdr fleet again.]",
      },
    ],
    isError,
    ...(code ? { details: { errorCode: code } } : {}),
  };
}

test("tool images render from persisted content without depending on the temporary image file", () => {
  const result = {
    role: "toolResult",
    toolCallId: "image-result",
    toolName: "codemode",
    content: [
      { type: "text", text: "[Image saved to /tmp/already-removed.png]" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "image", source: { type: "base64", media_type: "image/webp", data: "d29ybGQ=" } },
    ],
    isError: false,
  };
  const before = JSON.stringify(result);
  const html = renderToolResult(result);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,aGVsbG8="/);
  assert.match(html, /<img[^>]+src="data:image\/webp;base64,d29ybGQ="/);
  assert.match(html, /alt="Tool result image"/);
  assert.doesNotMatch(html, /src="[^"]*already-removed/);
  assert.equal(JSON.stringify(result), before);
});

test("tool images wait for deferred data and never fetch a remote image or an arbitrary MIME type", () => {
  const html = renderToolResult({
    role: "toolResult",
    toolCallId: "deferred-image",
    toolName: "codemode",
    content: [
      {
        type: "image",
        data: "aGVsbG8=",
        mimeType: "image/png",
        deferredContent: { entryId: "entry", originalBytes: 10 },
      },
      { type: "image", source: { type: "url", url: "https://example.invalid/image.png" } },
      { type: "image", data: "aGVsbG8=", mimeType: "image/svg+xml" },
    ],
    isError: false,
  });
  assert.doesNotMatch(html, /<img|example\.invalid|data:image/);
});

test("generated images appear in the final reply without rendering tool details or changing the transcript", () => {
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  const result = {
    role: "toolResult",
    toolCallId: "generated",
    toolName: "codemode",
    content: [{ type: "text", text: "PRIVATE_PROCESS_DETAILS" }, image],
    details: { calls: [{ name: "models.generateImages", status: "ok" }] },
  };
  const answer = assistant({ content: [{ type: "text", text: "Your picture is ready." }] });
  const messages = [{ role: "user", content: "Make a picture" }, result, answer];
  const before = JSON.stringify(messages);
  const reply = withGeneratedImageReply(answer, answer, messages, 1, 3);
  const html = renderToStaticMarkup(createElement(MessageView, { message: reply }));
  assert.match(html, /Your picture is ready/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,aGVsbG8="/);
  assert.match(html, /alt="Image in reply"/);
  assert.doesNotMatch(html, /PRIVATE_PROCESS_DETAILS|codemode|Load full content/);
  assert.equal(JSON.stringify(messages), before);
  assert.equal(reply.content.at(-1), image);
});

test("reply projection stays within its turn, excludes read images and retains successful output after a later failure", () => {
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  const generated = {
    role: "toolResult",
    toolCallId: "gen",
    toolName: "codemode",
    content: [image, image],
    details: { calls: [{ name: "models.generateImages", status: "ok" }] },
    isError: true,
  };
  const read = { ...generated, toolCallId: "read", details: { calls: [{ name: "read", status: "ok" }] } };
  const failed = {
    ...generated,
    toolCallId: "failed",
    details: { calls: [{ name: "models.generateImages", status: "error" }] },
  };
  const answer = assistant({ content: [{ type: "text", text: "Done" }] });
  assert.equal(withGeneratedImageReply(answer, answer, [generated, read, failed], 1, 3), answer);
  const reply = withGeneratedImageReply(null, answer, [generated, read, failed], 0, 3);
  assert.equal(reply.content.length, 1);
  assert.equal(reply.content[0], image);
});

test("deferred generated images keep the tool entry reference for automatic history loading", () => {
  const image = {
    type: "image",
    source: { type: "url", url: "" },
    deferredContent: { entryId: "tool-entry", blockIndex: 2, originalBytes: 700000, contentType: "image" },
  };
  const result = {
    role: "toolResult",
    toolCallId: "gen",
    toolName: "codemode",
    content: [image],
    details: { calls: [{ name: "models.generateImages", status: "ok" }] },
  };
  const answer = assistant({ content: [{ type: "text", text: "Done" }] });
  const reply = withGeneratedImageReply(answer, answer, [result], 0, 1);
  assert.equal(reply.content.at(-1), image);
  const html = renderToStaticMarkup(
    createElement(MessageView, { message: reply, onLoadDeferredContent: async () => {} }),
  );
  assert.match(html, /Loading image/);
  assert.doesNotMatch(html, /Load full content/);
});

test("persisted Herdr results show a neutral history notice without changing the stored message", () => {
  const result = persistedHerdrResult();
  const before = JSON.stringify(result);
  const html = renderToolResult(result);
  assert.match(html, /The original output was not saved in history\./);
  assert.doesNotMatch(html, /Sensitive Herdr result|Ask Pi to inspect|PRIVATE_FIXTURE_OUTPUT|var\(--danger\)/);
  assert.equal(JSON.stringify(result), before);
});

test("persisted Herdr failures remain failures and keep safe diagnostic codes visible", () => {
  for (const [output, code] of [
    ["Unknown failure", null],
    ["HERDR_REQUEST_TIMEOUT: private endpoint", "HERDR_REQUEST_TIMEOUT"],
  ]) {
    const result = persistedHerdrResult(true, output);
    const before = JSON.stringify(result);
    const html = renderToolResult(result);
    assert.match(html, /The tool call failed/);
    assert.match(html, /The original output was not saved in history/);
    // The row itself carries the failure state; the summary slot owns the color.
    assert.match(html, /data-state="error"/);
    assert.match(html, /data-error/);
    if (code) assert.match(html, new RegExp(code));
    assert.doesNotMatch(html, /Sensitive Herdr result|Ask Pi to inspect|private endpoint/);
    assert.equal(JSON.stringify(result), before);
    assert.equal(result.isError, true);
  }
});

test("successful output is folded and can be expanded without mistaking it for a Herdr history notice", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });
  const marker = persistedHerdrResult().content[0].text;
  for (const [name, output] of [
    ["herdr_list", "Live result: pane-42"],
    ["herdr_list", `Quoted: ${marker}`],
    ["bash", marker],
  ]) {
    const result = {
      role: "toolResult",
      toolCallId: "live",
      toolName: name,
      content: [{ type: "text", text: output }],
      isError: false,
    };
    const html = renderToolResult(result);
    assert.ok(!html.includes(output), "successful output should start folded");
    let renderer;
    try {
      await act(async () => {
        renderer = create(
          createElement(MessageView, {
            message: assistant({ content: [{ type: "toolCall", toolCallId: "live", toolName: name, input: {} }] }),
            toolResults: new Map([["live", result]]),
            workStepDisplay: "standard",
          }),
        );
      });
      const toggle = renderer.root
        .findAll((node) => node.props.role === "button" && node.props["data-disclosure-row"] !== undefined)
        .at(0);
      assert.equal(toggle.props["aria-expanded"], false);
      await act(async () => toggle.props.onClick());
      assert.equal(toggle.props["aria-expanded"], true);
      assert.ok(JSON.stringify(renderer.toJSON()).includes(output));
      assert.ok(!JSON.stringify(renderer.toJSON()).includes("The original output was not saved in history"));
      await act(async () => toggle.props.onClick());
      assert.ok(!JSON.stringify(renderer.toJSON()).includes(output));
    } finally {
      if (renderer) await act(async () => renderer.unmount());
    }
  }
});

test("message actions keep accessible tooltip names while rendering icons only", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "user", content: "fixture", timestamp: 1 },
      entryId: "user-1",
      prevAssistantEntryId: "assistant-0",
      onFork() {},
      onNavigate() {},
      onEditContent() {},
    }),
  );
  for (const name of [
    "Copy message",
    "Edit from here — branches within this session",
    "New session — creates an independent copy from here",
  ]) {
    assert.ok(html.includes(`data-tooltip="${name}" aria-label="${name}"`));
  }
  assert.doesNotMatch(html, />\s*(?:Copy|Copied|Edit from here|New session|Creating…)\s*</);
  assert.equal((html.match(/class="dsh-message-action"/g) ?? []).length, 3);
});
