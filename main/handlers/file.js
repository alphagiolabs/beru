import { ipcMain, shell } from "electron";
import { showOpenDialog } from "../utils/dialog-history.js";
import fs from "fs";
import path from "path";
import { getMainWindow } from "../shared-state.js";
import { OUTPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc, isTrustedSender } from "../utils/ipc.js";
import { invalidateBeruStatCache } from "../utils/beru-protocol.js";
import { parseExcelBuffer } from "../utils/excel.js";

import { restoreSessionPaths } from "../utils/restore-session-paths.js";

export function registerFileHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.readExcel, async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "excel");
    if (!check.ok) return { success: false, error: check.error };
    const buffer = await fs.promises.readFile(check.resolvedPath);
    if (buffer.length === 0) return { success: false, error: "Empty Excel file data" };
    const { rows, headers } = await parseExcelBuffer(buffer);
    return { success: true, rows, headers };
  });

  handleIpc(IPC_INVOKE.writeExcel, async (_event, filePath, base64Data) => {
    if (typeof base64Data !== "string" || !base64Data) {
      return { success: false, error: "Empty Excel data" };
    }
    if (typeof filePath !== "string" || !filePath.trim()) {
      return { success: false, error: "Ruta inválida" };
    }
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();
    if (ext !== ".xlsx" && ext !== ".xls") {
      return { success: false, error: "Only .xlsx/.xls exports are allowed" };
    }
    const writeTarget = pathSecurity.consumeWritePath(resolved);
    if (!writeTarget) {
      return { success: false, error: "La ruta debe elegirse con el diálogo de guardar" };
    }
    const buf = Buffer.from(base64Data, "base64");
    if (buf.length === 0) return { success: false, error: "Empty Excel buffer" };
    if (buf.length > 25 * 1024 * 1024) {
      return { success: false, error: "Excel export too large (max 25MB)" };
    }
    await fs.promises.writeFile(writeTarget, buf);
    pathSecurity.registerAllowedPath(writeTarget, "excel");
    return { success: true, filePath: writeTarget };
  });

  handleIpc(IPC_INVOKE.statImage, async (_event, imagePath) => {
    const check = pathSecurity.validateReadableFile(imagePath, "image");
    if (!check.ok) return { success: false, error: check.error };
    try {
      const stat = await fs.promises.stat(check.resolvedPath);
      invalidateBeruStatCache(check.resolvedPath);
      return { success: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return { success: false, error: "Archivo no encontrado" };
    }
  });

  handleIpc(IPC_INVOKE.pickImage, async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await showOpenDialog(win, {
      title: "Elegir imagen",
      properties: ["openFile"],
      filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
    const check = pathSecurity.registerSelectedPath(filePaths[0], "image");
    if (!check.ok) return { success: false, error: check.error };
    return { success: true, path: check.resolvedPath };
  });

  handleIpc(IPC_INVOKE.openPath, async (_event, filePath) => {
    const check = pathSecurity.validateShellPath(filePath);
    if (!check.ok) return { success: false, error: check.error };
    filePath = check.resolvedPath;
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Archivo no existe" };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isDirectory() && !OUTPUT_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return { success: false, error: "Sólo se pueden abrir videos de salida o carpetas" };
    }
    const result = await shell.openPath(filePath);
    if (result) return { success: false, error: result };
    return { success: true };
  });

  handleIpc(IPC_INVOKE.showItemInFolder, async (_event, filePath) => {
    const check = pathSecurity.validateShellPath(filePath);
    if (!check.ok) return { success: false, error: check.error };
    if (!fs.existsSync(check.resolvedPath)) {
      return { success: false, error: "Archivo no existe" };
    }
    shell.showItemInFolder(check.resolvedPath);
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE.restoreSessionPaths, (event, payload) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    return restoreSessionPaths(pathSecurity, payload);
  });
}
