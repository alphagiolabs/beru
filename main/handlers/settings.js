import { ipcMain } from "electron";
import { getMainWindow } from "../shared-state.js";
import { readSettings, writeSettings, ALLOWED_SETTINGS_KEYS } from "../utils/settings.js";
import { applyWindowTheme } from "../utils/windowTheme.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";

export function registerSettingsHandlers() {
  ipcMain.handle(IPC_INVOKE.loadSettings, async () => {
    return readSettings();
  });

  handleIpc(IPC_INVOKE.saveSettings, async (_event, partial) => {
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
  });

  handleIpc(IPC_INVOKE.setWindowTheme, async (_event, themeOrColors) => {
    applyWindowTheme(getMainWindow(), themeOrColors);
    return { success: true };
  });
}
