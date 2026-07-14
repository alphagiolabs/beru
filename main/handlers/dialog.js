import { ipcMain, dialog } from "electron";
import path from "path";
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
    pathSecurity.registerAllowedPaths(filePaths, "video");
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
    pathSecurity.registerAllowedPath(filePaths[0], "excel");
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

  ipcMain.handle("dialog:saveExcel", async (_event, defaultName = "beru-export.xlsx") => {
    const win = getMainWindow();
    const safeName =
      typeof defaultName === "string" && defaultName.trim()
        ? defaultName.trim().replace(/[<>:"/\\|?*]/g, "_")
        : "beru-export.xlsx";
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Exportar Excel",
      defaultPath: safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (canceled || !filePath) return { canceled: true };
    // File may not exist yet — register parent dir for shell/write allow checks.
    try {
      pathSecurity.registerOutputDirectory(path.dirname(filePath));
    } catch {
      /* best effort */
    }
    return { canceled: false, filePath };
  });
}
