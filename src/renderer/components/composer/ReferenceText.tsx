import { Fragment } from "react";
import { Box, Server } from "lucide-react";
import SiReact from "@icons-pack/react-simple-icons/icons/SiReact";
import SiRust from "@icons-pack/react-simple-icons/icons/SiRust";
import SiTypescript from "@icons-pack/react-simple-icons/icons/SiTypescript";
import SiJavascript from "@icons-pack/react-simple-icons/icons/SiJavascript";
import SiPython from "@icons-pack/react-simple-icons/icons/SiPython";
import SiGo from "@icons-pack/react-simple-icons/icons/SiGo";
import { getFileIcon } from "../FileIcons";

export interface ReferenceRange {
  start: number;
  end: number;
  text: string;
}

export function getReferenceRanges(text: string, requireTerminator = false): ReferenceRange[] {
  const pattern = /(^|\s)(\/(?:skill:[^\s]+|mcp(?:[:/][^\s]+)?)|@(?:"[^"\n]+"|[^\s"@]+))/g;
  const ranges: ReferenceRange[] = [];
  for (const match of text.matchAll(pattern)) {
    const token = match[2];
    const start = match.index + match[1].length;
    const end = start + token.length;
    if (!requireTerminator || end < text.length) ranges.push({ start, end, text: token });
  }
  return ranges;
}

/** Move across a reference in one step, including when the caret is inside it. */
export function referenceCursorDestination(text: string, position: number, direction: "left" | "right") {
  const range = getReferenceRanges(text, true).find((item) =>
    direction === "left"
      ? position > item.start && position <= item.end
      : position >= item.start && position < item.end,
  );
  return range ? (direction === "left" ? range.start : range.end) : null;
}

/** Find the whole rendered token touched by a deletion, including a partial selection. */
export function referenceDeletionRange(text: string, start: number, end: number, key: "Backspace" | "Delete") {
  const ranges = getReferenceRanges(text, true);
  if (start === end) {
    const range = ranges.find((item) =>
      key === "Backspace"
        ? (start > item.start && start <= item.end) || (start === item.end + 1 && text[item.end] === " ")
        : start >= item.start && start < item.end,
    );
    return range ? { start: range.start, end: Math.max(end, range.end) } : null;
  }
  let from = start;
  let to = end;
  for (const range of ranges) {
    if (range.start < to && range.end > from) {
      from = Math.min(from, range.start);
      to = Math.max(to, range.end);
    }
  }
  return from !== start || to !== end ? { start: from, end: to } : null;
}

/** Preserve the exact source text so editing, copying and submission stay lossless. */
export function ReferenceText({ text, requireTerminator = false }: { text: string; requireTerminator?: boolean }) {
  const parts: React.ReactNode[] = [];
  let end = 0;
  for (const range of getReferenceRanges(text, requireTerminator)) {
    const { start, end: tokenEnd, text: token } = range;
    parts.push(text.slice(end, start));
    const kind = token.startsWith("@") ? "file" : token.startsWith("/skill:") ? "skill" : "mcp";
    const filePath = kind === "file" ? token.slice(1).replace(/^"|"$/g, "") : "";
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const extension = fileName.split(".").pop()?.toLowerCase();
    const FileTypeIcon =
      extension === "tsx" || extension === "jsx"
        ? SiReact
        : extension === "rs"
          ? SiRust
          : extension === "ts"
            ? SiTypescript
            : extension === "js" || extension === "mjs" || extension === "cjs"
              ? SiJavascript
              : extension === "py"
                ? SiPython
                : extension === "go"
                  ? SiGo
                  : null;
    const prefixLength = kind === "skill" ? "/skill:".length : 1;
    parts.push(
      <span className="chat-reference-tag" data-reference-kind={kind} key={start}>
        <span className="chat-reference-prefix">
          {token.slice(0, prefixLength)}
          <span className="chat-reference-icon" aria-hidden="true">
            {kind === "file" ? (
              FileTypeIcon ? (
                <FileTypeIcon size={14} />
              ) : (
                getFileIcon(fileName, 14)
              )
            ) : kind === "skill" ? (
              <Box />
            ) : (
              <Server />
            )}
          </span>
        </span>
        {token.slice(prefixLength)}
      </span>,
    );
    end = tokenEnd;
  }
  parts.push(text.slice(end));
  return <Fragment>{parts}</Fragment>;
}
