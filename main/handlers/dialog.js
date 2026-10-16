import { ipcMain } from "electron";
import { showOpenDialog, showSaveDialog } from "../utils/dialog-history.js";
import { getMainWindow } from "../shared-state.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { isTrustedSender } from "../utils/ipc.js";
import { readSettings, writeSettings } from "../utils/settings.js";
import { INPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";

export function registerDialogHandlers(pathSecurity) {
  ipcMain.handle(IPC_INVOKE.openVideos, async (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    const win = getMainWindow();
    const { canceled, filePaths } = await showOpenDialog(win, {
      title: "Seleccionar videos",
      filters: [{ name: "Videos", extensions: INPUT_VIDEO_EXTENSIONS }],
      properties: ["openFile", "multiSelections"],
    });
    if (canceled || filePaths.length === 0) return [];
    return pathSecurity.registerSelectedPaths(filePaths, "video");
  });

  ipcMain.handle(IPC_INVOKE.openExcel, async (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
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

  ipcMain.handle(IPC_INVOKE.selectOutputDir, async (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
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
      try {
        writeSettings({ ...readSettings(), lastOutputDirectory: check.resolvedPath });
      } catch (err) {
        console.error("[beru] Could not remember output directory:", err?.message || err);
      }
      return check.resolvedPath;
    } catch (err) {
      console.error("[beru] Error opening output directory dialog:", err);
      return null;
    }
  });

  ipcMain.handle(IPC_INVOKE.saveExcelDialog, async (event, defaultName = "beru-export.xlsx") => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
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
