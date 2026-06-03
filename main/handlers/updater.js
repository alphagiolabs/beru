import { ipcMain, shell } from "electron";
import * as updater from "../updater.js";

export function registerUpdaterHandlers() {
  ipcMain.handle("updater:check", async () => {
    return await updater.checkForUpdates();
  });

  ipcMain.handle("updater:download", async () => {
    return await updater.startDownload();
  });

  ipcMain.handle("updater:install", () => {
    updater.install();
    return { ok: true };
  });

  ipcMain.handle("updater:checkGitHub", async () => {
    return await updater.checkGitHubRelease();
  });

  ipcMain.handle("shell:openExternal", async (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { success: false, error: "URL inválida" };
    }
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });
}
