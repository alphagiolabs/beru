import { ipcMain, app } from "electron";
import path from "path";
import fs from "fs";
import { readPresetsFromDir } from "../utils/presets.js";
import { PRESET_TYPE } from "../../shared/project-document.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";

function userPresetsDir() {
  const userDir = path.join(app.getPath("userData"), "presets");
  try {
    fs.mkdirSync(userDir, { recursive: true });
  } catch {}
  return userDir;
}

export function registerPresetHandlers() {
  ipcMain.handle(IPC_INVOKE.listPresets, async () => {
    try {
      const userDir = userPresetsDir();
      return { success: true, presets: readPresetsFromDir(userDir), userDir };
    } catch (e) {
      return { success: false, error: e.message, presets: [] };
    }
  });

  handleIpc(IPC_INVOKE.savePreset, async (_event, name, jsonStr) => {
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
    if (!parsed || parsed.type !== PRESET_TYPE) {
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
    const userDir = userPresetsDir();
    const filePath = path.join(userDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return { success: true, fileName, filePath, userDir };
  });

  handleIpc(IPC_INVOKE.deletePreset, async (_event, filename) => {
    if (typeof filename !== "string" || !filename.trim()) {
      return { success: false, error: "Nombre de archivo inválido" };
    }
    const base = path.basename(filename);
    if (!base.toLowerCase().endsWith(".json")) {
      return { success: false, error: "Tipo de archivo no permitido" };
    }
    const userDir = userPresetsDir();
    const filePath = path.join(userDir, base);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "El preset no existe" };
    }
    const real = fs.realpathSync(filePath).toLowerCase();
    const dirReal = fs.realpathSync(userDir).toLowerCase();
    if (!real.startsWith(dirReal + path.sep) && real !== dirReal) {
      return { success: false, error: "Ruta fuera del directorio de presets" };
    }
    fs.unlinkSync(filePath);
    return { success: true, fileName: base, filePath };
  });
}
