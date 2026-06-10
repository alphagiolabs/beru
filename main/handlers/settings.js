import { ipcMain } from "electron";
import { getMainWindow } from "../shared-state.js";
import { readSettings, writeSettings, ALLOWED_SETTINGS_KEYS } from "../utils/settings.js";
import { applyWindowTheme } from "../utils/windowTheme.js";

export function registerSettingsHandlers() {
  ipcMain.handle("settings:load", async () => {
    return readSettings();
  });

  ipcMain.handle("settings:save", async (_event, partial) => {
    try {
      if (!partial || typeof partial !== "object")
        return { success: false, error: "Payload inválido" };
      
      const sanitized = {};
      for (const key of ALLOWED_SETTINGS_KEYS) {
        if (key in partial) {
          sanitized[key] = partial[key];
        }
      }
      
      if (Object.keys(sanitized).length === 0) {
        return { success: false, error: "No hay claves válidas para guardar" };
      }
      
      const current = readSettings();
      const next = { ...current, ...sanitized };
      writeSettings(next);
      if (sanitized.theme !== undefined) {
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
