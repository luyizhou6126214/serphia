import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { PresentationStore, validatePresentation } from "./store";

export function createPresentationIpc() {
  const store = new PresentationStore(path.join(app.getPath("userData"), "presentations"));
  return {
    list: (_event: IpcMainInvokeEvent, cwd: string | null) => store.list(cwd),
    load: (_event: IpcMainInvokeEvent, cwd: string | null, id: string) => store.load(cwd, id),
    save: (_event: IpcMainInvokeEvent, cwd: string | null, deck: unknown, revision: number) =>
      store.save(cwd, deck, revision),
    export: async (event: IpcMainInvokeEvent, value: unknown) => {
      const deck = validatePresentation(value);
      const parent = BrowserWindow.fromWebContents(event.sender);
      const basename = deck.title
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/, "");
      const options = {
        defaultPath: (basename || "Presentation") + ".pptx",
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
      };
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      const filename = result.filePath;
      const { renderPptx } = await import("./export");
      await writeFile(filename, await renderPptx(deck));
      return filename;
    },
  };
}
