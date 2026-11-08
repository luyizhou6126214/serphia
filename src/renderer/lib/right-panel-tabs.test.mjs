import assert from "node:assert/strict";
import test from "node:test";

import {
  FILES_TAB_ID,
  GUIDE_TAB_ID,
  PROCESSES_TAB_ID,
  activeRightPanelTab,
  browserTabId,
  createRightPanelState,
  fileTabId,
  isClosableRightPanelTab,
  reduceRightPanelState,
  rightPanelTabTitle,
  rightPanelWidthKind,
  terminalTabId,
} from "./right-panel-tabs.ts";

const FILE_TAB = {
  id: fileTabId("C:/work/project/a.ts"),
  kind: "file",
  title: "a.ts",
  filePath: "C:/work/project/a.ts",
};
const SECOND_FILE_TAB = {
  id: fileTabId("C:/work/project/b.ts"),
  kind: "file",
  title: "b.ts",
  filePath: "C:/work/project/b.ts",
};
const TERMINAL_TAB = { id: terminalTabId("terminal-1"), kind: "terminal", title: "Terminal", terminalId: "terminal-1" };

test("the guide is the panel's home tab and the only one that cannot close", () => {
  const state = createRightPanelState();
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [GUIDE_TAB_ID],
  );
  assert.equal(state.activeTabId, GUIDE_TAB_ID);
  assert.equal(isClosableRightPanelTab(state.tabs[0]), false);
  assert.equal(reduceRightPanelState(state, { type: "close", tabId: GUIDE_TAB_ID }), state);
});

test("opening a tab appends it and makes it active, and reopening focuses it", () => {
  let state = createRightPanelState();
  state = reduceRightPanelState(state, { type: "open", tab: FILE_TAB });
  state = reduceRightPanelState(state, { type: "open", tab: TERMINAL_TAB });
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [GUIDE_TAB_ID, FILE_TAB.id, TERMINAL_TAB.id],
  );
  assert.equal(state.activeTabId, TERMINAL_TAB.id);

  state = reduceRightPanelState(state, { type: "select", tabId: GUIDE_TAB_ID });
  assert.equal(state.activeTabId, GUIDE_TAB_ID);

  state = reduceRightPanelState(state, { type: "open", tab: { ...TERMINAL_TAB, title: "Renamed" } });
  assert.equal(state.tabs.length, 3);
  assert.equal(activeRightPanelTab(state).title, "Renamed");
});

test("closing a tab activates its neighbour, and closing the last one returns to the guide", () => {
  let state = createRightPanelState();
  state = reduceRightPanelState(state, { type: "open", tab: FILE_TAB });
  state = reduceRightPanelState(state, { type: "open", tab: SECOND_FILE_TAB });
  state = reduceRightPanelState(state, { type: "open", tab: TERMINAL_TAB });
  assert.equal(state.activeTabId, TERMINAL_TAB.id);

  state = reduceRightPanelState(state, { type: "close", tabId: TERMINAL_TAB.id });
  assert.equal(state.activeTabId, SECOND_FILE_TAB.id);

  state = reduceRightPanelState(state, { type: "close", tabId: FILE_TAB.id });
  assert.equal(state.activeTabId, SECOND_FILE_TAB.id, "closing an inactive tab keeps the selection");

  state = reduceRightPanelState(state, { type: "close", tabId: SECOND_FILE_TAB.id });
  assert.equal(state.activeTabId, GUIDE_TAB_ID);
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [GUIDE_TAB_ID],
  );
});

test("titles update in place and a resource id never duplicates", () => {
  let state = createRightPanelState();
  state = reduceRightPanelState(state, { type: "open", tab: { ...TERMINAL_TAB, title: "bash" } });
  state = reduceRightPanelState(state, { type: "title", tabId: TERMINAL_TAB.id, title: "npm run dev" });
  assert.equal(activeRightPanelTab(state).title, "npm run dev");
  assert.equal(state.tabs.length, 2);

  const same = reduceRightPanelState(state, { type: "title", tabId: TERMINAL_TAB.id, title: "npm run dev" });
  assert.equal(same, state, "an unchanged title leaves the state identical");
  const missing = reduceRightPanelState(state, { type: "title", tabId: "nope", title: "x" });
  assert.equal(missing, state);
});

test("resetting returns the panel to the guide alone", () => {
  let state = reduceRightPanelState(createRightPanelState(), { type: "open", tab: FILE_TAB });
  state = reduceRightPanelState(state, { type: "reset" });
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [GUIDE_TAB_ID],
  );
  assert.equal(state.activeTabId, GUIDE_TAB_ID);
});

test("page labels come from copy while resource tabs keep their captured title", () => {
  const t = (key, fallback) => (key === "rightPanelStart" ? "开始" : key === "rightPanelFiles" ? "文件" : fallback);
  assert.equal(rightPanelTabTitle({ id: GUIDE_TAB_ID, kind: "guide", title: "" }, t), "开始");
  assert.equal(rightPanelTabTitle({ id: FILES_TAB_ID, kind: "files", title: "" }, t), "文件");
  assert.equal(rightPanelTabTitle({ id: PROCESSES_TAB_ID, kind: "processes", title: "" }, t), "Managed processes");
  assert.equal(rightPanelTabTitle(FILE_TAB, t), "a.ts");
  assert.equal(rightPanelTabTitle({ id: browserTabId("b1"), kind: "browser", title: "Docs" }, t), "Docs");
});

test("panel width preferences follow the active kind", () => {
  assert.equal(rightPanelWidthKind({ id: GUIDE_TAB_ID, kind: "guide", title: "" }), "files");
  assert.equal(rightPanelWidthKind(FILE_TAB), "files");
  assert.equal(rightPanelWidthKind({ id: FILES_TAB_ID, kind: "files", title: "" }), "files");
  assert.equal(rightPanelWidthKind(TERMINAL_TAB), "terminal");
  assert.equal(rightPanelWidthKind({ id: browserTabId("b1"), kind: "browser", title: "" }), "browser");
  assert.equal(rightPanelWidthKind({ id: PROCESSES_TAB_ID, kind: "processes", title: "" }), "processes");
});
