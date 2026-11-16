import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserWindow } from "electron";
import type { HerdrFleetSnapshot, HerdrRuntimeSnapshot } from "../contract/herdr";
import {
  SUPERAGENT_CLIS,
  type SuperAgentRole,
  type SuperAgentRoom,
  type SuperAgentRuntime,
} from "../contract/superagent";

export async function runSuperAgentSmoke(
  call: <T>(method: string, params?: unknown, timeout?: number) => Promise<T>,
  window: BrowserWindow,
) {
  const probes = await Promise.all(
    SUPERAGENT_CLIS.map(async (cli) =>
      (await call<SuperAgentRuntime[]>("superagent.runtimes", { probe: cli }, 55_000)).find((item) => item.cli === cli),
    ),
  );
  for (const status of probes) assert.equal(status?.state, "ready", `${status?.cli}: ${status?.detail}`);
  console.log("[superagent] all three local CLIs authenticated in the Electron Host");

  const project = path.join(process.env.PI_DESKTOP_SMOKE_USER_DATA!, "superagent-project");
  await mkdir(project);
  await writeFile(path.join(project, "README.md"), "SuperAgent smoke fixture\n");
  await call("system.allowRoot", { path: project });
  const roles = await Promise.all(
    ["claude", "codex"].map((cli) =>
      call<SuperAgentRole>("superagent.roles.save", {
        name: cli,
        cli,
        skillPaths: [],
        instructions:
          cli === "claude"
            ? "Use only the Write tool to create approval-proof.txt in your assigned working folder with exactly SMOKE_OK as its contents. Then reply with the message SMOKE_OK, no delegates, no question."
            : "No tools. Reply with the message SMOKE_OK, no delegates, no question.",
      }),
    ),
  );
  const room = await call<SuperAgentRoom>("superagent.rooms.create", {
    title: "SuperAgent smoke room",
    project,
    roleIds: roles.map((role) => role.id),
    starterId: roles[0].id,
    summarizerId: roles[1].id,
  });
  assert.equal(room.base, null);
  if (window.webContents.isLoadingMainFrame())
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", resolve));
  await waitFor(
    () =>
      window.webContents.executeJavaScript(`(() => {
        const page = document.querySelector('.superagent');
        if (!page) document.querySelector('button[aria-label="SuperAgent"]')?.click();
        return !!page?.querySelector('button[aria-label="Task permissions"], button[aria-label="任务权限"]');
      })()`) as Promise<boolean>,
    Boolean,
    15_000,
  );
  await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('button[aria-label="Task permissions"], button[aria-label="任务权限"]');
    select.click();
  })()`);
  await waitFor(
    () =>
      window.webContents.executeJavaScript(`!!document.querySelector('.u031-list:popover-open')`) as Promise<boolean>,
    Boolean,
    5_000,
  );
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('.u031-list:popover-open [role="option"]')[1].click()`,
  );
  await waitFor(
    () => call<SuperAgentRoom>("superagent.rooms.get", { id: room.id }),
    (snapshot) => snapshot.permissionMode === "workspaceEdits",
    8_000,
  );
  await call("superagent.rooms.send", {
    id: room.id,
    text: "Complete the file write and report SMOKE_OK as instructed.",
  });
  const finished = await waitFor(
    () => call<SuperAgentRoom>("superagent.rooms.get", { id: room.id }),
    (snapshot) => ["done", "error", "approval"].includes(snapshot.status),
    55_000,
  );
  assert.equal(finished.status, "done", finished.approval?.title ?? finished.messages.at(-1)?.text);
  assert.equal(finished.permissionMode, "ask");
  assert.ok(finished.members.every((member) => member.nativeSessionId));
  assert.equal((await readFile(path.join(room.members[0].cwd, "approval-proof.txt"), "utf8")).trim(), "SMOKE_OK");
  console.log("[superagent] selected local edits in the composer, wrote a file, and reset the mode after completion");

  await waitFor(
    () =>
      window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.superagent');
    if (!page) document.querySelector('button[aria-label="SuperAgent"]')?.click();
    return !!page?.textContent?.includes('SuperAgent smoke room') && !!page?.textContent?.includes('SMOKE_OK');
  })()`) as Promise<boolean>,
    Boolean,
    15_000,
  );
  console.log("[superagent] desktop entry rendered the persisted room and messages");

  await waitFor(
    () => call<HerdrRuntimeSnapshot>("herdr.runtime.get"),
    (status) => status.status === "ready",
    12_000,
  );
  for (const member of finished.members) {
    const taken = await call<SuperAgentRoom>("superagent.rooms.handoff", { id: room.id, memberId: member.id }, 75_000);
    const paneId = taken.members.find((item) => item.id === member.id)?.paneId;
    assert.ok(paneId);
    try {
      await waitFor(
        async () => (await call<HerdrFleetSnapshot>("herdr.snapshot")).panes.find((pane) => pane.id === paneId),
        (pane) => pane?.agent?.kind === member.cli,
        14_000,
      );
    } catch (error) {
      const output = await call<{ text: string }>("herdr.pane.read", { paneId, maxBytes: 4_096 });
      throw new Error(`${String(error)}. ${member.cli} terminal tail: ${output.text.slice(-1_000)}`);
    }
    if (member.cli === "claude") {
      await window.webContents.executeJavaScript(`(() => {
        const details = document.querySelector('.superagent-members');
        if (details.hidden) document.querySelector('.sa-inspector-toggle').click();
        const role = [...details.querySelectorAll('.superagent-member')].find((element) => element.querySelector('strong')?.textContent === 'claude');
        [...role.querySelectorAll('button')].find((button) => button.textContent.includes('Herdr')).click();
      })()`);
      await waitFor(
        () =>
          window.webContents.executeJavaScript(`(() => {
          const terminal = document.querySelector('.superagent-terminal');
          const error = terminal?.querySelector('[role="alert"]')?.textContent;
          if (error) throw new Error(error);
          return !!terminal?.querySelector('.xterm-rows')?.textContent?.trim();
        })()`) as Promise<boolean>,
        Boolean,
        15_000,
      );
      console.log("[superagent] Herdr terminal frames rendered in the desktop page");
    }
    await call("superagent.rooms.handoff", { id: room.id, memberId: member.id, close: true });
    console.log(`[superagent] ${member.cli} resumed in Herdr`);
  }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  do {
    latest = await read();
    if (accept(latest)) return latest;
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`SuperAgent smoke timed out: ${String(JSON.stringify(latest)).slice(0, 1_500)}`);
}
