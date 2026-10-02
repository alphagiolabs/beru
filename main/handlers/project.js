import { ipcMain, dialog } from "electron";
import fs from "fs";
import { getMainWindow } from "../shared-state.js";
import { validateProjectDocument } from "../../shared/project-document.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";

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
  handleIpc(IPC_INVOKE.saveProject, async (_event, payload) => {
    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Guardar proyecto Beru",
      defaultPath: "proyecto.beru.json",
      filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    const validation = validateProjectDocument(payload);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return { success: true, filePath };
  });

  handleIpc(IPC_INVOKE.loadProject, async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Cargar proyecto Beru",
      properties: ["openFile"],
      filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
    const check = pathSecurity.registerSelectedPath(filePaths[0], "project");
    if (!check.ok) return { success: false, error: check.error };
    return await readValidatedProject(check.resolvedPath);
  });

  ipcMain.handle(IPC_INVOKE.loadProjectFromPath, async (_event, filePath) => {
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
