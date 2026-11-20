import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentActivityItem } from "../shared/types";

type Listener = (items: SubagentActivityItem[]) => void;

/** Parent-turn view of the bundled plugin's queued, running, and settled children. */
export class SubagentActivity {
  private readonly items = new Map<string, SubagentActivityItem>();
  private readonly listeners = new Set<Listener>();
  private parentRunning = false;

  snapshot(): SubagentActivityItem[] {
    return [...this.items.values()];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  bind(pi: ExtensionAPI): void {
    pi.on("agent_start", () => {
      this.parentRunning = true;
    });
    pi.on("agent_settled", () => this.close());
    pi.on("session_shutdown", () => this.close());
    for (const channel of ["created", "started", "resuming", "completed", "failed", "resumed", "update"] as const) {
      pi.events.on(`subagents:${channel}`, (payload) => {
        if (!this.parentRunning || !payload || typeof payload !== "object" || !("id" in payload)) return;
        const id = payload.id;
        if (typeof id !== "string" || !id) return;
        const previous = this.items.get(id);
        if (channel === "created" || channel === "started" || channel === "resuming") {
          if (!("description" in payload) || typeof payload.description !== "string") return;
          const status = channel === "created" ? "queued" : "running";
          this.items.set(id, {
            id,
            description: payload.description.trim().slice(0, 240),
            status,
            ...(status === "running" ? { startedAt: Date.now() } : {}),
          });
        } else {
          if (!previous) return;
          if (channel === "update") {
            if (previous.status !== "running" || !("message" in payload) || typeof payload.message !== "string") return;
            this.items.set(id, { ...previous, update: payload.message.trim().slice(0, 240) });
          } else {
            const status = "status" in payload ? payload.status : undefined;
            const outcome = status === "completed" || status === "aborted" || status === "stopped" ? status : "error";
            const duration = "durationMs" in payload ? payload.durationMs : undefined;
            this.items.set(id, {
              ...previous,
              status: outcome,
              update: undefined,
              ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0
                ? { durationMs: duration }
                : {}),
            });
          }
        }
        this.publish();
      });
    }
  }

  private close(): void {
    this.parentRunning = false;
    if (!this.items.size) return;
    this.items.clear();
    this.publish();
  }

  private publish(): void {
    const items = this.snapshot();
    for (const listener of this.listeners) listener(items);
  }
}
