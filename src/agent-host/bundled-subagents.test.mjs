import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { applyPluginAction, readPlugins, probePiRuntimeModules } = await importTestBundle("bundled-subagents", {
  packages: "external",
  stdin: {
    contents: `
      export { applyPluginAction, readPlugins } from "./plugins-service";
      export { probePiRuntimeModules } from "./pi-runtime-probe";
    `,
    resolveDir: import.meta.dirname,
  },
});

test("the bundled package is listed and can be disabled and re-enabled without a package installer", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "serphia-plugin-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const source = "builtin:pi-subagents";
  const find = ({ packages }) => packages.find((pkg) => pkg.source === source);
  const bundled = find(await readPlugins(root));
  assert.equal(bundled.packageName, "@gotgenes/pi-subagents");
  assert.equal(bundled.bundled, true);
  assert.equal(bundled.status, "loaded");
  for (const [action, expected] of [
    ["disable", "disabled"],
    ["enable", "loaded"],
  ]) {
    assert.equal(find(await applyPluginAction({ cwd: root, source, action })).status, expected);
    assert.equal(find(await readPlugins(root)).status, expected);
  }
  await assert.rejects(applyPluginAction({ cwd: root, source, action: "remove" }), /global enable and disable/);
  assert.equal((await probePiRuntimeModules("subagents")).bundledSubagentsRoundTrip, true);
});
