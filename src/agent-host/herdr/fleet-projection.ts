import {
  HERDR_PROTOCOL_VERSION,
  isHerdrAgentKind,
  type HerdrAgentKindDisplay,
  type HerdrAgentState,
  type HerdrFleetSnapshot,
  type HerdrPane,
  type HerdrTab,
} from "../../contract/herdr";
import { HerdrBridgeError } from "./errors";
import { idField, isRecord, numberField, optionalStringField, type JsonRecord } from "./protocol-v20";

const MAX_WORKSPACES = 128;
const MAX_TABS = 512;
const MAX_PANES = 1_024;
const sessionReferences = new WeakMap<HerdrPane, string>();

export function getPaneSessionReference(pane: HerdrPane) {
  return sessionReferences.get(pane);
}

export function agentState(value: unknown): HerdrAgentState {
  return ["blocked", "working", "done", "idle", "unknown"].includes(String(value))
    ? (value as HerdrAgentState)
    : "unknown";
}

export function agentKind(value: unknown): HerdrAgentKindDisplay {
  const normalized = String(value ?? "unknown")
    .toLowerCase()
    .replace(/^qwen(?:[-_ ]?code)?$/, "qwen")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return isHerdrAgentKind(normalized) ? normalized : `unknown:${normalized || "agent"}`;
}

