import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DesktopWindowAction, DesktopWindowResult } from "../../contract/desktop-window-prototype";
import { AgentDesktopDriver, type DriverWindow } from "./driver";

const focusPollMs = 150;
const refPattern = /^@[a-z0-9_-]+:e\d+$/i;

type Lease = {
  owner: string;
  home: string;
  controller: AbortController;
  target?: DriverWindow;
  refs: Set<string>;
  operation?: Promise<DesktopWindowResult>;
  monitor?: ReturnType<typeof setTimeout>;
  probe?: Promise<DriverWindow[]>;
};

function parseAction(input: unknown): DesktopWindowAction {
  const value = input as { action?: unknown; app?: unknown; ref?: unknown; text?: unknown } | null;
  if (
    value?.action === "bind" &&
    (value.app === undefined || (typeof value.app === "string" && value.app.length <= 160))
  )
    return { action: "bind", app: value.app?.trim() || undefined };
  if (value?.action === "snapshot" || value?.action === "screenshot" || value?.action === "stop")
    return { action: value.action };
  if (typeof value?.ref === "string" && value.ref.length <= 96 && refPattern.test(value.ref)) {
    if (value.action === "click") return { action: "click", ref: value.ref };
    if (
      value.action === "input" &&
      typeof value.text === "string" &&
      Buffer.byteLength(value.text) <= 4096 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.text)
    )
      return { action: "input", ref: value.ref, text: value.text };
  }
  throw new Error("Invalid desktop window action");
}

function eligible(window: DriverWindow): boolean {
  return (
    window.visible &&
    !window.minimized &&
    /^w-\d+$/.test(window.id) &&
    Boolean(window.process_instance) &&
    window.accessible
  );
}

function sameWindow(window: DriverWindow, target: DriverWindow): boolean {
  return window.id === target.id && window.pid === target.pid && window.process_instance === target.process_instance;
}

function snapshotRefs(node: unknown, refs = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return refs;
  const item = node as { ref_id?: string; children?: unknown[] };
  if (typeof item.ref_id === "string" && refPattern.test(item.ref_id)) refs.add(item.ref_id);
  for (const child of item.children ?? []) snapshotRefs(child, refs);
  return refs;
}

export class DesktopWindowPrototype {
  private readonly driver: AgentDesktopDriver;
  private lease?: Lease;
  private cleanup?: Promise<unknown>;

  constructor(
    executable: string,
    private readonly selectWindow: (
      targets: readonly DriverWindow[],
      app: string | undefined,
      signal: AbortSignal,
    ) => Promise<string | undefined>,
    private readonly excludedPid?: number,
    private readonly askUserToFocus?: (target: DriverWindow, signal: AbortSignal) => Promise<boolean>,
  ) {
    this.driver = new AgentDesktopDriver(executable);
  }

  async handle(params: unknown): Promise<DesktopWindowResult> {
    const body = params as { owner?: unknown; input?: unknown } | null;
    const owner = body?.owner;
    if (typeof owner !== "string" || !owner || owner.length > 128) throw new Error("Invalid desktop window owner");
    const action = parseAction(body?.input);
    if (action.action === "stop") {
      this.stop(owner);
      return { data: { stopped: true } };
    }
    if (action.action === "bind") {
      if (this.lease || this.cleanup) throw new Error("Desktop window prototype is busy");
      const lease = {
        owner,
        home: mkdtempSync(path.join(tmpdir(), "serphia-desktop-window-")),
        controller: new AbortController(),
        refs: new Set<string>(),
      };
      this.lease = lease;
      try {
        return await this.exclusive(lease, () => this.bind(lease, action.app));
      } catch (error) {
        this.stopLease(lease, "Desktop window selection ended");
        throw error;
      }
    }
    const lease = this.lease;
    if (!lease?.target || lease.owner !== owner) throw new Error("No active desktop window. Ask the user to bind one.");
    if (lease.operation) throw new Error("Desktop window action already in progress");
    return this.exclusive(lease, () => this.perform(lease, action));
  }

  stop(owner?: string, reason = "Desktop window control stopped"): void {
    const lease = this.lease;
    if (lease && (owner === undefined || lease.owner === owner)) this.stopLease(lease, reason);
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.cleanup;
  }

  private stopLease(lease: Lease, reason: string): void {
    if (this.lease !== lease) return;
    this.lease = undefined;
    lease.refs.clear();
    clearTimeout(lease.monitor);
    lease.controller.abort(new Error(reason));
    this.cleanup = Promise.allSettled([lease.operation, lease.probe])
      .then(() => rm(lease.home, { recursive: true, force: true, maxRetries: 3 }))
      .catch(() => undefined)
      .finally(() => {
        this.cleanup = undefined;
      });
  }

