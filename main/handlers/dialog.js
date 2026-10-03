import { ipcMain } from "electron";
import { showOpenDialog, showSaveDialog } from "../utils/dialog-history.js";
import { getMainWindow } from "../shared-state.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";

export function registerDialogHandlers(pathSecurity) {
  ipcMain.handle(IPC_INVOKE.openVideos, async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await showOpenDialog(win, {
      title: "Seleccionar videos",
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "avi", "mkv", "webm"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (canceled || filePaths.length === 0) return [];
    return pathSecurity.registerSelectedPaths(filePaths, "video");
  });

  ipcMain.handle(IPC_INVOKE.openExcel, async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await showOpenDialog(win, {
      title: "Seleccionar archivo Excel",
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return null;
    const check = pathSecurity.registerSelectedPath(filePaths[0], "excel");
    return check.ok ? check.resolvedPath : null;
  });

  ipcMain.handle(IPC_INVOKE.selectOutputDir, async () => {
    const win = getMainWindow();
    try {
      const { canceled, filePaths } = await showOpenDialog(win, {
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

  ipcMain.handle(IPC_INVOKE.saveExcelDialog, async (_event, defaultName = "beru-export.xlsx") => {
    const win = getMainWindow();
    const safeName =
      typeof defaultName === "string" && defaultName.trim()
        ? defaultName.trim().replace(/[<>:"/\\|?*]/g, "_")
        : "beru-export.xlsx";
    const { canceled, filePath } = await showSaveDialog(win, {
      title: "Exportar Excel",
      defaultPath: safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (canceled || !filePath) return { canceled: true };
    pathSecurity.registerWritePath(filePath);
    return { canceled: false, filePath };
  });
}
