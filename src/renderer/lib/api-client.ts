/**
 * Transport facade — all renderer → Host communication goes through here.
 * Components call these helpers; they never touch MessagePort directly.
 */
import { createRpcClient, type PiRpc } from "@contract/rpc";
import type { ApiMethod, ApiParams, ApiResult, StreamTopic, Streams } from "@contract/api";
import type { HostStatus, PiBridge } from "@contract/desktop";
import type { AgentCommand } from "@contract/types";

let rpc: PiRpc | null = null;
let connection: { controller: AbortController; promise: Promise<PiRpc> } | null = null;

/** Drop RPC client so the next ensureRpc() re-connects (Host crash recovery). */
export function resetRpc(): void {
  connection?.controller.abort(new Error("Agent Host connection reset"));
  connection = null;
  rpc?.close();
  rpc = null;
}

const PORT_TIMEOUT_MS = 15_000;
const PING_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (timeout ${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Receive Host MessagePort transferred from preload via window.postMessage. */
function requestHostPort(bridge: PiBridge, signal: AbortSignal): Promise<MessagePort> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      window.removeEventListener("message", onMessage);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal.reason);
    const timer = setTimeout(() => fail(new Error("Timed out waiting for host MessagePort")), PORT_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      // Only accept messages from our own window (preload → page)
      if (event.source !== window) return;
      const data = event.data as { channel?: string } | string | null;
      const isPortMsg =
        data === "pi-desktop-host-port" || (typeof data === "object" && data?.channel === "pi-desktop-host-port");
      if (!isPortMsg) return;
      const port = event.ports[0];
      if (!port) return;
      cleanup();
      resolve(port);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    window.addEventListener("message", onMessage);
    try {
      bridge.requestHostPort();
    } catch (error) {
      fail(error);
    }
  });
}

function waitForHostReady(bridge: PiBridge, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let receivedStatus = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      off();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal.reason);
    const handleStatus = (status: HostStatus, detail?: string) => {
      if (status === "ready") {
        cleanup();
        resolve();
      } else if (status === "crashed" || status === "stopped") {
        fail(new Error(detail || `Agent Host ${status}`));
      }
    };

    const off = bridge.onHostStatus(({ status, detail }) => {
      receivedStatus = true;
      handleStatus(status, detail);
    });
    signal.addEventListener("abort", onAbort, { once: true });

    void bridge.getHostStatus().then((status) => {
      if (!receivedStatus && !signal.aborted) handleStatus(status);
    }, fail);
  });
}

async function connectToHost(signal: AbortSignal): Promise<PiRpc> {
  const bridge = window.piBridge;
  if (!bridge) throw new Error("Desktop bridge unavailable");
  await waitForHostReady(bridge, signal);
  const port = await requestHostPort(bridge, signal);
  const client = createRpcClient(port);
  const closeOnAbort = () => client.close();
  signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    signal.throwIfAborted();
    await withTimeout(client.call("host.ping"), PING_TIMEOUT_MS, "host.ping failed");
    signal.throwIfAborted();
    rpc = client;
    return client;
  } catch (error) {
    client.close();
    throw error;
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
  }
}

export async function ensureRpc(): Promise<PiRpc> {
  if (rpc) return rpc;
  if (connection) return connection.promise;

  const controller = new AbortController();
  const promise = connectToHost(controller.signal);
  connection = { controller, promise };
  try {
    return await promise;
  } finally {
    if (connection?.controller === controller) connection = null;
  }
}

export function getRpc(): PiRpc | null {
  return rpc;
}

export async function call<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M> extends void ? [] | [void] : [ApiParams<M>]
): Promise<ApiResult<M>> {
  const client = await ensureRpc();
  return client.call(method, ...(args as never));
}

export async function subscribe<T extends StreamTopic>(
  topic: T,
  key: string,
  on: (ev: Streams[T]) => void,
): Promise<() => void> {
  const client = await ensureRpc();
  return client.subscribe(topic, key, on);
}

// ---------------------------------------------------------------------------
// Domain helpers used by Renderer consumers
// ---------------------------------------------------------------------------

export async function listSessions() {
  return call("sessions.list");
}

export async function getSession(
  id: string,
  includeState?: boolean,
  traceId?: string,
  historyWindow?: ApiParams<"sessions.get">["historyWindow"],
) {
  return call("sessions.get", { id, includeState, traceId, historyWindow });
}

export async function getSessionContext(
  id: string,
  leafId?: string,
  historyWindow?: ApiParams<"sessions.context">["historyWindow"],
) {
  return call("sessions.context", { id, leafId, historyWindow });
}

export async function getSessionContextPage(id: string, cursor: string, maxTurns?: number, maxBytes?: number) {
  return call("sessions.contextPage", { id, cursor, maxTurns, maxBytes });
}

export async function getSessionEntryContent(id: string, entryId: string, blockIndex?: number) {
  return call("sessions.entryContent", { id, entryId, blockIndex });
}

export async function getSessionTrajectoryContext(id: string, leafId?: string) {
  return call("sessions.trajectoryContext", { id, leafId });
}

export async function newAgent(params: ApiParams<"agent.new">) {
  return call("agent.new", params);
}

/** Open transport entry: Host validates the envelope and dispatches the payload. */
export async function agentCommand(sessionId: string, command: AgentCommand) {
  return call("agent.command", { sessionId, command });
}

export async function agentState(sessionId: string) {
  return call("agent.state", { sessionId });
}

export async function getCacheWarmingStatus() {
  return call("settings.getCacheWarming");
}

export async function setCacheWarmingMode(mode: "off" | "streaming" | "idle") {
  return call("settings.setCacheWarming", { mode });
}

export async function listModels(cwd?: string) {
  return call("models.list", cwd ? { cwd } : undefined);
}

export async function refreshModels(cwd: string | undefined, requestId: string) {
  return call("models.refresh", { ...(cwd ? { cwd } : {}), requestId });
}

export async function cancelModelsRefresh(requestId: string) {
  return call("models.refreshCancel", { requestId });
}

export async function getModelPreferences(cwd?: string) {
  return call("models.preferences.get", cwd ? { cwd } : undefined);
}

export async function setModelPreferences(cwd: string | undefined, enabledModels: string[] | null) {
  return call("models.preferences.set", { ...(cwd ? { cwd } : {}), enabledModels });
}

export async function fileIndex(root: string, query?: string) {
  return call("files.index", { root, query });
}

export async function subscribeAgentEvents(sessionId: string, on: (ev: Streams["agent.events"]) => void) {
  return subscribe("agent.events", sessionId, on);
}

export async function subscribeRunning(on: (ev: Streams["agent.running"]) => void) {
  return subscribe("agent.running", "*", on);
}

export async function subscribeSessionsChanged(on: (ev: Streams["sessions.changed"]) => void) {
  return subscribe("sessions.changed", "*", on);
}

export async function subscribeAuthLogin(provider: string, on: (ev: Streams["auth.login"]) => void) {
  return subscribe("auth.login", provider, on);
}
