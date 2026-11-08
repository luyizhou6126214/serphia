import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { OpenInAppService, validateWorkspaceDirectory } from "./service.ts";

/** One fake application resolved by the injected resolution pass. */
function application(id, iconPath = `C:/Apps/${id}.exe`) {
  return { id, launch: { kind: "argv", command: `C:/Apps/${id}.exe`, args: [] }, iconPath };
}

/** Service over a fixed resolution pass and scripted launch outcomes. */
function createService({ applications, outcomes = ["launched"], readIcon } = {}) {
  const state = { resolutions: 0, launches: [], iconReads: [] };
  const service = new OpenInAppService({
    resolve: async () => {
      state.resolutions += 1;
      const map = new Map();
      for (const entry of applications ?? [application("vscode")]) map.set(entry.id, entry);
      if (state.resolutions > 1 && state.dropOnRetry) map.delete(state.dropOnRetry);
      return map;
    },
    launch: async (target) => {
      state.launches.push(target.id);
      return outcomes[Math.min(state.launches.length - 1, outcomes.length - 1)];
    },
    readIcon: async (iconPath) => {
      state.iconReads.push(iconPath);
      return readIcon === undefined ? `data:image/png;base64,${String(iconPath)}` : readIcon(iconPath);
    },
  });
  return { service, state };
}

test("workspace directories must be absolute existing directories", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "serphia-open-in-app-"));
  const file = path.join(directory, "file.txt");
  await writeFile(file, "x");
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.equal(await validateWorkspaceDirectory("relative/dir"), null);
  assert.equal(await validateWorkspaceDirectory(`${directory}\0`), null);
  assert.equal(await validateWorkspaceDirectory(file), null);
  assert.equal(await validateWorkspaceDirectory(path.join(directory, "missing")), null);
  assert.equal(await validateWorkspaceDirectory(42), null);
  assert.equal(await validateWorkspaceDirectory(directory), await validateWorkspaceDirectory(directory));
});

test("the list resolves once and caches each application icon", async () => {
  const { service, state } = createService({
    applications: [application("explorer", null), application("vscode")],
  });
  const first = await service.list();
  const second = await service.list();
  assert.deepEqual(
    first.map((entry) => entry.id),
    ["explorer", "vscode"],
  );
  assert.deepEqual(first[0], { id: "explorer", icon: "data:image/png;base64,null" });
  assert.deepEqual(second, first);
  assert.equal(state.resolutions, 1);
  assert.deepEqual(state.iconReads, [null, "C:/Apps/vscode.exe"]);
});

test("opening validates both arguments before launching", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "serphia-open-in-app-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { service, state } = createService({ outcomes: ["launched"] });

  assert.deepEqual(await service.open(42, directory), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await service.open("vscode", "relative"), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await service.open("missing", directory), { ok: false, code: "NOT_INSTALLED" });
  assert.deepEqual(state.launches, []);

  assert.deepEqual(await service.open("vscode", directory), { ok: true });
  assert.deepEqual(state.launches, ["vscode"]);
});

test("a vanished launcher re-resolves once before the application is dropped", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "serphia-open-in-app-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const recovered = createService({ outcomes: ["missing", "launched"] });
  assert.deepEqual(await recovered.service.open("vscode", directory), { ok: true });
  assert.equal(recovered.state.resolutions, 2);
  assert.deepEqual(recovered.state.launches, ["vscode", "vscode"]);

  const gone = createService({ outcomes: ["missing", "missing"] });
  gone.state.dropOnRetry = "vscode";
  assert.deepEqual(await gone.service.open("vscode", directory), { ok: false, code: "NOT_INSTALLED" });

  const failed = createService({ outcomes: ["failed"] });
  assert.deepEqual(await failed.service.open("vscode", directory), { ok: false, code: "LAUNCH_FAILED" });
});
