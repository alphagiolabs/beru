import { ipcMain } from "electron";
import { readSettings, writeSettings } from "../utils/settings.js";

export function registerSettingsHandlers() {
  ipcMain.handle("settings:load", async () => {
    return readSettings();
  });

  ipcMain.handle("settings:save", async (_event, partial) => {
    try {
      if (!partial || typeof partial !== "object")
        return { success: false, error: "Payload inválido" };
      const current = readSettings();
      const next = { ...current, ...partial };
      writeSettings(next);
      return { success: true, settings: next };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