  private async exclusive(lease: Lease, run: () => Promise<DesktopWindowResult>): Promise<DesktopWindowResult> {
    // Record the operation before its first side effect so stop can drain it.
    const operation = Promise.resolve().then(run);
    lease.operation = operation;
    try {
      return await operation;
    } finally {
      lease.operation = undefined;
    }
  }

  private async bind(lease: Lease, app: string | undefined): Promise<DesktopWindowResult> {
    const signal = lease.controller.signal;
    const windows = await this.driver.windows(lease.home, signal);
    const candidates = windows.filter((window) => eligible(window) && window.pid !== this.excludedPid);
    if (!candidates.length) throw new Error("Open an accessible Windows app before requesting desktop control");
    const id = await this.selectWindow(candidates, app, signal);
    const target = candidates.find((window) => window.id === id);
    if (!target) throw new Error("Desktop window access declined");
    const live = (await this.driver.windows(lease.home, signal)).find((window) => sameWindow(window, target));
    if (!live || !eligible(live)) throw new Error("The selected desktop window is no longer available");
    if (!live.is_focused) await this.focusSelectedWindow(live, lease.home, signal);
    lease.target = target;
    await this.assertFocused(lease);
    this.monitorFocus(lease);
    return { data: { app: live.app_name, title: live.title, windowId: live.id } };
  }

  private async focusSelectedWindow(target: DriverWindow, home: string, signal: AbortSignal): Promise<void> {
    try {
      await this.driver.focusWindow(target.id, home, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!(await this.askUserToFocus?.(target, signal))) throw error;
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const window = (await this.driver.windows(home, signal)).find((window) => sameWindow(window, target));
        if (!window || !eligible(window)) throw new Error("The selected desktop window is no longer available");
        if (window.is_focused) return;
        await delay(200, undefined, { signal });
      }
      throw new Error("The selected desktop window was not brought to the foreground");
    }
  }

  private async assertFocused(lease: Lease): Promise<void> {
    const signal = lease.controller.signal;
    signal.throwIfAborted();
    const target = lease.target!;
    const probe = lease.probe ?? this.driver.windows(lease.home, signal);
    lease.probe = probe;
    try {
      const windows = await probe;
      signal.throwIfAborted();
      if (
        !windows.some(
          (window) => sameWindow(window, target) && window.is_focused && window.visible && !window.minimized,
        )
      )
        this.stopLease(lease, "Desktop window lost focus or closed");
    } catch {
      this.stopLease(lease, "Could not verify the selected desktop window");
    } finally {
      if (lease.probe === probe) lease.probe = undefined;
    }
    signal.throwIfAborted();
  }

  private monitorFocus(lease: Lease): void {
    lease.monitor = setTimeout(() => {
      void this.assertFocused(lease)
        .then(() => this.monitorFocus(lease))
        .catch(() => {
          // A failed foreground check revokes this lease.
        });
    }, focusPollMs);
    lease.monitor.unref();
  }

  private async perform(lease: Lease, action: DesktopWindowAction): Promise<DesktopWindowResult> {
    const signal = lease.controller.signal;
    if ((action.action === "click" || action.action === "input") && !lease.refs.has(action.ref))
      throw new Error("Take a fresh snapshot and use one of its control refs");
    await this.assertFocused(lease);
    const targetArgs = ["--window-id", lease.target!.id];
    if (action.action === "snapshot") {
      lease.refs.clear();
      const data = await this.driver.run<{ tree: unknown; snapshot_id: string }>(
        ["snapshot", ...targetArgs, "--interactive-only", "--compact"],
        lease.home,
        signal,
      );
      await this.assertFocused(lease);
      lease.refs = snapshotRefs(data.tree);
      return { data };
    }
    if (action.action === "screenshot") {
      const { data: base64, ...data } = await this.driver.run<{ data?: string; [key: string]: unknown }>(
        ["screenshot", ...targetArgs],
        lease.home,
        signal,
      );
      await this.assertFocused(lease);
      if (typeof base64 !== "string" || !base64.startsWith("iVBORw0KGgo"))
        throw new Error("agent-desktop did not return a PNG screenshot");
      return { data, image: base64 };
    }
    if (action.action !== "click" && action.action !== "input") throw new Error("Unexpected desktop window action");
    lease.refs.clear();
    const args = action.action === "click" ? ["click", action.ref] : ["set-value", "--stdin", action.ref];
    const data = await this.driver.run(args, lease.home, signal, action.action === "input" ? action.text : undefined);
    await this.assertFocused(lease);
    return { data };
  }
}
