import assert from "node:assert/strict";
import test from "node:test";

import { enUS, zhCN, zhTW } from "../i18n-dictionaries.ts";
import {
  OPEN_IN_APP_STORAGE_KEY,
  describeOpenInApps,
  openInAppLabel,
  readOpenInAppChoice,
  selectOpenInApp,
  writeOpenInAppChoice,
} from "./open-in-app.ts";

/** Translator over one registered dictionary. */
function translator(dictionary) {
  return (key, fallback) => dictionary[key] ?? fallback;
}

/** In-memory storage with the surface the preference helpers use. */
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[OPEN_IN_APP_STORAGE_KEY, initial]]);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const HOST_APPLICATIONS = [
  { id: "explorer", icon: "data:explorer" },
  { id: "cursor", icon: null },
  { id: "vscode", icon: "data:vscode" },
  { id: "unknownProduct", icon: null },
];

test("application ids map to localized or product labels", () => {
  assert.equal(openInAppLabel("explorer", translator(enUS)), "File Explorer");
  assert.equal(openInAppLabel("explorer", translator(zhCN)), "文件资源管理器");
  assert.equal(openInAppLabel("explorer", translator(zhTW)), "檔案總管");
  assert.equal(openInAppLabel("terminal", translator(zhCN)), "终端");
  assert.equal(openInAppLabel("intellij", translator(zhCN)), "IntelliJ IDEA");
  assert.equal(openInAppLabel("gitbash", translator(enUS)), "Git Bash");
  assert.equal(openInAppLabel("unknownProduct", translator(enUS)), null);
});

test("only nameable applications reach the menu, in host order", () => {
  const applications = describeOpenInApps(HOST_APPLICATIONS, translator(zhCN));
  assert.deepEqual(
    applications.map((application) => application.id),
    ["explorer", "cursor", "vscode"],
  );
  assert.equal(applications[0]?.name, "文件资源管理器");
  assert.equal(applications[1]?.icon, null);
});

test("the remembered application wins while it is still installed", () => {
  const applications = describeOpenInApps(HOST_APPLICATIONS, translator(enUS));
  assert.equal(selectOpenInApp(applications, "vscode")?.id, "vscode");
  // A remembered id that this host no longer lists falls back to the first entry.
  assert.equal(selectOpenInApp(applications, "zed")?.id, "explorer");
  assert.equal(selectOpenInApp(applications, null)?.id, "explorer");
  assert.equal(selectOpenInApp([], "vscode"), undefined);
});

test("the choice persists and unreadable storage never throws", () => {
  const storage = memoryStorage();
  assert.equal(readOpenInAppChoice(storage), null);
  writeOpenInAppChoice("cursor", storage);
  assert.equal(storage.values.get(OPEN_IN_APP_STORAGE_KEY), "cursor");
  assert.equal(readOpenInAppChoice(storage), "cursor");

  const broken = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  assert.equal(readOpenInAppChoice(broken), null);
  writeOpenInAppChoice("cursor", broken);
  assert.equal(readOpenInAppChoice(null), null);
  writeOpenInAppChoice("cursor", null);
});
