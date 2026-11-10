import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { handleClosedStdioPipes } from "./stdio-errors.ts";
import { PassThrough } from "node:stream";

test("ignores only broken pipe errors", () => {
  const stream = new PassThrough();
  handleClosedStdioPipes([stream]);
  stream.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
  const otherError = Object.assign(new Error("other"), { code: "EIO" });
  assert.throws(
    () => stream.emit("error", otherError),
    (error) => error === otherError,
  );
});

test("survives writing to a closed stdout pipe", async () => {
  const moduleUrl = new URL("./stdio-errors.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
    import { handleClosedStdioPipes } from ${JSON.stringify(moduleUrl)};
    handleClosedStdioPipes();
    process.send('ready');
    process.on('message', () => {
      console.log('output after pipe closed');
      setTimeout(() => process.exit(0), 100);
    });
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  await once(child, "message");
  child.stdout.destroy();
  child.send("write");
  const [code, signal] = await once(child, "exit");
  assert.equal(signal, null);
  assert.equal(code, 0);
});
