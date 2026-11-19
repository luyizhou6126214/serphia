import { DownOutlined } from "@ant-design/icons/es";
import { useId, useRef, type ReactNode } from "react";

export function McpActionMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="mcp-action-menu">
      <button
        ref={trigger}
        type="button"
        className="mcp-menu-trigger"
        popoverTarget={id}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          const menu = event.currentTarget.ownerDocument.getElementById(id);
          if (!menu) return;
          event.preventDefault();
          if (!menu.matches(":popover-open")) event.currentTarget.click();
          menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        }}
      >
        {label}
        <DownOutlined className="mcp-menu-chevron" aria-hidden="true" />
      </button>
      <div
        id={id}
        className="mcp-menu"
        popover="auto"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          if (!items.length) return;
          event.preventDefault();
          const index = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? index + 1 : index < 0 ? items.length - 1 : index - 1;
          items[(next + items.length) % items.length]?.focus();
        }}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button:not(:disabled)")) {
            event.currentTarget.hidePopover();
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
