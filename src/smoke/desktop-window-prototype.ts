import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { app, nativeImage } from "electron";
import { callDesktopWindow } from "../agent-host/desktop-window-prototype-client";
import type { DesktopWindowAction } from "../contract/desktop-window-prototype";
import { resolveDesktopWindowDriver } from "../main/desktop-window/runtime";
import { DesktopWindowPrototype } from "../main/desktop-window/service";

const root = process.env.SERPHIA_DESKTOP_WINDOW_TEST_ROOT;
const resourceRoot = process.env.SERPHIA_DESKTOP_WINDOW_TEST_RESOURCES;
assert.ok(root && resourceRoot);
const executable = resolveDesktopWindowDriver({ platform: process.platform, arch: process.arch, resourceRoot });
assert.ok(executable, "Bundled agent-desktop did not pass integrity verification");
app.setPath("userData", path.join(root, "user-data"));

type Node = { name?: string; ref_id?: string; children?: Node[] };

function findRef(node: Node, name: string): string | undefined {
  if (node.name === name && node.ref_id) return node.ref_id;
  for (const child of node.children ?? []) {
    const ref = findRef(child, name);
    if (ref) return ref;
  }
}

async function run(): Promise<void> {
  const script = readFileSync(path.resolve("src/smoke/desktop-window-fixture.ps1"), "utf8");
  const fixture = spawn(
    path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] },
  );
  fixture.stdin.on("error", () => {});
  const output = createInterface({ input: fixture.stdout });
  const lines = output[Symbol.asyncIterator]();
  async function readLine(): Promise<string> {
    const line = await lines.next();
    assert.ok(!line.done, "WinForms fixture exited before responding");
    return line.value;
  }
  async function focus(name: "target" | "other"): Promise<void> {
    fixture.stdin.write(name + "\n");
    assert.equal(await readLine(), "focused", `Expected ${name} fixture in the foreground`);
  }
  async function outcomes() {
    fixture.stdin.write("state\n");
    const state = JSON.parse(await readLine()) as Record<"target" | "other", { clicks: number; base64: string }>;
    return Object.fromEntries(
      Object.entries(state).map(([name, value]) => [
        name,
        { clicks: value.clicks, text: Buffer.from(value.base64, "base64").toString("utf8") },
      ]),
    );
  }

  const service = new DesktopWindowPrototype(
    executable!,
    async (candidates, appHint) => {
      assert.equal(appHint, "Serphia Desktop Fixture");
      const target = candidates.find((window) => window.pid === fixture.pid && window.title === appHint);
      assert.ok(target, "The application picker must receive the requested fixture window");
      return target.id;
    },
    undefined,
    async (target) => {
      assert.equal(target.title, "Serphia Desktop Fixture");
      await focus("target");
      return true;
    },
  );
  const owner = "desktop-window-smoke";
  const send = (input: DesktopWindowAction, signal?: AbortSignal) =>
    callDesktopWindow(owner, input, signal, (method, params) => {
      assert.equal(method, "desktopWindow");
      return service.handle(params);
    });
  const ref = async (name: string) => {
    const result = await send({ action: "snapshot" });
    const control = findRef((result.data as { tree: Node }).tree, name);
    assert.ok(control, `Missing fixture control ${name}: ${JSON.stringify(result.data)}`);
    return control;
  };

  try {
    assert.equal(await readLine(), "started");
    await focus("other");
    const bound = await send({ action: "bind", app: "Serphia Desktop Fixture" });
    assert.equal((bound.data as { title: string }).title, "Serphia Desktop Fixture");
    console.log("Selection: bound the requested window while a different fixture was initially foreground");
    const capture = await send({ action: "screenshot" });
    assert.ok(capture.image);
    const png = nativeImage.createFromBuffer(Buffer.from(capture.image, "base64"));
    assert.ok(!png.isEmpty());
    const { width, height } = png.getSize();
    assert.ok(width >= 500 && height >= 350);
    const bitmap = png.toBitmap();
    const offset = (Math.floor(height * 0.8) * width + Math.floor(width * 0.8)) * 4;
    const [blue, green, red, alpha] = bitmap.subarray(offset, offset + 4);
    assert.ok(blue > green + 50 && green > red + 25 && alpha === 255, "Expected the blue fixture background");
    console.log(`Screenshot: verified fixture pixels in ${width}×${height} PNG`);

    const button = await ref("Run fixture action");
    await assert.rejects(
      service.handle({ owner: "another-session", input: { action: "click", ref: button } }),
      /No active desktop window/,
    );
    await send({ action: "click", ref: button });
    assert.deepEqual((await outcomes()).target, { clicks: 1, text: "" });
    await assert.rejects(send({ action: "click", ref: button }), /fresh snapshot/);
    console.log("Control click: fixture handler ran once; stale and other-session calls rejected");

    const input = await ref("Fixture input");
    const text = "Serphia Windows 输入 ✓";
    await send({ action: "input", ref: input, text });
    const expected = { target: { clicks: 1, text }, other: { clicks: 0, text: "" } };
    assert.deepEqual(await outcomes(), expected);
    console.log("Text input: fixture read back Unicode text");

    const beforeSwitch = await ref("Run fixture action");
    await focus("other");
    await assert.rejects(send({ action: "click", ref: beforeSwitch }), /lost focus|No active desktop window/);
    await focus("target");
    await assert.rejects(send({ action: "click", ref: beforeSwitch }), /No active desktop window/);
    assert.deepEqual(await outcomes(), expected);
    console.log("Focus switch: action rejected; returning to original window did not rearm control");

    await service.dispose();
    await send({ action: "bind", app: "Serphia Desktop Fixture" });
    const beforeStop = await ref("Run fixture action");
    const abort = new AbortController();
    const pending = send({ action: "click", ref: beforeStop }, abort.signal);
    const rejected = assert.rejects(pending, /Desktop window control stopped/);
    await Promise.resolve(); // Let the pending action enter its foreground check.
    abort.abort();
    await rejected;
    await assert.rejects(send({ action: "click", ref: beforeStop }), /No active desktop window/);
    assert.deepEqual(await outcomes(), expected);
    console.log("Stop: Agent cancellation revoked the binding before input dispatch; later actions rejected");
  } finally {
    await service.dispose();
    output.close();
    fixture.stdin.end();
    if (fixture.exitCode === null) fixture.kill();
  }
}

void app
  .whenReady()
  .then(run)
  .then(
    () => app.exit(0),
    (error: unknown) => {
      console.error(error);
      app.exit(1);
    },
  );
