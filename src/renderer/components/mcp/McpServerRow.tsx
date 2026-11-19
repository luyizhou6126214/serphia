import { RightOutlined } from "@ant-design/icons/es";
import { useId, type ReactNode } from "react";
import { useI18n } from "@/i18n";

export function McpServerRow({
  name,
  metadata,
  busy,
  children,
  toggle,
  onExpand,
  onEdit,
}: {
  name: string;
  metadata: ReactNode;
  busy: boolean;
  children?: ReactNode;
  toggle?: ReactNode;
  onExpand(): void;
  onEdit(): void;
}) {
  const { t } = useI18n();
  const detailId = useId();
  return (
    <section className="mcp-server-row">
      <div className="mcp-row-head">
        <button
          type="button"
          className="mcp-row-trigger"
          aria-expanded={Boolean(children)}
          aria-controls={children ? detailId : undefined}
          onClick={onExpand}
        >
          <RightOutlined aria-hidden="true" />
          <span className="mcp-row-identity">
            <strong>{name}</strong>
            <span className="mcp-row-meta">{metadata}</span>
          </span>
        </button>
        <button type="button" className="mcp-edit-button" disabled={busy} onClick={onEdit}>
          {t("mcpEdit", "Edit")}
        </button>
        {toggle}
      </div>
      {children && (
        <div className="mcp-row-detail" id={detailId}>
          {children}
        </div>
      )}
    </section>
  );
}