export function safeSessionDisplay(value: string, kind: "id" | "path"): string | undefined {
  if (!value) return undefined;
  if (kind === "path") {
    const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.at(-1)?.slice(0, 80);
  }
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function mapFleet(result: JsonRecord, previousRevision: number, sourceGeneration = 0): HerdrFleetSnapshot {
  if (result.type !== "session_snapshot" || !isRecord(result.snapshot)) {
    throw new HerdrBridgeError("HERDR_SCHEMA_INVALID", "Herdr snapshot response is invalid.");
  }
  const snapshot = result.snapshot;
  if (snapshot.protocol !== HERDR_PROTOCOL_VERSION) {
    throw new HerdrBridgeError(
      "HERDR_PROTOCOL_UNSUPPORTED",
      "The Herdr snapshot protocol is incompatible with this serphia release.",
    );
  }
  if (!Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.tabs) || !Array.isArray(snapshot.panes)) {
    throw new HerdrBridgeError("HERDR_SCHEMA_INVALID", "Herdr snapshot collections are invalid.");
  }
  if (
    snapshot.workspaces.length > MAX_WORKSPACES ||
    snapshot.tabs.length > MAX_TABS ||
    snapshot.panes.length > MAX_PANES
  ) {
    throw new HerdrBridgeError("HERDR_PROTOCOL_LIMIT_EXCEEDED", "Herdr snapshot exceeded object limits.");
  }
  const wireAgents = Array.isArray(snapshot.agents) ? snapshot.agents.filter(isRecord) : [];
  const agentsByPane = new Map(wireAgents.map((item) => [String(item.pane_id ?? ""), item]));
  const rects = new Map<string, NonNullable<HerdrPane["rect"]>>();
  if (Array.isArray(snapshot.layouts)) {
    for (const layout of snapshot.layouts.slice(0, MAX_TABS)) {
      if (!isRecord(layout) || !Array.isArray(layout.panes)) continue;
      for (const item of layout.panes.slice(0, MAX_PANES)) {
        if (!isRecord(item) || typeof item.pane_id !== "string" || !isRecord(item.rect)) continue;
        const { x, y, width, height } = item.rect;
        if (
          [x, y, width, height].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 65535) &&
          Number(width) > 0 &&
          Number(height) > 0
        )
          rects.set(item.pane_id, { x: Number(x), y: Number(y), width: Number(width), height: Number(height) });
      }
    }
  }
  const panes: HerdrPane[] = snapshot.panes.filter(isRecord).map((wire) => {
    const id = idField(wire, "pane_id");
    const wireAgent = agentsByPane.get(id);
    const detected = wireAgent ?? wire;
    const detectedName =
      optionalStringField(detected, "agent", 128) ?? optionalStringField(detected, "display_agent", 128);
    let session: { kind: "id" | "path"; displayValue?: string } | undefined;
    if (wireAgent && isRecord(wireAgent.agent_session)) {
      const kind =
        wireAgent.agent_session.kind === "path" ? "path" : wireAgent.agent_session.kind === "id" ? "id" : null;
      const value = typeof wireAgent.agent_session.value === "string" ? wireAgent.agent_session.value : "";
      if (kind) session = { kind, displayValue: safeSessionDisplay(value, kind) };
    }
    const pane: HerdrPane = {
      id,
      ...(rects.has(id) ? { rect: rects.get(id) } : {}),
      terminalId: idField(wire, "terminal_id"),
      workspaceId: idField(wire, "workspace_id"),
      tabId: idField(wire, "tab_id"),
      title:
        optionalStringField(wire, "label", 256) ??
        optionalStringField(wire, "title", 256) ??
        optionalStringField(wire, "terminal_title_stripped", 256),
      cwd: optionalStringField(wire, "cwd"),
      foregroundCwd: optionalStringField(wire, "foreground_cwd"),
      focused: wire.focused === true,
      alive: true,
      revision: numberField(wire, "revision"),
      ...(detectedName
        ? {
            agent: {
              name: wireAgent ? optionalStringField(wireAgent, "name", 256) : undefined,
              kind: agentKind(detectedName),
              state: agentState(detected.agent_status),
              ...(session ? { session } : {}),
              launchPending: wireAgent?.launch_pending === true,
              interactiveReady: wireAgent?.interactive_ready === true,
              stateChangeSeq:
                wireAgent && Number.isSafeInteger(wireAgent.state_change_seq)
                  ? Number(wireAgent.state_change_seq)
                  : undefined,
            },
          }
        : {}),
    };
    if (session && wireAgent && isRecord(wireAgent.agent_session)) {
      const reference = wireAgent.agent_session.value;
      if (typeof reference === "string" && reference.length <= 4096) sessionReferences.set(pane, reference);
    }
    return pane;
  });
  const paneIdsByTab = new Map<string, string[]>();
  for (const pane of panes) {
    const paneIds = paneIdsByTab.get(pane.tabId);
    if (paneIds) paneIds.push(pane.id);
    else paneIdsByTab.set(pane.tabId, [pane.id]);
  }
  const tabs = snapshot.tabs.filter(isRecord).map((wire) => {
    const id = idField(wire, "tab_id");
    return {
      id,
      workspaceId: idField(wire, "workspace_id"),
      name: optionalStringField(wire, "label", 256),
      focused: wire.focused === true,
      paneIds: paneIdsByTab.get(id) ?? [],
    };
  });
  const tabsByWorkspace = new Map<string, HerdrTab[]>();
  for (const tab of tabs) {
    const workspaceTabs = tabsByWorkspace.get(tab.workspaceId);
    if (workspaceTabs) workspaceTabs.push(tab);
    else tabsByWorkspace.set(tab.workspaceId, [tab]);
  }
  const workspaces = snapshot.workspaces.filter(isRecord).map((wire) => {
    const id = idField(wire, "workspace_id");
    const workspaceTabs = tabsByWorkspace.get(id) ?? [];
    const activeTab = workspaceTabs.find((tab) => tab.focused) ?? workspaceTabs[0];
    return {
      id,
      name: optionalStringField(wire, "label", 256),
      focused: wire.focused === true,
      rootPaneId: activeTab?.paneIds[0],
      tabs: workspaceTabs,
    };
  });
  return {
    sourceGeneration,
    revision: previousRevision + 1,
    receivedAt: Date.now(),
    stale: false,
    focusedWorkspaceId: typeof snapshot.focused_workspace_id === "string" ? snapshot.focused_workspace_id : undefined,
    focusedTabId: typeof snapshot.focused_tab_id === "string" ? snapshot.focused_tab_id : undefined,
    focusedPaneId: typeof snapshot.focused_pane_id === "string" ? snapshot.focused_pane_id : undefined,
    workspaces,
    panes,
  };
}
