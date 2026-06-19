import { ipcMain, dialog } from "electron";
import { getMainWindow } from "../shared-state.js";

export function registerDialogHandlers(pathSecurity) {
  ipcMain.handle("dialog:openVideos", async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Seleccionar videos",
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "avi", "mkv", "webm"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (canceled || filePaths.length === 0) return [];
    pathSecurity.registerAllowedPaths(filePaths);
    return filePaths;
  });

  ipcMain.handle("dialog:openExcel", async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Seleccionar archivo Excel",
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return null;
    pathSecurity.registerAllowedPath(filePaths[0]);
    return filePaths[0];
  });

  ipcMain.handle("dialog:selectOutputDir", async () => {
    const win = getMainWindow();
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Seleccionar carpeta de salida",
        properties: ["openDirectory", "createDirectory"],
      });
      if (canceled || !filePaths || filePaths.length === 0) return null;
      const check = pathSecurity.registerOutputDirectory(filePaths[0]);
      if (!check.ok) {
        console.error("[beru] Invalid output directory:", check.error);
        return null;
      }
      return check.resolvedPath;
    } catch (err) {
      console.error("[beru] Error opening output directory dialog:", err);
      return null;
    }
  });
}
