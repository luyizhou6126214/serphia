/**
 * Assistant reasoning disclosure, independent of tool-call presentation.
 * Ported from DeepSeek Harness's ReasoningRow: one 24px Think row, a first-line
 * preview beside the title, a streaming mask, and compact Markdown once open.
 */
import { memo, useMemo } from "react";
import { Brain } from "lucide-react";
import { MarkdownBody } from "../MarkdownBody";
import { DisclosureRow } from "./DisclosureRow";
import { TextShimmer } from "./TextShimmer";

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

/** Last completed paragraph's first line, so a streaming preview advances by paragraph. */
function latestCompletedParagraphFirstLine(text: string): string {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd = nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

export interface ReasoningRowProps {
  /** Complete or streaming reasoning text. */
  text: string;
  /** Whether this block is the streaming tail. */
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Live display policy for settled previews. */
  settledPreview: boolean;
  title: string;
  /** Announcement for assistive technology while the block is still growing. */
  runningLabel: string;
}

/**
 * Render one assistant reasoning block collapsed until the reader opens it. The
 * collapsed summary omits double-asterisk markers; the expanded content renders
 * the complete Markdown with secondary typography.
 */
export const ReasoningRow = memo(function ReasoningRow({
  text,
  running,
  expanded,
  onToggle,
  settledPreview,
  title,
  runningLabel,
}: ReasoningRowProps) {
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text);
  const summary = useMemo(() => summaryText.replaceAll("**", ""), [summaryText]);
  const preview = !expanded && summary !== "" && (running || settledPreview);
  const collapsedContent = useMemo(
    () => (
      <>
        <span className="dsh-row-separator" data-shimmer-decoration="" aria-hidden="true" />
        <span className="dsh-reasoning-summary" data-streaming={running || undefined}>
          <span className="dsh-reasoning-summary-text">
            <TextShimmer>{summary}</TextShimmer>
          </span>
        </span>
      </>
    ),
    [running, summary],
  );
  const content = expanded ? (
    <div className="dsh-think-body">
      <MarkdownBody isStreaming={running} variant="compact">
        {text}
      </MarkdownBody>
    </div>
  ) : undefined;

  return (
    <div
      className="dsh-reasoning-row"
      data-variant="think"
      data-state={running ? "running" : "ok"}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      {running && <span className="dsh-visually-hidden">{runningLabel}</span>}
      <DisclosureRow
        rowClassName="dsh-reasoning-disclosure"
        leadingClassName="dsh-reasoning-leading"
        titleClassName="dsh-reasoning-title"
        icon={<Brain size={14} strokeWidth={1.6} aria-hidden="true" />}
        title={title}
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={onToggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  );
});
