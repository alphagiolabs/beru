import { ipcMain, dialog } from "electron";
import fs from "fs";
import { getMainWindow } from "../shared-state.js";
import { validateProjectDocument } from "../../shared/project-document.js";

async function readValidatedProject(resolvedPath) {
  const raw = await fs.promises.readFile(resolvedPath, "utf8");
  const data = JSON.parse(raw);
  const validation = validateProjectDocument(data);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  return { success: true, filePath: resolvedPath, data };
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
      const validation = validateProjectDocument(payload);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
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
    pathSecurity.registerAllowedPath(filePaths[0], "project");
    const check = pathSecurity.validateReadableFile(filePaths[0], "project");
    if (!check.ok) return { success: false, error: check.error };
    try {
      return await readValidatedProject(check.resolvedPath);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("project:loadFromPath", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "project");
    if (!check.ok) return { success: false, error: check.error };
    try {
      const loaded = await readValidatedProject(check.resolvedPath);
      if (!loaded.success) return loaded;
      pathSecurity.registerAllowedPath(check.resolvedPath, "project");
      return loaded;
    } catch (e) {
      if (e?.code === "ENOENT") {
        return { success: false, error: "Archivo no encontrado", missing: true };
      }
      return { success: false, error: e.message };
    }
  });
}
