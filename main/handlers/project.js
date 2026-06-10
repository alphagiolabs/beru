import { ipcMain, dialog } from "electron";
import fs from "fs";
import { getMainWindow } from "../shared-state.js";

const REQUIRED_PROJECT_FIELDS = ["version", "queue"];
const REQUIRED_QUEUE_ITEM_FIELDS = ["id", "path", "filename"];

function validateQueueItem(item) {
  if (!item || typeof item !== "object") return false;
  for (const field of REQUIRED_QUEUE_ITEM_FIELDS) {
    if (!(field in item)) return false;
  }
  if (typeof item.path !== "string" || !item.path.trim()) return false;
  if (typeof item.filename !== "string" || !item.filename.trim()) return false;
  if (item.operations && !Array.isArray(item.operations)) return false;
  return true;
}

function validateProjectStructure(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "El proyecto debe ser un objeto" };
  }
  for (const field of REQUIRED_PROJECT_FIELDS) {
    if (!(field in data)) {
      return { valid: false, error: `Campo requerido faltante: ${field}` };
    }
  }
  if (!Array.isArray(data.queue)) {
    return { valid: false, error: "queue debe ser un array" };
  }
  for (let i = 0; i < data.queue.length; i++) {
    if (!validateQueueItem(data.queue[i])) {
      return { valid: false, error: `Item de queue inválido en posición ${i}` };
    }
  }
  return { valid: true };
}

export function registerProjectHandlers(pathSecurity) {
  ipcMain.handle("project:save", async (_event, payload) => {
    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Guardar proyecto Beru",
      defaultPath: "proyecto.beru.json",
      filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      const validation = validateProjectStructure(payload);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
      return { success: true, filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("project:load", async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Cargar proyecto Beru",
      properties: ["openFile"],
      filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
    pathSecurity.registerAllowedPath(filePaths[0]);
    const check = pathSecurity.validateReadableFile(filePaths[0], "project");
    if (!check.ok) return { success: false, error: check.error };
    try {
      const raw = fs.readFileSync(check.resolvedPath, "utf8");
      const data = JSON.parse(raw);
      const validation = validateProjectStructure(data);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      return { success: true, filePath: check.resolvedPath, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("project:loadFromPath", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "project");
    if (!check.ok) return { success: false, error: check.error };
    try {
      if (!fs.existsSync(check.resolvedPath)) {
        return { success: false, error: "Archivo no encontrado", missing: true };
      }
      const raw = fs.readFileSync(check.resolvedPath, "utf8");
      const data = JSON.parse(raw);
      const validation = validateProjectStructure(data);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      pathSecurity.registerAllowedPath(check.resolvedPath);
      return { success: true, filePath: check.resolvedPath, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
