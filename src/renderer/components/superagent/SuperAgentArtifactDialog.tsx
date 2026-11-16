import { FileDiff, X } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import type { ApiResult } from "@contract/api";
import type { SuperAgentTaskArtifact } from "@contract/superagent";

type Artifact = ApiResult<"superagent.rooms.artifact"> | SuperAgentTaskArtifact;
export type ArtifactPreview = { name: string; data: Artifact; opener: HTMLButtonElement };

export function ArtifactDialog({
  artifact,
  zh,
  onClose,
}: {
  artifact: ArtifactPreview;
  zh: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const { opener } = artifact;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  const close = zh ? "关闭差异" : "Close diff";
  const files =
    "status" in artifact.data
      ? artifact.data.status.entries.map((item) => ({ path: item.path, mark: item.index + item.workingTree }))
      : artifact.data.paths.map((path) => ({ path, mark: "" }));
  return (
    <dialog
      ref={ref}
      className="superagent-artifact"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="sa-card-heading">
        <h3 id={title}>
          <FileDiff size={16} aria-hidden="true" />
          {artifact.name} · Diff
        </h3>
        <button type="button" className="sa-icon-button" aria-label={close} title={close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="sa-diff-content">
        {files.map((file) => (
          <div key={file.path} className="sa-diff-file">
            {file.mark && <code>{file.mark}</code>}
            <span>{file.path}</span>
          </div>
        ))}
        {artifact.data.diff && (
          <pre tabIndex={0}>
            {artifact.data.diff.split(/(?<=\n)/u).map((line, index) => (
              <span
                key={index}
                data-change={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : undefined}
              >
                {line}
              </span>
            ))}
          </pre>
        )}
        {artifact.data.truncated && (
          <small>
            {("status" in artifact.data ? artifact.data.status.isGit : artifact.data.branch != null)
              ? zh
                ? "差异预览已截断"
                : "Diff preview truncated"
              : zh
                ? "部分文件仅列出变更状态"
                : "Some changes are listed without a text preview"}
          </small>
        )}
        {!artifact.data.diff && !files.length && <p>{zh ? "没有改动" : "No changes"}</p>}
      </div>
    </dialog>
  );
}
