import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { SyntaxHighlighter, vs, vscDarkPlus } from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useStreamingMarkdown } from "@/hooks/useStreamingMarkdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { useMarkdownPlugins } from "@/lib/markdown";
import { shouldHighlightCode } from "@/lib/code-highlight-policy";
import { mermaidCacheKey, renderMermaidSvg } from "@/lib/mermaid-renderer";
import { SessionProfiler } from "./SessionProfiler";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { ReferenceText } from "./composer/ReferenceText";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  imageBasePath?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  /**
   * Typography ladder. `compact` is the secondary tier used inside an expanded
   * Think row: smaller type, tighter block rhythm, inheriting colors.
   */
  variant?: "base" | "compact";
  renderReferences?: boolean;
}

type MarkdownRenderContextValue = Pick<
  MarkdownBodyProps,
  "isStreaming" | "cwd" | "imageBasePath" | "sourceSessionId" | "onOpenFile" | "renderReferences"
>;

const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({});

type MarkdownComponentProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & {
  node?: unknown;
};

function MarkdownCode({ className, children, node: _node, ...props }: MarkdownComponentProps<"code">) {
  const { isStreaming } = useContext(MarkdownRenderContext);
  const lang = className?.replace("language-", "").toLowerCase() ?? "";
  const raw = String(children);
  const isBlock = className?.includes("language-") || raw.includes("\n");
  if (isBlock) {
    if (lang === "mermaid") {
      return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
    }
    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
  }
  return (
    <code className="markdown-inline-code" {...props}>
      {children}
    </code>
  );
}

function MarkdownPre({ children }: MarkdownComponentProps<"pre">) {
  return <>{children}</>;
}

function MarkdownAnchor({ href, children, node: _node, ...props }: MarkdownComponentProps<"a">) {
  const { cwd, onOpenFile } = useContext(MarkdownRenderContext);
  const { language, t } = useI18n();
  const [menuError, setMenuError] = useState(false);
  const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
  if (!filePath || !onOpenFile) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  // Absolute links (attachments, agent-printed paths) reveal in Explorer;
  // relative repo links still open in the in-app viewer.
  const hrefText = typeof href === "string" ? href : "";
  const revealInFolder = /^file:/i.test(hrefText) || /^[a-zA-Z]:[\\/]/.test(hrefText) || hrefText.startsWith("/");

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.currentTarget.getAttribute("target");
    if (target && target !== "_self") return;
    event.preventDefault();
    if (revealInFolder && window.piBridge?.showItemInFolder) {
      void window.piBridge.showItemInFolder(filePath);
      return;
    }
    onOpenFile(filePath);
  };

  const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    // Chromium (Electron 43) does not reliably report file: links in the
    // native context-menu event, so we show the rich file menu ourselves.
    if (event.defaultPrevented) return;
    event.preventDefault();
    const request = window.piBridge.showFileContextMenu({
      href: filePath,
      cwd,
      source: "rendered-agent-text",
      language,
    });
    void request.then((result) => setMenuError(!result.shown)).catch(() => setMenuError(true));
  };

  return (
    <>
      <a href={href} {...props} onClick={handleClick} onContextMenu={handleContextMenu}>
        {children}
      </a>
      {menuError && (
        <span role="status" style={{ marginLeft: 4, color: "var(--danger)", fontSize: "0.85em" }}>
          {t("fileContextMenuUnavailable", "The file menu could not be opened.")}
        </span>
      )}
    </>
  );
}

function MarkdownImg({ src, alt, node: _node, ...props }: MarkdownComponentProps<"img">) {
  const { cwd, imageBasePath, sourceSessionId } = useContext(MarkdownRenderContext);
  return (
    <MarkdownImage
      src={src}
      alt={alt}
      cwd={cwd}
      relativeBase={imageBasePath ?? cwd}
      sourceSessionId={sourceSessionId}
      {...props}
    />
  );
}

/**
 * Table columns from the first row. Four or more read as a comparison matrix:
 * the block keeps its natural width and exposes the stable `md-table-wide`
 * hook so the transcript can widen it past the message column. Narrower tables
 * fill the column and wrap instead.
 */
function columnCount(node: unknown): number {
  const element = node as { children?: { tagName?: string; children?: unknown[] }[] } | undefined;
  const firstRow = element?.children?.find((child) => child?.tagName === "tr");
  return Array.isArray(firstRow?.children) ? firstRow.children.length : 0;
}

function MarkdownTable({ children, node }: MarkdownComponentProps<"table">) {
  const wide = columnCount(node) >= 4;
  return (
    <div className={wide ? "markdown-table-wrap md-table-wide" : "markdown-table-wrap"} tabIndex={wide ? 0 : undefined}>
      <table>{children}</table>
    </div>
  );
}

function MarkdownParagraph({ children, node: _node, ...props }: MarkdownComponentProps<"p">) {
  const { renderReferences } = useContext(MarkdownRenderContext);
  return <p {...props}>{renderReferences ? ReactChildrenWithReferences(children) : children}</p>;
}

function ReactChildrenWithReferences(children: ReactNode): ReactNode {
  if (typeof children === "string") return <ReferenceText text={children} />;
  if (Array.isArray(children))
    return children.map((child, index) =>
      typeof child === "string" ? <ReferenceText key={index} text={child} /> : child,
    );
  return children;
}

