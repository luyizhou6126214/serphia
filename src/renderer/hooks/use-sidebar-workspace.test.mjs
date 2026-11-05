import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { useSidebarWorkspace, getRecentProjects, calls } = await importTestBundle("default-workspace-sidebar", {
  stdin: {
    resolveDir: import.meta.dirname,
    loader: "ts",
    contents:
      'export {useSidebarWorkspace,getRecentProjects} from "./useSidebarWorkspace.ts"; export {calls} from "@/lib/api-client";',
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react"],
  plugins: [
    {
      name: "workspace-api",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api", namespace: "workspace-test" }));
        build.onLoad({ filter: /.*/, namespace: "workspace-test" }, () => ({
          contents: `export const calls=[]; export async function call(method, params) {
          calls.push({method, params});
          if (method === 'system.home') return {home:'/home'};
          return {projectRoot:params.projectRoot,isGit:false,isTopLevel:true,worktrees:[]};
        }`,
        }));
      },
    },
  ],
});

test("default workspaces stay outside the project list and skip worktree discovery on both platforms", async (t) => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  let current,
    renderer,
    selectedCwd = "/project";
  function Probe() {
    current = useSidebarWorkspace({ allSessions: [], selectedCwd, projectInfoRevision: 0 });
    return null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  assert.equal(current.selectedProject, "/project");
  const reads = calls.filter((call) => call.method === "worktrees.list").length;
  assert.equal(reads, 1);
  for (const cwd of [
    "",
    "/Users/demo/Documents/Serphia/2026-11-04/0123456789abcdef0123456789abcdef",
    "D:\\OneDrive\\Documents\\Serphia\\2026-11-04\\0123456789abcdef0123456789abcdef",
  ]) {
    selectedCwd = cwd;
    await act(async () => renderer.update(createElement(Probe)));
    assert.equal(current.selectedCwd, cwd);
    assert.equal(current.selectedProject, null);
    assert.equal(current.worktreeState, null);
    assert.equal(current.worktreeLoadingCwd, null);
    assert.equal(calls.filter((call) => call.method === "worktrees.list").length, reads);
    assert.deepEqual(
      getRecentProjects([
        { cwd, modified: "2026-11-04" },
        { cwd: "/project", modified: "2026-11-04" },
      ]),
      ["/project"],
    );
  }
});
