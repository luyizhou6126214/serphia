import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SettingsTab } from "../components/SettingsConfig";
import { subscribe } from "@/lib/api-client";

export function openMcpSettings(sessionId: string | null): void {
  window.dispatchEvent(new CustomEvent("pi-desktop:open-mcp-settings", { detail: { sessionId } }));
}

export function useMcpServerListCommand(sessionId: string | null, show: () => void): void {
  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void subscribe("mcp.showServers", sessionId, () => {
      if (!disposed) show();
    })
      .then((value) => {
        if (disposed) value();
        else off = value;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      off?.();
    };
  }, [sessionId, show]);
}

export function useMcpSettingsRequests(
  open: Dispatch<SetStateAction<boolean>>,
  tab: Dispatch<SetStateAction<SettingsTab>>,
  session: Dispatch<SetStateAction<string | null>>,
  navigation: Dispatch<SetStateAction<number>>,
): void {
  useEffect(() => {
    const show = (event: Event) => {
      const id = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      session(typeof id === "string" ? id : null);
      tab("mcp");
      navigation((value) => value + 1);
      open(true);
    };
    window.addEventListener("pi-desktop:open-mcp-settings", show);
    return () => window.removeEventListener("pi-desktop:open-mcp-settings", show);
  }, [open, tab, session, navigation]);
}
