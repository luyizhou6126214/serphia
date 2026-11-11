/**
 * One tool call as a DeepSeek Harness process row: a 24px disclosure header
 * with the business glyph, the tool title, a separator dot, and a filling
 * summary; the expanded body holds the call's arguments and result.
 */
import { memo, useMemo, type ReactNode } from "react";
import { Code2, FileText, Pencil, Search, Terminal, Wrench } from "lucide-react";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { DisclosureRow } from "./DisclosureRow";
import { TextShimmer } from "./TextShimmer";
import { ToolIoCard, PatchResultView } from "./ToolResultBody";
import { formatToolBody, toolRowModel, type ToolRowVariant } from "./tool-row-model";
import { ToolResultImages } from "../ToolResultImages";

const TOOL_ICONS: Record<ToolRowVariant, ReactNode> = {
  read: <FileText size={14} strokeWidth={1.6} aria-hidden="true" />,
  search: <Search size={14} strokeWidth={1.6} aria-hidden="true" />,
  bash: <Terminal size={14} strokeWidth={1.6} aria-hidden="true" />,
  write: <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />,
  edit: <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />,
  code: <Code2 size={14} strokeWidth={1.6} aria-hidden="true" />,
  others: <Wrench size={14} strokeWidth={1.6} aria-hidden="true" />,
};

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

export interface ToolCallRowProps {
  block: ToolCallContent;
  result: ToolResultMessage | undefined;
  /** Result text after the Herdr history-notice projection. */
  resultText: string | null;
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
  cwd?: string | undefined;
  home?: string | undefined;
  t: (key: string, fallback: string) => string;
  /** Optional in-card locale strings. */
  runningLabel: string;
  preparingLabel: string;
  inputLabel: string;
  outputLabel: string;
  stoppedLabel: string;
  /** Explanation shown when a settled call has no recorded result at all. */
  missingResultLabel: string;
  /** Tab id reported by a browser tool, surfaced as a jump-to-tab affordance. */
  browserTabId: string | null;
  browserSummary: string | null;
  onOpenBrowserTab?: ((tabId: string) => void) | undefined;
  /**
   * Whether the projected result text is a data-safety notice rather than the
   * tool's own output. A notice takes the summary slot so a reader sees it
   * without opening the row; ordinary output stays folded.
   */
  historyNotice?: boolean | undefined;
  showFullInput?: boolean | undefined;
}

/**
 * Render one tool call row. The collapsed header carries the argument summary;
 * the body appears only after the reader opens the row.
 */
