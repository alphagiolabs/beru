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

  ipcMain.handle("presets:delete", async (_event, filename) => {
    try {
      if (typeof filename !== "string" || !filename.trim()) {
        return { success: false, error: "Nombre de archivo inválido" };
      }
      // Only allow deleting files inside the user presets directory and only
      // preset files (.beru.json / .json). Bundled presets are read-only.
      const base = path.basename(filename);
      if (!base.toLowerCase().endsWith(".beru.json") && !base.toLowerCase().endsWith(".json")) {
        return { success: false, error: "Tipo de archivo no permitido" };
      }
      const userDir = path.join(app.getPath("userData"), "presets");
      const filePath = path.join(userDir, base);
      try {
        fs.mkdirSync(userDir, { recursive: true });
      } catch {}
      if (!fs.existsSync(filePath)) {
        return { success: false, error: "El preset no existe" };
      }
      // Defense-in-depth: resolve symlinks and confirm the target stays
      // inside the user presets directory.
      const real = fs.realpathSync(filePath).toLowerCase();
      const dirReal = fs.realpathSync(userDir).toLowerCase();
      if (!real.startsWith(dirReal + path.sep) && real !== dirReal) {
        return { success: false, error: "Ruta fuera del directorio de presets" };
      }
      fs.unlinkSync(filePath);
      return { success: true, fileName: base, filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
