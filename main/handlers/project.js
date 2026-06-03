import { ipcMain, dialog } from "electron";
import fs from "fs";
import { getMainWindow } from "../shared-state.js";

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
      pathSecurity.registerAllowedPath(check.resolvedPath);
      return { success: true, filePath: check.resolvedPath, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
