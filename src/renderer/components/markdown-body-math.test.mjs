import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importTestBundle } from "#test-bundle";

const { MarkdownBody, HerdrMarkdownBody, loadMarkdownPlugins } = await importTestBundle("markdown-body-math", {
  stdin: {
    contents: `
      export { MarkdownBody } from "./MarkdownBody.tsx";
      export { MarkdownBody as HerdrMarkdownBody } from "./herdr/conversation/MarkdownBody.tsx";
      export { loadMarkdownPlugins } from "@/lib/markdown";
    `,
    resolveDir: import.meta.dirname,
    loader: "tsx",
  },
  tsconfig: "tsconfig.renderer.json",
  packages: "external",
  define: { "import.meta.env.DEV": "false" },
  plugins: [
    {
      name: "plain-code-highlighter",
      setup(build) {
        build.onResolve({ filter: /katex\/dist\/katex\.min\.css$/ }, () => ({ path: "css", namespace: "test-css" }));
        build.onLoad({ filter: /.*/, namespace: "test-css" }, () => ({ contents: "", loader: "js" }));
        build.onResolve({ filter: /^@\/lib\/syntax-highlight$/ }, (args) => ({
          path: args.path,
          namespace: "test-highlighter",
        }));
        build.onLoad({ filter: /.*/, namespace: "test-highlighter" }, () => ({
          resolveDir: import.meta.dirname,
          contents:
            'import { createElement } from "react"; export const SyntaxHighlighter = ({ children }) => createElement("pre", {"data-highlighted":true}, children); export const vs = {}; export const vscDarkPlus = {};',
        }));
      },
    },
  ],
});

// Static rendering does not run effects. Load the optional plugins first for
// these formatting regressions; the lazy-loading tests exercise the effects.
await loadMarkdownPlugins({ math: true, html: true });

function render(markdown) {
  return renderToStaticMarkup(createElement(MarkdownBody, null, markdown));
}

test("conversation history renders Chinese emphasis and strikethrough next to punctuation and prose", () => {
  const source = [
    "1. **产能和价格竞争：**新增产能释放快于实际需求。",
    "2. **原料价格冲击：**六氟磷酸锂价格波动。",
    "",
    "**总体判断：**国内电解液仍有需求支撑。",
    "",
    "> 数据**（关键）**直接展示，中文***结论：***正文，*参考：*后续报告。",
    "",
    "| 名称 | 观察 |",
    "| --- | --- |",
    "| 产能 | **结论：**供给增加，~~原预测：~~供给减少 |",
  ].join("\n");
  for (const Body of [MarkdownBody, HerdrMarkdownBody]) {
    const html = renderToStaticMarkup(createElement(Body, null, source));
    assert.match(html, /<li><strong>产能和价格竞争：<\/strong>新增产能释放快于实际需求。<\/li>/);
    assert.match(html, /<li><strong>原料价格冲击：<\/strong>六氟磷酸锂价格波动。<\/li>/);
    assert.match(html, /<p><strong>总体判断：<\/strong>国内电解液仍有需求支撑。<\/p>/);
    assert.match(html, /数据<strong>（关键）<\/strong>直接展示，中文<em><strong>结论：<\/strong><\/em>正文，/);
    assert.match(html, /<em>参考：<\/em>后续报告。/);
    assert.match(html, /<td><strong>结论：<\/strong>供给增加，<del>原预测：<\/del>供给减少<\/td>/);
  }
});

test("Chinese emphasis preserves escapes, code, links, and ordinary CommonMark text", () => {
  const source = [
    String.raw`\*\*示例：\*\*原文`,
    "`**示例：**原文`",
    "```text\n**示例：**原文\n```",
    "a**(word)**b and foo_bar_baz",
    "~old~ and ~~older~~",
    "`~~原预测：~~结果`",
    "中文**[链接](https://example.com)：**正文",
    "中文**$x^2$：**正文",
  ].join("\n\n");
  const html = render(source);
  assert.match(html, /<p>\*\*示例：\*\*原文<\/p>/);
  assert.match(html, /<code class="markdown-inline-code">\*\*示例：\*\*原文<\/code>/);
  assert.match(html, /<pre data-highlighted="true">\*\*示例：\*\*原文<\/pre>/);
  assert.match(html, /<p>a\*\*\(word\)\*\*b and foo_bar_baz<\/p>/);
  assert.match(html, /<p><del>old<\/del> and <del>older<\/del><\/p>/);
  assert.match(html, /<code class="markdown-inline-code">~~原预测：~~结果<\/code>/);
  assert.match(html, /<strong><a href="https:\/\/example\.com">链接<\/a>：<\/strong>正文/);
  assert.match(html, /<strong><span class="katex">.*<\/span>：<\/strong>正文/);
});

