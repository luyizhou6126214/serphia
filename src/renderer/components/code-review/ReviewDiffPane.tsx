import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, ChevronDown, FileCode2 } from "lucide-react";
import type { ReviewDiff, ReviewFinding, ReviewHistoryRef, ReviewRequest } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { reviewIssueText, severityText } from "./copy";
import { useReviewEntrance } from "./useReviewMotion";

type Line = { kind: "hunk" | "addition" | "deletion" | "context" | "meta"; old?: number; next?: number; text: string };

function parseLines(text: string, scan: boolean): Line[] {
  let before = 0;
  let after = 0;
  let inHunk = false;
  const source = text.replace(/\n$/u, "").split("\n");
  return source.map((line, index) => {
    if (scan) return { kind: "context", next: index + 1, text: line };
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text: line };
    }
    if (line.startsWith("diff --git ")) inHunk = false;
    if (!inHunk) return { kind: "meta", text: line };
    if (line.startsWith("+")) return { kind: "addition", next: after++, text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "deletion", old: before++, text: line.slice(1) };
    if (line.startsWith(" ")) return { kind: "context", old: before++, next: after++, text: line.slice(1) };
    return { kind: "meta", text: line };
  });
}

function ReviewComment({
  finding,
  openFile,
  showLocation,
}: {
  finding: ReviewFinding;
  openFile?: () => void;
  showLocation?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const suggestion = useRef<HTMLPreElement>(null);
  useReviewEntrance(suggestion, expanded);
  return (
    <article className="cr-comment">
      <header>
        <span className="cr-severity" data-severity={finding.severity}>
          {severityText(finding.severity, t)}
        </span>
        {finding.category && <span>{finding.category}</span>}
        {showLocation && finding.line !== null && (
          <span>
            L{finding.line}
            {finding.endLine && finding.endLine !== finding.line ? `–${finding.endLine}` : ""}
          </span>
        )}
        {openFile && (
          <button
            type="button"
            className="cr-control cr-comment-link"
            onClick={openFile}
            aria-label={t("reviewOpenFile", "Open file")}
          >
            <ArrowUpRight size={14} />
          </button>
        )}
      </header>
      <p>{finding.message}</p>
      {finding.suggestion && (
        <button
          type="button"
          className="cr-control cr-suggestion"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={13} />
          {t("reviewSuggestedChange", "Suggested change")}
        </button>
      )}
      {expanded && <pre ref={suggestion}>{finding.suggestion}</pre>}
    </article>
  );
}

export function ReviewDiffPane({
  request,
  revision,
  file,
  findings,
  onOpenFinding,
  historyRef,
}: {
  request: ReviewRequest;
  revision?: string;
  file: string;
  findings: ReviewFinding[];
  onOpenFinding?: (finding: ReviewFinding) => void;
  historyRef?: ReviewHistoryRef;
}) {
  const { t } = useI18n();
  const [diff, setDiff] = useState<ReviewDiff | null | undefined>();
  const [error, setError] = useState("");
  const key = JSON.stringify({ ...request, path: file, historyRef });
  useEffect(() => {
    let current = true;
    setDiff(undefined);
    setError("");
    const { historyRef: ref, ...args } = JSON.parse(key) as ReviewRequest & {
      path: string;
      historyRef?: ReviewHistoryRef;
    };
    const result = ref ? call("codeReview.history.diff", { ref, path: args.path }) : call("codeReview.diff", args);
    void result
      .then((result) => {
        if (!current) return;
        if (result.ok) setDiff(result.value);
        else setError(reviewIssueText(result.issue, t));
      })
      .catch(() => {
        if (current) setError(t("reviewErrorOutput", "The review engine returned an unreadable result."));
      });
    return () => {
      current = false;
    };
  }, [key, revision, t]);
  const lines = useMemo(
    () =>
      diff?.text
        ? parseLines(diff.text, request.scope.kind === "scan").filter(
            (line) => line.kind !== "meta" || !/^(?:diff --git |index |--- |\+\+\+ )/u.test(line.text),
          )
        : [],
    [diff, request.scope.kind],
  );
  const gutterDigits = useMemo(
    () => String(lines.reduce((maximum, line) => Math.max(maximum, line.old ?? 0, line.next ?? 0), 99)).length,
    [lines],
  );
  const comments = useMemo(() => {
    const map = new Map<number, ReviewFinding[]>();
    const unplaced: ReviewFinding[] = [];
    const visible = new Set(lines.map((line) => line.next));
    for (const finding of findings) {
      if (finding.line === null || !visible.has(finding.line)) unplaced.push(finding);
      else {
        const group = map.get(finding.line) ?? [];
        group.push(finding);
        map.set(finding.line, group);
      }
    }
    return { map, unplaced };
  }, [findings, lines]);

  return (
    <div className="cr-patch">
      <div className="cr-file-heading">
        <FileCode2 size={16} />
        <strong>{file}</strong>
      </div>
      {!diff && (
        <p className="cr-inline-message" role={error ? "alert" : "status"}>
          {error ||
            (diff === null
              ? t("reviewHistoryMissingDiff", "This review did not save a snapshot for this file.")
              : t("reviewLoadingDiff", "Loading changes…"))}
        </p>
      )}
      {diff?.truncated && (
        <p className="cr-inline-message">{t("reviewDiffTruncated", "Showing a limited preview of this file.")}</p>
      )}
      {diff && !lines.length && !diff.truncated && (
        <p className="cr-inline-message">{t("reviewNoDiff", "No text changes to display.")}</p>
      )}
      <div className="cr-code" style={{ "--cr-line-digits": gutterDigits } as CSSProperties}>
        {lines.map((line, index) =>
          line.kind === "meta" || line.kind === "hunk" ? (
            <div className="cr-code-meta" data-line={line.kind} key={index}>
              {line.text}
            </div>
          ) : (
            <div className="cr-code-block" key={index}>
              <div className="cr-code-line" data-line={line.kind}>
                <span>{line.old}</span>
                <span>{line.next}</span>
                <i aria-hidden="true">{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : ""}</i>
                <code>{line.text || " "}</code>
              </div>
              {line.next &&
                comments.map
                  .get(line.next)
                  ?.map((finding) => (
                    <ReviewComment
                      key={finding.id}
                      finding={finding}
                      openFile={onOpenFinding && (() => onOpenFinding(finding))}
                    />
                  ))}
            </div>
          ),
        )}
      </div>
      {comments.unplaced.map((finding) => (
        <ReviewComment
          key={finding.id}
          finding={finding}
          showLocation={Boolean(historyRef)}
          openFile={onOpenFinding && (() => onOpenFinding(finding))}
        />
      ))}
    </div>
  );
}
