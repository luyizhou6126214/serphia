import { randomUUID } from "node:crypto";
import type { ExtensionUiContextLike } from "../shared/pi-types";
import { PLAN_REFINE_TITLE, PLAN_REVIEW_TITLE } from "../shared/plan-mode";
import type { ExtensionUiRequest, ExtensionUiResponse } from "../shared/types";

type Dialog = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type DialogOptions = Parameters<ExtensionUiContextLike["select"]>[2];
type PendingDialog = {
  request: Dialog;
  respond: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

/** Owns blocking extension requests, including replay and cancellation. */
export class ExtensionDialogs {
  private readonly pending = new Map<string, PendingDialog>();

  constructor(
    private readonly emit: (event: { type: string; [key: string]: unknown }) => void,
    private readonly source: () => "desktop" | "channel" | "scheduled",
  ) {}

  readonly ui: Pick<ExtensionUiContextLike, "select" | "confirm" | "confirmLocalized" | "input" | "editor"> = {
    select: (title, options, opts) =>
      this.request(
        { method: "select", title, options, ...(opts?.plan ? { plan: opts.plan } : {}) },
        opts,
        undefined,
        (response) => ("value" in response ? response.value : undefined),
      ),
    confirm: (title, message, opts) =>
      this.request({ method: "confirm", title, message }, opts, false, (response) =>
        "confirmed" in response ? response.confirmed : false,
      ),
    confirmLocalized: (title, message, localization, opts) =>
      this.request({ method: "confirm", title, message, localization }, opts, false, (response) =>
        "confirmed" in response ? response.confirmed : false,
      ),
    input: (title, placeholder, opts) =>
      this.request(
        { method: "input", title, ...(placeholder === undefined ? {} : { placeholder }) },
        opts,
        undefined,
        (response) => ("value" in response ? response.value : undefined),
      ),
    editor: (title, prefill, opts) =>
      this.request(
        { method: "editor", title, ...(prefill === undefined ? {} : { prefill }) },
        opts,
        undefined,
        (response) => ("value" in response ? response.value : undefined),
      ),
  };

  replay(emit: (request: Dialog) => void): void {
    for (const { request } of this.pending.values()) emit(request);
  }

  respond(response: ExtensionUiResponse): void {
    this.pending.get(response.id)?.respond(response);
  }

  cancelPlanReview(): void {
    for (const [id, { request, cancel }] of this.pending) {
      if (
        (request.method === "select" && request.title === PLAN_REVIEW_TITLE) ||
        (request.method === "input" && request.title === PLAN_REFINE_TITLE)
      ) {
        cancel();
        this.emit({ type: "extension_ui_request", id, method: "dismissDialog" });
      }
    }
  }

  dispose(): void {
    for (const { cancel } of this.pending.values()) cancel();
  }

  private async request<T, Method extends Dialog["method"]>(
    dialog: Omit<Extract<Dialog, { method: Method }>, "type" | "id"> & { method: Method },
    opts: DialogOptions,
    defaultValue: T,
    parse: (response: ExtensionUiResponse) => T,
  ): Promise<T> {
    const source = this.source();
    if (source === "scheduled") return defaultValue;
    if (source === "channel") {
      if (dialog.method !== "select" || dialog.title !== PLAN_REVIEW_TITLE) {
        this.emit({
          type: "channel_headless_ui_blocked",
          feature: dialog.method,
          errorMessage: "Interactive extension UI is unavailable for messaging-channel turns.",
        });
      }
      return defaultValue;
    }
    if (opts?.signal?.aborted) return defaultValue;

    const id = randomUUID();
    const { timeout, signal } = opts ?? {};
    const request = {
      type: "extension_ui_request",
      id,
      ...dialog,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    } as Dialog;

    return new Promise((resolve) => {
      const settle = (value: T) => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.pending.delete(id);
        resolve(value);
      };
      const cancel = () => settle(defaultValue);
      const timer = timeout ? setTimeout(cancel, timeout) : undefined;
      signal?.addEventListener("abort", cancel, { once: true });
      this.pending.set(id, { request, respond: (response) => settle(parse(response)), cancel });
      this.emit(request);
    });
  }
}