const followingMarkdown = `

---

### Following heading

**Following bold text**

| Name | Value |
| --- | --- |
| Result | 42 |

Line one<br>Line two

$$x = 2！$$

Final paragraph.`;

test("long streaming text retains Markdown formatting and sanitization", () => {
  const source = followingMarkdown.repeat(20) + "\n<script>unsafe()</script>";
  for (const isStreaming of [true, false]) {
    const html = renderToStaticMarkup(createElement(MarkdownBody, { isStreaming }, source));
    assertFollowingMarkdown(html);
    assert.match(html, /class="katex/);
    assert.doesNotMatch(html, /data-streaming-preview|<script>/);
  }
});

test("small streaming code stays readable without highlighting and highlights once complete", () => {
  const code = "```typescript\nconst answer = 42;\n```";
  const preview = renderToStaticMarkup(createElement(MarkdownBody, { isStreaming: true }, code));
  assert.match(preview, /const answer = 42;/);
  assert.doesNotMatch(preview, /data-highlighted/);
  const settled = renderToStaticMarkup(createElement(MarkdownBody, { isStreaming: false }, code));
  assert.match(settled, /data-highlighted/);
});

function assertFollowingMarkdown(html) {
  assert.match(html, /<h3>Following heading<\/h3>/);
  assert.match(html, /<strong>Following bold text<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>42<\/td>/);
  assert.match(html, /Line one<br\/>Line two/);
  assert.match(html, /<p>Final paragraph\.<\/p>/);
}

for (const [name, prefix, indent] of [
  ["ordered list", "3. Formula:", "   "],
  ["unordered list", "- Formula:", "  "],
  ["nested list", "- Outer\n  - Formula:", "    "],
  ["blockquote", "> Formula:", "> "],
  ["top level", "Formula:\n", ""],
  ["indented top level", "Formula:\n", "   "],
]) {
  for (const lineBreak of ["\n", "\r\n"]) {
    test(`single-line display math preserves following Markdown: ${name}, ${JSON.stringify(lineBreak)}`, () => {
      const markdown = `${prefix}\n${indent}$$\\text{range} = \\frac{520}{24} \\approx 21.6！$$${followingMarkdown}`;
      const html = render(markdown.replaceAll("\n", lineBreak));
      assertFollowingMarkdown(html);
      assert.doesNotMatch(html, /katex-error/);
      assert.match(html, /class="katex"/);
      if (name === "ordered list" || name === "unordered list") {
        assert.match(html, /<li>[\s\S]*class="katex-display"[\s\S]*<\/li>/);
      }
    });
  }
}

test("invalid list formula falls back locally without swallowing subsequent Markdown", () => {
  const html = render(`3. Formula:\n   $$\\frac{1}{$$${followingMarkdown}`);
  assertFollowingMarkdown(html);
  assert.equal((html.match(/class="katex-error"/g) ?? []).length, 1);
  assert.match(html, /<span class="katex-error"[^>]*>\\frac\{1\}\{<\/span>/);
});

test("formula normalization preserves factorials and fullwidth punctuation", () => {
  const html = render("3. Formula:\n   $$n! + n!! + 1！$$");
  assert.doesNotMatch(html, /katex-error/);
  assert.match(html, /<annotation encoding="application\/x-tex">n! \+ n!! \+ 1！<\/annotation>/);
});

test("fenced code examples stay literal and properly indented multiline math still renders", () => {
  const html = render(`\`\`\`text\n   $$x=1$$\n\`\`\`\n\n3. Formula:\n   $$\n   x=1\n   $$${followingMarkdown}`);
  assertFollowingMarkdown(html);
  assert.match(html, /\$\$x=1\$\$/);
  assert.doesNotMatch(html, /katex-error/);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
});
