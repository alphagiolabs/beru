import { ipcMain } from "electron";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { readPresetsFromDir } from "../utils/presets.js";

export function registerPresetHandlers() {
  ipcMain.handle("presets:list", async () => {
    try {
      const isPackaged = app.isPackaged;
      const bundledDir = isPackaged
        ? path.join(process.resourcesPath, "presets")
        : path.join(app.getAppPath(), "resources", "presets");

      const userDir = path.join(app.getPath("userData"), "presets");
      try {
        fs.mkdirSync(userDir, { recursive: true });
      } catch {}

      const bundled = readPresetsFromDir(bundledDir, "bundled");
      const user = readPresetsFromDir(userDir, "user");

      return { success: true, presets: [...bundled, ...user], userDir };
    } catch (e) {
      return { success: false, error: e.message, presets: [] };
    }
  });

  ipcMain.handle("presets:save", async (_event, name, jsonStr) => {
    try {
      if (typeof name !== "string" || !name.trim()) {
        return { success: false, error: "Nombre inválido" };
      }
      if (typeof jsonStr !== "string" || !jsonStr.trim()) {
        return { success: false, error: "Datos inválidos" };
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        return { success: false, error: "JSON inválido: " + e.message };
      }
      if (!parsed || parsed.type !== "beru-preset") {
        return { success: false, error: "Falta type: 'beru-preset'" };
      }
      const safeBase = name
        .trim()
        .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
        .replace(/^\.+/, "_")
        .slice(0, 80);
      if (!safeBase) return { success: false, error: "Nombre inválido" };
      const fileName = safeBase.toLowerCase().endsWith(".beru.json")
        ? safeBase
        : `${safeBase}.beru.json`;
      const userDir = path.join(app.getPath("userData"), "presets");
      try {
        fs.mkdirSync(userDir, { recursive: true });
      } catch {}
      const filePath = path.join(userDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
      return { success: true, fileName, filePath, userDir };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
