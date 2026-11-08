import { RefreshCw } from "lucide-react";
import { FileExplorer } from "@/components/FileExplorer";
import { useI18n } from "@/i18n";
import "./right-panel.css";

/**
 * The files panel: the workspace root with the listing's own refresh control,
 * then the tree. The tree keeps its own expanded state and mentions.
 */
export function FilesPanelBody({
  cwd,
  refreshKey,
  onRefresh,
  onOpenFile,
  onAtMention,
}: {
  cwd: string | null;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}) {
  const { t } = useI18n();
  if (cwd === null) {
    return <div className="rp-empty">{t("selectProjectToBrowseFiles", "Select a project to browse files")}</div>;
  }
  return (
    <div className="rp-body">
      <div className="rp-files-header">
        <span className="rp-files-root" title={cwd}>
          <span>{cwd}</span>
        </span>
        <button
          type="button"
          className="rp-icon-button"
          onClick={onRefresh}
          title={t("refreshExplorer", "Refresh explorer")}
          aria-label={t("refreshExplorer", "Refresh explorer")}
        >
          <RefreshCw size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      <div className="rp-body-scroll" style={{ paddingTop: 4 }}>
        <FileExplorer cwd={cwd} onOpenFile={onOpenFile} refreshKey={refreshKey} onAtMention={onAtMention} />
      </div>
    </div>
  );
}
