import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewCommandOutput, ReviewExportFormat } from "../../contract/code-review";
import { ReviewError } from "./output";
import { sessionId } from "./scope";

export const MAX_REPORT_BYTES = 8 * 1024 * 1024;

function reportPath(home: string, root: string, id: string) {
  const key = createHash("sha256").update(root).digest("hex");
  return path.join(home, ".opencodereview", "serphia-reports", key, sessionId(id) + ".json");
}

export async function saveReport(home: string, root: string, id: string, report: string) {
  const target = reportPath(home, root, id);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, report, { mode: 0o600, flag: "wx" });
}

export async function readReport(home: string, root: string, id: string) {
  return readFile(reportPath(home, root, id), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
}

export async function deleteReport(home: string, root: string, id: string) {
  await rm(reportPath(home, root, id), { force: true });
}

type Comment = {
  path?: string;
  start_line?: number;
  end_line?: number;
  severity?: string;
  category?: string;
  content?: string;
  existing_code?: string;
  suggestion_code?: string;
};
type Report = {
  status?: string;
  message?: string;
  session_id?: string;
  summary?: unknown;
  manifest?: { terminal_state?: string };
  warnings?: { message?: string }[];
  comments: Comment[];
};

const categories = ["bug", "security", "performance", "maintainability", "test", "style", "documentation", "other"];
const terminal = (report: Report) => report.manifest?.terminal_state ?? report.status ?? "saved";
const locationLine = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const clearControls = (value: string) =>
  [...value]
    .filter(
      (character) =>
        character === "\n" || character === "\t" || (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
    )
    .join("");

function asText(report: Report) {
  const lines = [`Open Code Review · ${terminal(report)} · ${report.comments.length} finding(s)`];
  if (report.session_id) lines.push(`Session: ${report.session_id}`);
  if (report.message) lines.push(report.message);
  for (const comment of report.comments) {
    const { path, start_line, end_line, severity, category, content, existing_code, suggestion_code } = comment;
    lines.push(
      "",
      [path, start_line, end_line !== start_line ? end_line : undefined].filter(Boolean).join(":"),
      [severity, category].filter(Boolean).join(" · "),
      content ?? "",
    );
    if (suggestion_code) {
      if (existing_code) for (const line of existing_code.split("\n")) lines.push("- " + line);
      for (const line of suggestion_code.split("\n")) lines.push("+ " + line);
    }
  }
  for (const warning of report.warnings ?? []) {
    if (warning.message) lines.push("", "Warning: " + warning.message);
  }
  return clearControls(lines.join("\n")) + "\n";
}

function asSarif(report: Report, version: string) {
  const fingerprints = new Map<string, number>();
  const results = report.comments.map((comment) => {
    const { path, start_line, end_line, existing_code, suggestion_code } = comment;
    const ruleId = categories.includes(comment.category ?? "") ? comment.category! : "other";
    const level = ["high", "critical"].includes(comment.severity ?? "")
      ? "error"
      : comment.severity === "medium"
        ? "warning"
        : "note";
    const region =
      locationLine(start_line) && locationLine(end_line) && end_line >= start_line
        ? { startLine: start_line, endLine: end_line }
        : undefined;
    const artifactLocation = path
      ? { uri: path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/") }
      : null;
    const hash = createHash("sha256")
      .update([path ?? "", ruleId, existing_code?.trim() || (start_line ?? 0)].join("|"))
      .digest("hex");
    const count = fingerprints.get(hash) ?? 0;
    fingerprints.set(hash, count + 1);
    return {
      ruleId,
      level,
      message: { text: comment.content ?? "" },
      partialFingerprints: { "ocrFinding/v1": count ? hash + "#" + count : hash },
      ...(artifactLocation && { locations: [{ physicalLocation: { artifactLocation, region } }] }),
      ...(artifactLocation &&
        region &&
        suggestion_code &&
        existing_code && {
          fixes: [
            {
              artifactChanges: [
                {
                  artifactLocation,
                  replacements: [{ deletedRegion: region, insertedContent: { text: suggestion_code } }],
                },
              ],
            },
          ],
        }),
    };
  });
  const status = terminal(report);
  const warnings = [
    ...(["complete", "saved", "completed"].includes(status) ? [] : [report.message ?? `Review status: ${status}`]),
    ...(report.warnings ?? []).flatMap(({ message }) => (message ? [message] : [])),
  ];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "OpenCodeReview",
            version,
            informationUri: "https://github.com/alibaba/open-code-review",
            rules: categories.map((id) => ({ id })),
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: !["failed", "cancelled", "aborted"].includes(status),
            ...(warnings.length && {
              toolExecutionNotifications: warnings.map((text) => ({ level: "warning", message: { text } })),
            }),
          },
        ],
      },
    ],
  };
}

export function formatReport(
  raw: string,
  format: Exclude<ReviewExportFormat, "html">,
  version: string,
): ReviewCommandOutput {
  if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) throw new ReviewError("scopeLimit");
  const report: Report = JSON.parse(raw);
  if (!report || !Array.isArray(report.comments)) throw new ReviewError("invalidOutput");
  switch (format) {
    case "json":
      return { text: raw, filename: "code-review.json" };
    case "text":
      return { text: asText(report), filename: "code-review.txt" };
    case "sarif":
      return { text: JSON.stringify(asSarif(report, version), null, 2) + "\n", filename: "code-review.sarif" };
  }
}

export function reportFromSession(detail: string, findings: string) {
  const { summary } = JSON.parse(detail);
  const comments: unknown = JSON.parse(findings);
  if (!summary || !Array.isArray(comments)) throw new ReviewError("invalidOutput");
  return (
    JSON.stringify(
      {
        status: summary.aborted ? "aborted" : "saved",
        session_id: summary.session_id,
        summary,
        manifest: summary.run_manifest,
        comments,
      },
      null,
      2,
    ) + "\n"
  );
}
