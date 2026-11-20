import assert from "node:assert/strict";
import { MessageChannel } from "node:worker_threads";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

test("slow Host startup keeps waiting and a later ready event connects", async (t) => {
  const { ensureRpc, getRpc, resetRpc, createRpcServer } = await importTestBundle("renderer-host-connection", {
    stdin: {
      contents: 'export * from "./api-client"; export { createRpcServer } from "@contract/rpc";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const window = new globalThis.EventTarget();
  const listeners = new Set();
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.handle({ "host.ping": () => ({ ok: true, ts: 1 }) });
  server.attachPort(port2);
  t.after(() => {
    resetRpc();
    port1.close();
    port2.close();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });

  const requestHostPort = t.mock.fn(() => {
    window.dispatchEvent(
      Object.assign(new globalThis.Event("message"), { source: window, data: "pi-desktop-host-port", ports: [port1] }),
    );
  });
  window.piBridge = {
    getHostStatus: async () => "starting",
    onHostStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestHostPort,
  };
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });

  const notify = (status) => {
    for (const listener of [...listeners]) listener(status);
  };
  const abandoned = assert.rejects(ensureRpc(), /connection reset/);
  resetRpc();
  const pending = ensureRpc();
  await abandoned;
  t.mock.timers.tick(31_000);
  assert.equal(listeners.size, 1);
  assert.equal(requestHostPort.mock.callCount(), 0);

  notify({ status: "ready" });
  assert.equal(await pending, getRpc());
  assert.equal(listeners.size, 0);
  assert.equal(requestHostPort.mock.callCount(), 1);

  resetRpc();
  const failed = assert.rejects(ensureRpc(), /restart budget exhausted/);
  notify({ status: "crashed", detail: "Host restart budget exhausted" });
  await failed;
  assert.equal(listeners.size, 0);
});
