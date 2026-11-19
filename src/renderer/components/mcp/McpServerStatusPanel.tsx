import { Server, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { McpInstanceSnapshot, McpPanelSnapshot } from "@contract/mcp";
import { useI18n } from "@/i18n";
import { call, subscribe } from "@/lib/api-client";
import { scaledChatFont } from "@/lib/chat-appearance";
import { mcpStateLabel } from "@/lib/mcp-state-label";

type ServerStatus = Pick<McpInstanceSnapshot, "name" | "state"> & { toolCount?: number };
type ServerList = {
  servers: ServerStatus[];
  inactiveReason?: McpPanelSnapshot["inactiveReason"];
  projectTrusted?: boolean;
  error?: string;
};

async function loadServerList(sessionId: string | null, cwd?: string): Promise<ServerList> {
  const panel = sessionId ? await call("mcp.snapshot", { sessionId }) : undefined;
  if (panel?.adapterActive) {
    return { servers: panel.instances, projectTrusted: panel.projectTrusted, error: panel.error };
  }
  const config = await call("mcp.config.get", cwd ? { scope: "project", cwd } : { scope: "global" });
  return {
    servers: config.entries.map(({ name, config }) => ({
      name,
      state: config.enabled === false ? "disabled" : "not-started",
    })),
    inactiveReason: panel?.inactiveReason,
    error: config.error ?? panel?.error,
  };
}

export function McpServerStatusPanel({
  sessionId,
  cwd,
  onClose,
  onOpenSettings,
}: {
  sessionId: string | null;
  cwd?: string;
  onClose(): void;
  onOpenSettings(): void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<ServerList>();
  useEffect(() => {
    let active = true;
    let request = 0;
    let unsubscribe: (() => void) | undefined;
    const refresh = async () => {
      const ticket = ++request;
      try {
        const result = await loadServerList(sessionId, cwd);
        if (active && request === ticket) setList(result);
      } catch (error) {
        if (active && request === ticket) {
          setList({ servers: [], error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    setList(undefined);
    void refresh();
    if (sessionId) {
      void subscribe("mcp.changed", sessionId, () => {
        if (active) void refresh();
      })
        .then((off) => {
          if (!active) off();
          else {
            unsubscribe = off;
            void refresh();
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [cwd, sessionId]);

  const title = t("mcpSettings", "MCP servers");
  const settings = t("mcpOpenSettings", "Open MCP settings");
  const close = t("close", "Close");
  const status =
    list?.inactiveReason === "disabled"
      ? t("mcpDisabledBySettings", "builtin:mcp is disabled in shared settings.")
      : list?.inactiveReason === "replaced"
        ? t(
            "mcpReplacedByExtension",
            "Another extension manages MCP in this session. Desktop connection controls are inactive.",
          )
        : list?.projectTrusted === false
          ? t("mcpProjectUntrusted", "This project's MCP configuration is not applied until the project is trusted.")
          : undefined;
  return (
    <section
      data-mcp-server-list
      aria-label={title}
      className="relative z-10 mb-2 rounded-2xl border border-border bg-bg-panel text-text"
      style={{ fontSize: scaledChatFont(12) }}
    >
      <header className="flex min-h-9 items-center gap-2 border-b border-border px-3 py-1 text-text-muted">
        <Server size={14} aria-hidden="true" className="shrink-0" />
        <h2 className="mr-auto font-medium">{title}</h2>
        <button
          type="button"
          aria-label={settings}
          title={settings}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-bg-hover"
          onClick={onOpenSettings}
        >
          <Settings2 size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={close}
          title={close}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-bg-hover"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div
        className="slash-menu-scroll max-h-[min(200px,22vh)] overflow-auto overscroll-contain px-3 py-1.5"
        aria-busy={!list}
      >
        {!list && <p role="status">{t("loading", "Loading…")}</p>}
        {list?.error && (
          <p role="alert" className="break-words py-1">
            {list.error}
          </p>
        )}
        {status && <p className="py-1 text-text-muted">{status}</p>}
        {list && !list.error && !list.servers.length && (
          <p className="py-1 text-text-muted">{t("mcpNoServers", "No MCP servers configured.")}</p>
        )}
        {list?.servers.length ? (
          <ul className="divide-y divide-border">
            {list.servers.map(({ name, state, toolCount }) => (
              <li key={name} className="flex flex-wrap items-center gap-x-2.5 py-2">
                <span className="break-all font-semibold">{name}</span>
                <span className="inline-flex items-center gap-1.5 text-text-muted">
                  <span className={`mcp-status-dot is-${state}`} aria-hidden="true" />
                  {mcpStateLabel(state, t)}
                </span>
                {state === "connected" && toolCount !== undefined && (
                  <span className="text-text-dim" style={{ fontSize: scaledChatFont(11) }}>
                    {t("mcpServerToolCount", "{count} tools").replace("{count}", String(toolCount))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
