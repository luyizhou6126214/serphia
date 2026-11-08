import assert from "node:assert/strict";
import test from "node:test";

import { TERMINAL_MAX_COUNT, TerminalService, clampTerminalSize, resolveTerminalCwd } from "./service.ts";

const SHELLS = [
  { id: "/bin/zsh", label: "zsh", executable: "/bin/zsh", args: [] },
  { id: "/bin/bash", label: "bash", executable: "/bin/bash", args: [] },
];

/** One scripted session standing in for a real pty. */
class FakeSession {
  constructor(options, created) {
    this.id = options.id;
    this.backlog = "";
    this.writes = [];
    this.resizes = [];
    this.closed = false;
    this.info = {
      id: options.id,
      title: options.shell.label,
      shellId: options.shell.id,
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      state: "running",
      exitCode: null,
    };
    this.options = options;
    created.push(this);
  }

  attach() {
    return { info: this.info, backlog: this.backlog, truncated: false };
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push([cols, rows]);
    this.info = { ...this.info, cols, rows };
  }

  async close() {
    this.closed = true;
  }

  killNow() {
    this.closed = true;
  }

  emitData(chunk) {
    this.backlog += chunk;
    this.options.onData(chunk);
  }

  exit(code) {
    this.info = { ...this.info, state: "exited", exitCode: code };
    this.options.onExit(code);
  }
}

function createService(overrides = {}) {
  const events = [];
  const sessions = [];
  const service = new TerminalService({
    shells: SHELLS,
    defaultShellId: "/bin/zsh",
    emit: (event) => events.push(event),
    spawnSession: (options) => new FakeSession(options, sessions),
    batchMs: 1,
    ...overrides,
  });
  return { service, events, sessions };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("creating a terminal uses the requested or default shell and lists it", () => {
  const { service } = createService();
  const first = service.create({ cwd: process.cwd(), cols: 100, rows: 30 });
  assert.equal(first.shellId, "/bin/zsh");
  assert.equal(first.title, "zsh");
  assert.equal(first.cwd, process.cwd());
  assert.equal(first.state, "running");
  const second = service.create({ shellId: "/bin/bash", cwd: process.cwd(), cols: 80, rows: 24 });
  assert.equal(second.shellId, "/bin/bash");
  const snapshot = service.list();
  assert.deepEqual(
    snapshot.shells.map((shell) => shell.id),
    ["/bin/zsh", "/bin/bash"],
  );
  assert.deepEqual(
    snapshot.terminals.map((terminal) => terminal.id),
    [first.id, second.id],
  );
  assert.throws(
    () => service.create({ shellId: "/bin/nope", cwd: process.cwd(), cols: 80, rows: 24 }),
    /TERMINAL_SHELL_UNAVAILABLE/,
  );
});

test("output is batched with increasing sequence numbers and attach flushes first", async () => {
  const { service, events, sessions } = createService();
  const created = service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  sessions[0].emitData("hello ");
  sessions[0].emitData("world");
  const attached = service.attach(created.id);
  assert.equal(attached.backlog, "hello world");
  assert.equal(attached.seq, 1, "pending output is flushed into the attach sequence");
  const data = events.filter((event) => event.type === "data");
  assert.equal(data.length, 1);
  assert.equal(data[0].data, "hello world");
  assert.equal(data[0].id, created.id);

  sessions[0].emitData("!");
  await delay(15);
  const later = events.filter((event) => event.type === "data");
  assert.equal(later.length, 2);
  assert.equal(later[1].seq, 2);
  assert.ok(later[1].seq > attached.seq, "frames after attach are newer than its backlog");
});

test("write and resize forward validated values", () => {
  const { service, sessions } = createService();
  const created = service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  service.write(created.id, "ls\r");
  assert.deepEqual(sessions[0].writes, ["ls\r"]);
  assert.throws(() => service.write(created.id, ""), /TERMINAL_INVALID_INPUT/);
  assert.throws(() => service.write(created.id, "x".repeat(64 * 1024 + 1)), /TERMINAL_INVALID_INPUT/);

  service.resize(created.id, 1, 1);
  service.resize(created.id, 1_000, 500);
  assert.deepEqual(sessions[0].resizes, [
    [20, 4],
    [500, 200],
  ]);
  assert.deepEqual(clampTerminalSize(Number.NaN, Number.POSITIVE_INFINITY), { cols: 20, rows: 4 });
});

test("an exited terminal reports its code and refuses further input", async () => {
  const { service, events, sessions } = createService();
  const created = service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  sessions[0].emitData("bye");
  sessions[0].exit(0);
  const exited = events.find((event) => event.type === "exited");
  assert.equal(exited?.id, created.id);
  assert.equal(exited?.exitCode, 0);
  const attached = service.attach(created.id);
  assert.equal(attached.info.state, "exited");
  assert.equal(attached.info.exitCode, 0);
  assert.equal(attached.backlog, "bye");
  assert.throws(() => service.write(created.id, "x"), /TERMINAL_EXITED/);
});

test("closing ends the session, emits closed, and forgets it", async () => {
  const { service, events, sessions } = createService();
  const created = service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  await service.close(created.id);
  assert.equal(sessions[0].closed, true);
  assert.equal(events.filter((event) => event.type === "closed").length, 1);
  assert.deepEqual(service.list().terminals, []);
  await service.close(created.id);
});

test("unknown terminals and invalid working directories fail closed", () => {
  const { service } = createService();
  assert.throws(() => service.attach("nope"), /TERMINAL_NOT_FOUND/);
  assert.throws(() => service.write("nope", "x"), /TERMINAL_NOT_FOUND/);
  assert.throws(() => service.resize("nope", 80, 24), /TERMINAL_NOT_FOUND/);
  assert.throws(() => service.create({ cwd: "relative", cols: 80, rows: 24 }), /TERMINAL_INVALID_CWD/);
  assert.throws(() => service.create({ cwd: `${process.cwd()}\0`, cols: 80, rows: 24 }), /TERMINAL_INVALID_CWD/);
  assert.throws(
    () => service.create({ cwd: `${process.cwd()}/definitely-missing-dir`, cols: 80, rows: 24 }),
    /TERMINAL_INVALID_CWD/,
  );
  assert.equal(resolveTerminalCwd(process.cwd()).length > 0, true);
});

test("the host cap refuses further terminals", () => {
  const { service } = createService({ maxTerminals: 2 });
  service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  assert.throws(() => service.create({ cwd: process.cwd(), cols: 80, rows: 24 }), /TERMINAL_LIMIT/);
  assert.equal(TERMINAL_MAX_COUNT > 2, true);
});

test("disposeAll kills every session without emitting closes", () => {
  const { service, events, sessions } = createService();
  service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  service.create({ cwd: process.cwd(), cols: 80, rows: 24 });
  service.disposeAll();
  assert.deepEqual(
    sessions.map((session) => session.closed),
    [true, true],
  );
  assert.deepEqual(service.list().terminals, []);
  assert.equal(events.filter((event) => event.type === "closed").length, 0);
});
