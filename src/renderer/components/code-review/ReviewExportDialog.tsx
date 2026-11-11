import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { ReviewCommandOutput, ReviewExportFormat, ReviewRun } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { reviewIssueText } from "./copy";
import { ReviewSelect } from "./ReviewSelect";

export function saveReviewOutput({ text, filename }: ReviewCommandOutput) {
  const extension = filename?.split(".").pop();
  if (!filename || !extension) return Promise.resolve(null);
  return window.piBridge.saveFile({
    content: text,
    defaultPath: filename,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}

export function ReviewExportFormats({
  value,
  onChange,
  html = true,
  sarif = true,
}: {
  value: ReviewExportFormat;
  onChange: (format: ReviewExportFormat) => void;
  html?: boolean;
  sarif?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label>
      {t("reviewExportFormat", "Output format")}
      <ReviewSelect
        label={t("reviewExportFormat", "Output format")}
        value={value}
        onChange={(value) => onChange(value as ReviewExportFormat)}
      >
        <option value="text">{t("reviewPlainText", "Plain text (.txt)")}</option>
        <option value="json">JSON</option>
        {sarif && <option value="sarif">SARIF</option>}
        {html && <option value="html">HTML</option>}
      </ReviewSelect>
    </label>
  );
}

export function ReviewExportDialog({ run, cwd, onClose }: { run: ReviewRun; cwd: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<ReviewExportFormat>(run.sessionId ? "html" : "json");
  const [issue, setIssue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setIssue("");
    try {
      const result = await call("codeReview.command", {
        kind: "sessionExport",
        cwd,
        id: run.sessionId,
        runId: run.id,
        format,
      });
      if (!result.ok) setIssue(reviewIssueText(result.issue, t));
      else if (await saveReviewOutput(result.value)) onClose();
    } catch {
      setIssue(t("reviewExportError", "Could not export this review."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      className="cr-dialog cr-export-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="review-export-title"
    >
      <header>
        <h2 id="review-export-title">{t("reviewExport", "Export")}</h2>
        <button type="button" className="cr-control" aria-label={t("reviewClose", "Close")} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <form
        className="cr-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ReviewExportFormats value={format} onChange={setFormat} html={Boolean(run.sessionId)} />
        {issue && (
          <p className="cr-inline-message" role="alert">
            {issue}
          </p>
        )}
        <footer>
          <button type="submit" className="cr-control cr-primary" disabled={saving}>
            <Download size={14} />
            {t("reviewSaveOutput", "Save output")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
