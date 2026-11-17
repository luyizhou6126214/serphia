import type { DesktopWindowResult } from "../contract/desktop-window-prototype";
import { callMain } from "./parent-rpc";

type DesktopWindowRequest = (
  method: string,
  params: { owner: string; input: unknown },
  timeoutMs: number,
) => Promise<DesktopWindowResult>;

export async function callDesktopWindow(
  owner: string,
  input: unknown,
  signal?: AbortSignal,
  request: DesktopWindowRequest = callMain,
): Promise<DesktopWindowResult> {
  signal?.throwIfAborted();
  const stop = () => {
    void request("desktopWindow", { owner, input: { action: "stop" } }, 5_000).catch(() => undefined);
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const result = await request("desktopWindow", { owner, input }, 55_000);
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
