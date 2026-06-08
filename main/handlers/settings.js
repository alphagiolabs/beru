import { ipcMain } from "electron";
import { getMainWindow } from "../shared-state.js";
import { readSettings, writeSettings } from "../utils/settings.js";
import { applyWindowTheme } from "../utils/windowTheme.js";

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
      if (partial.theme !== undefined) {
        applyWindowTheme(getMainWindow(), next.theme);
      }
      return { success: true, settings: next };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("window:setTheme", async (_event, theme) => {
    applyWindowTheme(getMainWindow(), theme);
    return { success: true };
  });
}
