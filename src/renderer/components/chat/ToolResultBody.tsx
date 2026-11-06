/**
 * Expanded tool-result bodies: the IN/OUT card for generic calls and the
 * side-by-side patch renderer for edit results. Moved out of MessageView so the
 * disclosure row and its body stay independently readable.
 */
import { memo, useMemo } from "react";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { scaledChatFont } from "@/lib/chat-appearance";

/**
 * Expanded input/output card: the payload text with a sticky gutter label per
 * section, capped so a long input never buries a short output.
 */
export function ToolIoCard({
  input,
  output,
  error,
  inputLabel,
  outputLabel,
}: {
  input: string | null;
  output: string | null;
  error: boolean;
  inputLabel: string;
  outputLabel: string;
}) {
  return (
    <div className="dsh-tool-io-card">
      {input !== null && (
        <div className="dsh-tool-io-section">
          <span className="dsh-tool-io-label">{inputLabel}</span>
          <span className="dsh-tool-io-text">{input}</span>
        </div>
      )}
      {input !== null && output !== null && <span className="dsh-tool-io-divider" aria-hidden="true" />}
      {output !== null && (
        <div className="dsh-tool-io-section">
          <span className="dsh-tool-io-label">{outputLabel}</span>
          <span className="dsh-tool-io-text" data-error={error || undefined}>
            {output}
          </span>
        </div>
      )}
    </div>
  );
}

/** Side-by-side before/after renderer for a unified edit patch. */
export const PatchResultView = memo(function PatchResultView({ text }: { text: string }) {
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;

  return (
    <div className="dsh-patch-scroll">
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          className="dsh-patch-file"
          style={{ borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)" }}
        >
          {showFileHeaders && (
            <div className="dsh-patch-headers">
              <PatchHeader title={file.oldPath || "Before"} side="left" />
              <PatchHeader title={file.newPath || "After"} side="right" />
            </div>
          )}

          <div className="dsh-patch-grid">
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") return null;
              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <PatchCellView cell={row.left} side="left" />
                  <PatchCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

function PatchHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div className="dsh-patch-header" data-side={side} title={title}>
      {title}
    </div>
  );
}

function PatchCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const background =
    cell.type === "added"
      ? "rgba(34,197,94,0.12)"
      : cell.type === "removed"
        ? "rgba(248,113,113,0.13)"
        : cell.type === "empty"
          ? "var(--bg-subtle)"
          : "transparent";
  const marker = cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "var(--success)" : cell.type === "removed" ? "var(--danger)" : "var(--text-dim)";

  return (
    <div
      className="dsh-patch-cell"
      data-side={side}
      style={{ background, borderRight: side === "left" ? "1px solid var(--border)" : "none" }}
    >
      <span className="dsh-patch-line-number">{cell.lineNo ?? ""}</span>
      <span className="dsh-patch-marker" style={{ color: markerColor }} data-kind={cell.type}>
        {marker}
      </span>
      <span className="dsh-patch-text" data-empty={cell.type === "empty" || undefined}>
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

/** Line-oriented fallback for a patch the parser cannot split. */
function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="dsh-patch-text-scroll" style={{ fontSize: scaledChatFont(12) }}>
      {lines.map((line, i) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+") && !line.startsWith("+++")
            ? "added"
            : line.startsWith("-") && !line.startsWith("---")
              ? "removed"
              : "context";
        const background =
          kind === "added"
            ? "rgba(34,197,94,0.12)"
            : kind === "removed"
              ? "rgba(248,113,113,0.13)"
              : kind === "hunk"
                ? "rgba(96,165,250,0.12)"
                : "transparent";
        const color =
          kind === "added"
            ? "var(--success)"
            : kind === "removed"
              ? "var(--danger)"
              : kind === "hunk"
                ? "var(--accent)"
                : "var(--text)";

        return (
          <div key={i} className="dsh-patch-text-row" data-kind={kind} style={{ background }}>
            <span className="dsh-patch-text-line-number">{i + 1}</span>
            <span className="dsh-patch-text-line" style={{ color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