export const ToolCallRow = memo(function ToolCallRow({
  block,
  result,
  resultText,
  running,
  expanded,
  onToggle,
  cwd,
  home,
  t,
  runningLabel,
  preparingLabel,
  inputLabel,
  outputLabel,
  stoppedLabel,
  missingResultLabel,
  browserTabId,
  browserSummary,
  onOpenBrowserTab,
  historyNotice = false,
  showFullInput = false,
}: ToolCallRowProps) {
  const model = useMemo(
    () =>
      toolRowModel(
        block.toolName,
        block.input,
        result === undefined ? undefined : { isError: result.isError ?? false, text: resultText },
        running,
        cwd,
        home,
        t,
      ),
    [block.input, block.toolName, cwd, home, result, resultText, running, t],
  );
  const variant = model.variant;
  const isError = model.state === "error";
  const isStopped = model.state === "stopped";
  const isRunning = model.state === "running" || model.state === "preparing";
  const inputRaw = model.bodyRaw;
  const outputText = model.output;
  const patch = !isError ? getResultPatch(result) : null;
  const expandable = inputRaw !== null || outputText !== null || result !== undefined;
  const open = expanded && expandable;
  const statusLabel =
    model.state === "preparing"
      ? preparingLabel
      : isRunning
        ? runningLabel
        : isError
          ? t("toolRowFailed", "Failed")
          : isStopped
            ? stoppedLabel
            : null;
  // A projected data-safety notice replaces the summary so it reaches the
  // reader without opening the row; ordinary output stays folded.
  const summaryText = isError
    ? (model.errorSummary ?? model.summary)
    : historyNotice
      ? firstLine(resultText ?? "")
      : !open && browserSummary
        ? browserSummary
        : model.summary;
  const showCode = variant === "code" && !showFullInput;
  const bodyText = useMemo(
    () => (open && inputRaw !== null ? (showFullInput ? inputRaw : formatToolBody(variant, inputRaw)) : null),
    [inputRaw, open, showFullInput, variant],
  );
  const ioInput = showCode ? null : bodyText;

  const collapsedContent = useMemo(
    () =>
      summaryText !== "" && (
        <>
          <span className="dsh-row-separator" data-shimmer-decoration="" aria-hidden="true" />
          <span className="dsh-tool-summary" data-error={isError || undefined} data-stopped={isStopped || undefined}>
            <TextShimmer>{summaryText}</TextShimmer>
          </span>
        </>
      ),
    [isError, isStopped, summaryText],
  );

  const expandedContent = open ? (
    <div className="dsh-tool-body-wrap">
      {patch !== null ? (
        <PatchResultView text={patch} />
      ) : (
        <>
          {showCode && bodyText !== null && (
            <pre className="dsh-tool-code" style={{ fontSize: scaledChatFont(12) }}>
              <code>{bodyText}</code>
            </pre>
          )}
          {(ioInput !== null || outputText !== null) && (
            <ToolIoCard
              input={ioInput}
              output={outputText}
              error={isError}
              inputLabel={inputLabel}
              outputLabel={outputLabel}
            />
          )}
        </>
      )}
      {/* A settled call whose result was never persisted explains the gap
          instead of leaving an empty body. */}
      {result === undefined && !isRunning && <p className="dsh-tool-missing-result">{missingResultLabel}</p>}
      {browserTabId !== null && onOpenBrowserTab !== undefined && (
        <button type="button" className="dsh-tool-open-browser" onClick={() => onOpenBrowserTab(browserTabId)}>
          {t("openInBrowser", "Open in Browser")} →
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <div className="dsh-tool-row" data-variant={variant} data-tool={block.toolName} data-state={model.state}>
      {statusLabel !== null && <span className="dsh-visually-hidden">{statusLabel}</span>}
      <DisclosureRow
        rowClassName="dsh-tool-disclosure"
        leadingClassName="dsh-tool-leading"
        titleClassName="dsh-tool-title"
        icon={TOOL_ICONS[variant]}
        title={model.title}
        running={isRunning}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={onToggle}
        collapsedContent={collapsedContent}
      >
        {expandedContent}
      </DisclosureRow>
      {/* Tool result images stay visible under the folded row: an image is the
          call's payload, not a detail behind a disclosure. */}
      {result !== undefined && <ToolResultImages content={result.content} />}
    </div>
  );
});

/** Unified patch text carried by an edit result's details. */
function getResultPatch(result: ToolResultMessage | undefined): string | null {
  if (!result) return null;
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  const patch = typeof record.patch === "string" ? record.patch : null;
  if (patch) return patch;
  const diff = typeof record.diff === "string" ? record.diff : null;
  return diff || null;
}

/** One-line result hint for the collapsed row of a browser tool. */
export function browserResultSummary(value: string, t: (key: string, fallback: string) => string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.inspectionId === "string" && typeof parsed.changed === "boolean") {
      const truncated = isRecord(parsed.truncated)
        ? Object.entries(parsed.truncated)
            .filter(([, entry]) => entry === true)
            .map(([key]) => key)
            .join(", ")
        : "";
      return parsed.changed
        ? interpolate(t("browserToolInspectChanged", "Page changed · generation {generation}{truncated}"), {
            generation: Number(parsed.generation ?? 0),
            truncated: truncated ? ` · truncated: ${truncated}` : "",
          })
        : interpolate(t("browserToolInspectUnchanged", "Page unchanged · generation {generation}"), {
            generation: Number(parsed.generation ?? 0),
          });
    }
    if (typeof parsed.differenceRatio === "number") {
      return interpolate(t("browserToolVisualDifference", "Visual difference: {percent}% · {pixels} pixels"), {
        percent: (parsed.differenceRatio * 100).toFixed(3),
        pixels: Number(parsed.differentPixels ?? 0).toLocaleString(),
      });
    }
    if (typeof parsed.total === "number" && typeof parsed.failed === "number" && isRecord(parsed.byResourceType)) {
      return interpolate(
        t("browserToolNetworkSummary", "Network: {total} requests · {failed} failed · {pending} pending"),
        {
          total: parsed.total,
          failed: parsed.failed,
          pending: Number(parsed.pending ?? 0),
        },
      );
    }
    if (Array.isArray(parsed.entries)) {
      return interpolate(t("browserToolConsoleSummary", "Console: {count} entries{truncated}"), {
        count: parsed.entries.length,
        truncated: parsed.truncated === true ? " · more available" : "",
      });
    }
  } catch {
    return null;
  }
  return null;
}

/** Tab id reported by a browser tool result, when it names one. */
export function browserTabIdFromResult(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { tabId?: unknown; id?: unknown };
    const tabId = typeof parsed.tabId === "string" ? parsed.tabId : typeof parsed.id === "string" ? parsed.id : null;
    return tabId && tabId.length <= 128 ? tabId : null;
  } catch {
    return null;
  }
}

export function isBrowserToolName(value: string): boolean {
  return value.startsWith("browser_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    values[key] === undefined ? match : String(values[key]),
  );
}