const MemoizedReactMarkdown = memo(ReactMarkdown);

const markdownComponents: Components = {
  p: MarkdownParagraph,
  code: MarkdownCode,
  pre: MarkdownPre,
  a: MarkdownAnchor,
  img: MarkdownImg,
  table: MarkdownTable,
};

// react-markdown 10 strips non-web protocols from href/src via defaultUrlTransform
// (file: becomes ""). Local file links are this app's core feature, so allow file:.
type UrlTransform = (url: string, key: string, node: unknown) => string;
const fileAwareUrlTransform: UrlTransform = (url, key, node) => {
  if (/^file:/i.test(url)) return url;
  return (defaultUrlTransform as UrlTransform)(url, key, node);
};

export const MarkdownBody = memo(function MarkdownBody({
  children,
  className,
  isStreaming,
  cwd,
  imageBasePath,
  sourceSessionId,
  onOpenFile,
  variant = "base",
  renderReferences,
}: MarkdownBodyProps) {
  const visibleMarkdown = useStreamingMarkdown(children, isStreaming);
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(visibleMarkdown), [visibleMarkdown]);
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(normalizedMarkdown);
  const renderContext = useMemo(
    () => ({ isStreaming, cwd, imageBasePath, sourceSessionId, onOpenFile, renderReferences }),
    [cwd, imageBasePath, isStreaming, onOpenFile, sourceSessionId, renderReferences],
  );

  return (
    <SessionProfiler id="MarkdownBody">
      <MarkdownRenderContext.Provider value={renderContext}>
        <div
          className={["markdown-body", variant === "compact" ? "markdown-compact" : null, className]
            .filter(Boolean)
            .join(" ")}
        >
          <MemoizedReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            urlTransform={fileAwareUrlTransform}
            components={markdownComponents}
          >
            {normalizedMarkdown}
          </MemoizedReactMarkdown>
        </div>
      </MarkdownRenderContext.Provider>
    </SessionProfiler>
  );
});

export function getMarkdownComponentIdentityForTest(): Components {
  return markdownComponents;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  relativeBase,
  sourceSessionId,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  cwd?: string;
  relativeBase?: string;
  sourceSessionId?: string | null;
}) {
  const localPath = useMemo(
    () => resolveLocalFileHref(typeof src === "string" ? src : undefined, cwd, relativeBase),
    [cwd, relativeBase, src],
  );
  const [previewSrc, setPreviewSrc] = useState<string | null>(localPath ? null : typeof src === "string" ? src : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!localPath) {
      setPreviewSrc(typeof src === "string" ? src : null);
      setFailed(false);
      return;
    }

    let disposed = false;
    let revoke: (() => void) | null = null;
    setPreviewSrc(null);
    setFailed(false);

    void import("@/lib/file-blob")
      .then(({ fileToObjectUrl }) => fileToObjectUrl(localPath, sourceSessionId))
      .then((result) => {
        if (disposed) {
          result.revoke();
          return;
        }
        revoke = result.revoke;
        setPreviewSrc(result.url);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      revoke?.();
    };
  }, [localPath, sourceSessionId, src]);

  if (failed) {
    return (
      <span className="markdown-image-error" title={localPath ?? undefined}>
        {alt || "Image failed to load"}
      </span>
    );
  }

  if (!previewSrc) {
    return <span className="markdown-image-loading" aria-label={alt || "Loading image"} />;
  }

  return <img src={previewSrc} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" {...props} />;
}

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      // Keep the body in the same list item as its fences; dedenting it turns
      // the closing fence into a new block that consumes subsequent Markdown.
      const indent = displayMathMatch[1];
      return `${indent}$$${lineBreak}${indent}${math}${lineBreak}${indent}$$`;
    })
    .join(lineBreak);
}

function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = mermaidCacheKey(code, isDark);

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const rendered = await renderMermaidSvg(code, isDark);
      if (!cancelled) {
        setSvg(rendered);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={
        isStreaming
          ? "Preview available after streaming"
          : showPreview
            ? "Show Mermaid source"
            : "Preview Mermaid diagram"
      }
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">Invalid Mermaid diagram</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label="Rendering Mermaid diagram" />
    ) : (
      <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
    );

  return (
    <div className="markdown-code-block md-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  headerAction,
  isStreaming,
}: {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  isStreaming?: boolean;
}) {
  const { isDark } = useTheme();
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="markdown-code-block md-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button onClick={() => void copy(code)} className="markdown-code-action">
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      {!isStreaming && shouldHighlightCode(code) ? (
        <SyntaxHighlighter
          language={lang || "text"}
          style={isDark ? vscDarkPlus : vs}
          customStyle={{
            margin: 0,
            padding: "16px",
            fontSize: scaledChatFont(13),
            lineHeight: "1.6",
            borderRadius: 0,
            background: "transparent",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: "16px",
            fontSize: scaledChatFont(13),
            lineHeight: "1.6",
            overflow: "auto",
            whiteSpace: "pre",
            fontFamily: "var(--font-mono)",
            background: "transparent",
          }}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
