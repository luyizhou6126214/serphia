import assert from "node:assert/strict";
import test from "node:test";

import { launchArguments } from "./command.ts";

test("the workspace directory replaces every path token", () => {
  assert.deepEqual(launchArguments(["--cd={path}"], "C:/work/project"), ["--cd=C:/work/project"]);
  assert.deepEqual(launchArguments(["-d", "{path}"], "C:/work/project"), ["-d", "C:/work/project"]);
  assert.deepEqual(launchArguments(["--new-window={path}", "{path}"], "/tmp/project"), [
    "--new-window=/tmp/project",
    "/tmp/project",
  ]);
});

test("a launcher without a token receives the directory as its last argument", () => {
  assert.deepEqual(launchArguments([], "C:/work/project"), ["C:/work/project"]);
  assert.deepEqual(launchArguments(["-a", "/Applications/Cursor.app"], "/tmp/project"), [
    "-a",
    "/Applications/Cursor.app",
    "/tmp/project",
  ]);
});
