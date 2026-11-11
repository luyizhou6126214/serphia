import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReviewMcpSnapshot } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { reviewIssueText } from "./copy";

const example = JSON.stringify(
  {
    docs: {
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer $DOCS_MCP_TOKEN" },
      tools: ["lookup"],
    },
    local: { type: "stdio", command: "/path/to/mcp-server", args: [], env: [], setup: "" },
  },
  null,
  2,
);

export function ReviewMcpDialog({ running, onClose }: { running: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<ReviewMcpSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let current = true;
    void call("codeReview.mcp.get")
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setStatus(reviewIssueText(result.issue, t));
          return;
        }
        setSaved(result.value);
        setDraft(result.value.text);
        setStatus("");
      })
      .catch(() => {
        if (current) setStatus(t("reviewMcpLoadError", "Could not read the OCR MCP configuration."));
      });
    return () => {
      current = false;
    };
  }, [revision, t]);

  async function save() {
    if (!saved || busy || running) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await call("codeReview.mcp.save", { revision: saved.revision, text: draft });
      if (result.ok) {
        setSaved(result.value);
        setDraft(result.value.text);
        setStatus(t("reviewMcpSaved", "OCR MCP configuration saved."));
      } else setStatus(reviewIssueText(result.issue, t));
    } catch {
      setStatus(t("reviewMcpSaveError", "Could not save the OCR MCP configuration."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog className="cr-dialog cr-mcp-dialog" ref={dialog} onCancel={onClose} aria-labelledby="review-mcp-title">
      <header>
        <h2 id="review-mcp-title">{t("reviewMcp", "OCR MCP")}</h2>
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
        <p className="cr-dialog-description">
          {t(
            "reviewMcpDescription",
            "These servers are available to OCR during workspace, branch, and commit reviews. Local commands and setup run in the selected worktree.",
          )}
        </p>
        <label>
          {t("reviewMcpServers", "MCP servers (JSON)")}
          <textarea
            className="cr-mcp-editor"
            spellCheck={false}
            rows={12}
            maxLength={262144}
            disabled={!saved || busy || running}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <details className="cr-mcp-example">
          <summary>{t("reviewMcpExample", "Configuration example")}</summary>
          <pre className="cr-tool-output">{example}</pre>
        </details>
        {(status || running) && (
          <p className="cr-inline-message" role="status">
            {status || t("reviewErrorBusy", "A review is already running.")}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="cr-control"
            disabled={busy}
            onClick={() => setRevision((previous) => previous + 1)}
          >
            {t("reviewReload", "Reload")}
          </button>
          <button
            type="submit"
            className="cr-control cr-primary"
            disabled={!saved || saved.text === draft || busy || running}
          >
            {t("reviewMcpSave", "Save configuration")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
