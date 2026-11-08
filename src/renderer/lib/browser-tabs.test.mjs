import assert from "node:assert/strict";
import test from "node:test";

import { applyBrowserEvent, browserTabLabel, browserTabsForSession } from "./browser-tabs.ts";

/** One browser tab with the fields the helpers read. */
function tab(id, overrides = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: "",
    ownerSessionId: null,
    loading: false,
    crashed: false,
    canGoBack: false,
    canGoForward: false,
    control: "user",
    advanced: false,
    advancedProfile: false,
    profileId: "temporary",
    lastActiveAt: 0,
    ...overrides,
  };
}

/** A renderer snapshot holding `tabs` and `activeTabId`. */
function snapshot(tabs, activeTabId = null) {
  return {
    tabs,
    activeTabId,
    profiles: [],
    settings: { settings: { enabled: true }, runtime: { policyRevision: 1 } },
    permissionRequests: [],
    downloads: [],
    capabilities: {},
  };
}

test("tab events add, update, close, and follow the active tab", () => {
  let state = snapshot([]);
  state = applyBrowserEvent(state, { type: "tab-created", tab: tab("a") });
  state = applyBrowserEvent(state, { type: "tab-created", tab: tab("b") });
  assert.deepEqual(
    state.tabs.map((entry) => entry.id),
    ["a", "b"],
  );
  state = applyBrowserEvent(state, { type: "active-tab-changed", tabId: "b" });
  assert.equal(state.activeTabId, "b");
  state = applyBrowserEvent(state, { type: "tab-updated", tab: tab("a", { title: "Docs" }) });
  assert.equal(state.tabs[0].title, "Docs");
  state = applyBrowserEvent(state, { type: "tab-closed", tabId: "b" });
  assert.deepEqual(
    state.tabs.map((entry) => entry.id),
    ["a"],
  );
  assert.equal(state.activeTabId, null);
});

test("unrelated events leave the snapshot identical", () => {
  const state = snapshot([tab("a")], "a");
  assert.equal(applyBrowserEvent(state, { type: "tab-updated", tab: tab("a") }) === state, false);
  assert.equal(applyBrowserEvent(state, { type: "something-else" }), state, "an unknown event is not a tab change");
});

test("tabs are scoped to the Session that owns them, plus session-neutral ones", () => {
  const tabs = [tab("mine", { ownerSessionId: "s1" }), tab("shared"), tab("other", { ownerSessionId: "s2" })];
  assert.deepEqual(
    browserTabsForSession(tabs, "s1").map((entry) => entry.id),
    ["mine", "shared"],
  );
  assert.deepEqual(
    browserTabsForSession(tabs, "s2").map((entry) => entry.id),
    ["shared", "other"],
  );
  assert.deepEqual(
    browserTabsForSession(tabs, null).map((entry) => entry.id),
    ["shared"],
    "a new-session draft sees only the neutral tabs",
  );
});

test("a chip label prefers the document title and falls back to the host", () => {
  assert.equal(browserTabLabel(tab("a", { title: "  DeepSeek  " })), "DeepSeek");
  assert.equal(browserTabLabel(tab("a", { url: "https://docs.example.com/guide" })), "docs.example.com");
  assert.equal(browserTabLabel(tab("a", { url: "about:blank" })), "about:blank");
});
