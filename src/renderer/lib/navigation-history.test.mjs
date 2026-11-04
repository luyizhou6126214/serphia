import assert from "node:assert/strict";
import test from "node:test";
import { recordNavigation } from "./navigation-history.ts";

const same = (a, b) => a.id === b.id;
test("history records navigation, updates the current view, and drops forward entries after branching", () => {
  let history = { entries: [{ id: "a", title: "A" }], index: 0 };
  history = recordNavigation(history, { id: "b" }, same);
  history = recordNavigation(history, { id: "settings" }, same);
  assert.deepEqual(
    history.entries.map((entry) => entry.id),
    ["a", "b", "settings"],
  );
  history = { ...history, index: 1 };
  history = recordNavigation(history, { id: "b", title: "renamed" }, same);
  assert.equal(history.entries[1].title, "renamed");
  assert.equal(history.entries.length, 3);
  history = recordNavigation(history, { id: "c" }, same);
  assert.deepEqual(
    history.entries.map((entry) => entry.id),
    ["a", "b", "c"],
  );
  assert.equal(history.index, 2);
  history = recordNavigation(history, { id: "created" }, same, true);
  assert.deepEqual(
    history.entries.map((entry) => entry.id),
    ["a", "b", "created"],
  );
});
