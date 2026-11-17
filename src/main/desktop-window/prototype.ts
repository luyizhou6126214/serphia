import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import { getNativeLanguage } from "../native-language";
import type { DriverWindow } from "./driver";
import { resolveDesktopWindowDriver } from "./runtime";
import { DesktopWindowPrototype } from "./service";

const pageSize = 4;

function display(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/gu, " ").slice(0, limit);
}

export async function pickDesktopWindow(
  window: BrowserWindow,
  targets: readonly DriverWindow[],
  appHint: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  const zh = getNativeLanguage() === "zh-CN";
  const hint = appHint?.toLowerCase();
  const match = ({ app_name, title }: DriverWindow) =>
    Boolean(hint && (app_name.toLowerCase().includes(hint) || title.toLowerCase().includes(hint)));
  const ordered = [...targets].sort((a, b) => Number(match(b)) - Number(match(a)));
  const dialogSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const title = zh ? "控制桌面应用" : "Control a desktop app";
  const detail = zh
    ? "请选择一个已打开的窗口。窗口内容可能发送给所选模型并保存在会话中。切到其他窗口会停止控制。"
    : "Choose an open window. Its contents may be sent to the selected model and saved with the chat. Switching to another window stops control.";
  let page = 0;
  while (!dialogSignal.aborted && !window.isDestroyed()) {
    const first = page * pageSize;
    const options = ordered.slice(first, first + pageSize);
    const buttons = options.map(({ app_name, title: windowTitle }) =>
      `${display(app_name, 35)} · ${display(windowTitle, 72)}`.replaceAll("&", "&&"),
    );
    const more = first + pageSize < ordered.length;
    const browse = ordered.length > pageSize;
    if (browse) buttons.push(more ? (zh ? "更多窗口" : "More windows") : zh ? "回到第一页" : "First page");
    const cancelId = buttons.length;
    buttons.push(zh ? "取消" : "Cancel");
    const decision = await dialog.showMessageBox(window, {
      type: "question",
      title,
      message: appHint
        ? zh
          ? `选择用于 ${display(appHint, 80)} 任务的窗口`
          : `Choose a window for ${display(appHint, 80)}`
        : title,
      detail,
      buttons,
      defaultId: cancelId,
      cancelId,
      signal: dialogSignal,
    });
    if (dialogSignal.aborted) return;
    if (decision.response < options.length) return options[decision.response]?.id;
    if (!browse || decision.response !== options.length) return;
    page = more ? page + 1 : 0;
  }
}

export function createDesktopWindowPrototype(
  getWindow: () => BrowserWindow | null,
): DesktopWindowPrototype | undefined {
  const executable = resolveDesktopWindowDriver({
    platform: process.platform,
    arch: process.arch,
    resourceRoot: app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "out", "native"),
  });
  if (!executable) return;
  return new DesktopWindowPrototype(
    executable,
    (targets, appHint, signal) => {
      const window = getWindow();
      if (!window || window.isDestroyed() || !window.isVisible()) return Promise.resolve(undefined);
      return pickDesktopWindow(window, targets, appHint, signal);
    },
    process.pid,
    async (target, signal) => {
      const window = getWindow();
      if (!window || window.isDestroyed()) return false;
      const zh = getNativeLanguage() === "zh-CN";
      const dialogSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const result = await dialog.showMessageBox(window, {
        type: "info",
        title: zh ? "切换到选中的窗口" : "Switch to the selected window",
        message: display(target.title, 100),
        detail: zh
          ? "Windows 未能自动切换窗口。点击继续后，请在 8 秒内切到上面这个窗口。"
          : "Windows could not bring this window forward. After you click Continue, switch to it within 8 seconds.",
        buttons: zh ? ["继续", "取消"] : ["Continue", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        signal: dialogSignal,
      });
      return result.response === 0 && !dialogSignal.aborted;
    },
  );
}
