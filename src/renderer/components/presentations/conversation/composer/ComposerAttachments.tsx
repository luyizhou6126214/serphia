import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { LocalFileInspection } from "@contract/desktop";
import type { AttachedImage } from "@/hooks/useComposerDraft";
import { useI18n } from "@/i18n";
import { localFilePathKey, type LocalFileReference } from "@/lib/file-url";
import { getFileIcon } from "@/components/FileIcons";

interface Props {
  images: readonly AttachedImage[];
  files: readonly LocalFileReference[];
  fileInspectionByPath: ReadonlyMap<string, Pick<LocalFileInspection, "exists" | "insideCwd">>;
  cwd?: string | null;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onFileMenuError: (notice: string) => void;
}

export function ComposerAttachments({
  images,
  files,
  fileInspectionByPath,
  cwd,
  onRemoveImage,
  onRemoveFile,
  onFileMenuError,
}: Props) {
  const { t, language } = useI18n();
  const [previewImage, setPreviewImage] = useState<AttachedImage | null>(null);
  const activePreview = previewImage && images.includes(previewImage) ? previewImage : null;
  const previewDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = previewDialog.current;
    if (activePreview && dialog && !dialog.open) dialog.showModal();
  }, [activePreview]);

  async function openFileMenu(event: MouseEvent<HTMLButtonElement>, path: string) {
    event.preventDefault();
    try {
      const result = await window.piBridge.showFileContextMenu({
        href: path,
        cwd: cwd ?? undefined,
        source: "local-file-reference",
        language,
      });
      if (result.shown) return;
    } catch {
      // A failed or unavailable native menu uses the same composer notice.
    }
    onFileMenuError(t("fileContextMenuUnavailable", "The file menu could not be opened."));
  }

  if (!images.length && !files.length) return null;

  const previewLabel = t("composerImagePreview", "Preview image");
  const removeLabel = t("remove", "Remove");
  const closeLabel = t("close", "Close");

  return (
    <div className="ppt-composer-attachments">
      <div className="ppt-composer-attachment-list">
        {images.map((image, index) => (
          <div className="ppt-composer-attachment-card" key={index}>
            <button
              type="button"
              className="ppt-composer-attachment-content ppt-composer-attachment-image"
              title={previewLabel}
              aria-label={`${previewLabel} ${index + 1}`}
              aria-haspopup="dialog"
              onClick={() => setPreviewImage(image)}
            >
              <img src={image.previewUrl} alt="" />
            </button>
            <button
              type="button"
              className="ppt-composer-attachment-remove"
              title={removeLabel}
              aria-label={`${removeLabel} · ${t("messageImageAttachment", "Image attachment")} ${index + 1}`}
              onClick={() => onRemoveImage(index)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
        {files.map((file, index) => {
          const inspection = fileInspectionByPath.get(localFilePathKey(file.path));
          const missing = inspection?.exists === false;
          const outsideProject = inspection?.insideCwd === false;
          const status = missing
            ? t("composerFileUnavailable", "File unavailable")
            : outsideProject
              ? t("outsideProject", "Outside project")
              : undefined;

          return (
            <div className="ppt-composer-attachment-card" data-missing={missing || undefined} key={file.path}>
              <button
                type="button"
                className="ppt-composer-attachment-content ppt-composer-attachment-file"
                title={status ? `${file.path} — ${status}` : file.path}
                onClick={() => void window.piBridge?.showItemInFolder?.(file.path)}
                onContextMenu={(event) => void openFileMenu(event, file.path)}
              >
                <span aria-hidden="true">{getFileIcon(file.name, 27)}</span>
                <span className="ppt-composer-attachment-filename" dir="auto">
                  {file.name}
                </span>
                {status && <CircleAlert className="ppt-composer-attachment-status" size={13} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="ppt-composer-attachment-remove"
                title={removeLabel}
                aria-label={`${removeLabel} · ${file.name}`}
                onClick={() => onRemoveFile(index)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {files.length > 0 && (
        <div className="ppt-composer-attachment-privacy">
          {t(
            "localFileDraftPrivacy",
            "Local file paths stay on this device and are saved with this session draft until it is sent or removed.",
          )}
        </div>
      )}
      {activePreview && (
        <dialog
          className="ppt-composer-image-preview"
          ref={previewDialog}
          closedby="any"
          aria-label={previewLabel}
          onClose={() => setPreviewImage(null)}
        >
          <div className="ppt-composer-image-preview-toolbar">
            <button
              type="button"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={() => previewDialog.current?.close()}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>
          <img src={activePreview.previewUrl} alt={t("messageImageAttachment", "Image attachment")} />
        </dialog>
      )}
    </div>
  );
}
