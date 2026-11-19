import { useEffect, useRef, useState } from "react";
import { Presentation, useCreatePresentationStore, useHistory, useSlide } from "@diceui/pptx";
import { Download, Redo2, Undo2 } from "lucide-react";
import type { PresentationFile } from "@contract/presentations";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { base64ToBlob } from "@/lib/file-blob";
import { createPresentationSaveQueue, type SaveStatus } from "./presentation-save-queue";

async function encodedDeck(bytes: Uint8Array) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)]));
  });
}

function Slides({ name, exportCopy, status }: { name: string; exportCopy: () => void; status: SaveStatus }) {
  const { t } = useI18n();
  const { total, index } = useSlide();
  const { canUndo, canRedo, undo, redo } = useHistory();
  return (
    <>
      <nav className="ppt-slide-list" aria-label={t("pptSlides", "Slides")}>
        <div className="ppt-column-heading">
          <h2>{t("pptSlides", "Slides")}</h2>
          <span>{total}</span>
        </div>
        <Presentation.ThumbnailList className="ppt-file-thumbnails" />
      </nav>
      <div className="ppt-center">
        <div className="ppt-toolbar">
          <button
            type="button"
            className="ppt-icon"
            aria-label={t("pptUndo", "Undo")}
            disabled={!canUndo}
            onClick={() => void undo()}
          >
            <Undo2 />
          </button>
          <button
            type="button"
            className="ppt-icon"
            aria-label={t("pptRedo", "Redo")}
            disabled={!canRedo}
            onClick={() => void redo()}
          >
            <Redo2 />
          </button>
          <button type="button" className="ppt-button ppt-header-actions" disabled={!total} onClick={exportCopy}>
            <Download />
            {t("pptExport", "Export PPTX")}
          </button>
        </div>
        <Presentation.Viewport autoFit autoFitPadding={16} className="ppt-file-viewport">
          <Presentation.Slide>
            <Presentation.Selection undoRedoShortcuts />
          </Presentation.Slide>
        </Presentation.Viewport>
        <footer className="ppt-stage-footer">
          <span>
            {index + 1} / {total} · {name}
          </span>
          <span role="status">
            {status.kind === "saved"
              ? t("pptSaved", "Saved locally")
              : status.kind === "saving"
                ? t("pptSaving", "Saving…")
                : t("pptSaveFailed", "Could not save")}
          </span>
        </footer>
      </div>
    </>
  );
}

export default function PowerPointEditor({
  file,
  sessionId,
  onEditing,
}: {
  file: PresentationFile;
  sessionId: string;
  onEditing: (path: string | null) => void;
}) {
  const { t } = useI18n();
  const store = useCreatePresentationStore();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const knownTime = useRef<number | null>(null);
  const queue = useRef<ReturnType<typeof createPresentationSaveQueue<number, string>> | null>(null);
  const dirty = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (dirty.current || knownTime.current === file.updatedAt) return;
    const load = async () => {
      setReady(false);
      setError("");
      const data = await call("files.download", { path: file.path, sourceSessionId: sessionId });
      const buffer = await base64ToBlob(data.base64, data.mime).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      if (!active) return;
      await store.load(buffer, { readOnly: false });
      if (!active) return;
      knownTime.current = file.updatedAt;
      queue.current = createPresentationSaveQueue<number, string>(
        hash,
        async (_revision, expectedHash) => {
          const base64 = await encodedDeck(await store.save());
          const saved = await call("presentations.saveFile", { sessionId, path: file.path, base64, expectedHash });
          knownTime.current = saved.updatedAt;
          return saved.hash;
        },
        (next) => {
          dirty.current = next.kind !== "saved";
          if (mounted.current) {
            onEditing(dirty.current ? file.path : null);
            setStatus(next);
          }
        },
      );
      setStatus({ kind: "saved" });
      setReady(true);
    };
    void load().catch((err) => {
      if (active) setError(String(err));
    });
    return () => {
      active = false;
    };
  }, [file.path, file.updatedAt, sessionId, store, onEditing, reload]);

  function reloadFile() {
    dirty.current = false;
    knownTime.current = null;
    onEditing(null);
    setReload((n) => n + 1);
  }
  async function exportCopy() {
    try {
      await window.piBridge.saveBinaryFile({ defaultPath: file.name, base64: await encodedDeck(await store.save()) });
    } catch (err) {
      setError(String(err));
    }
  }
  return (
    <Presentation.Provider store={store}>
      <Presentation.Root className="ppt-file-editor" onEdit={() => queue.current?.submit(store.getState().revision)}>
        {(error || status.kind === "failed") && (
          <div className="ppt-notice" role="alert">
            <span>{error || (status.kind === "failed" && status.message)}</span>
            <button
              className="ppt-button"
              onClick={() => (status.kind === "failed" ? void queue.current?.flush() : reloadFile())}
            >
              {t("pptRetry", "Retry")}
            </button>
            {status.kind === "failed" && (
              <button className="ppt-button" onClick={reloadFile}>
                {t("pptReloadSaved", "Discard edits and reload")}
              </button>
            )}
          </div>
        )}
        {ready ? (
          <Slides name={file.name} status={status} exportCopy={() => void exportCopy()} />
        ) : (
          !error && (
            <p className="ppt-empty-state" role="status">
              {t("pptLoading", "Loading presentations…")}
            </p>
          )
        )}
      </Presentation.Root>
    </Presentation.Provider>
  );
}
