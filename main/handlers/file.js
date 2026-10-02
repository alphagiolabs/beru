import { ipcMain, shell, dialog } from "electron";
import fs from "fs";
import path from "path";
import { getMainWindow } from "../shared-state.js";
import { OUTPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";
import { IMAGE_CONTENT_TYPES } from "../utils/beru-protocol.js";
import { parseExcelBuffer } from "../utils/excel.js";

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

  handleIpc(IPC_INVOKE.readImage, async (_event, imagePath) => {
    const check = pathSecurity.validateReadableFile(imagePath, "image");
    if (!check.ok) return { success: false, error: check.error };
    const ext = path.extname(check.resolvedPath).toLowerCase();
    const mime = IMAGE_CONTENT_TYPES[ext];
    if (!mime) {
      return { success: false, error: `Formato no soportado: ${ext}` };
    }
    const buf = await fs.promises.readFile(check.resolvedPath);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { success: true, dataUrl, size: buf.length, mime };
  });

  handleIpc(IPC_INVOKE.pickImage, async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
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

  ipcMain.handle(IPC_INVOKE.restoreSessionPaths, async (_event, payload = {}) => {
    const result = { ok: true, outputDir: null, videos: 0, excel: false, errors: [] };
    const outputDir = payload?.outputDir;
    if (outputDir) {
      const check = pathSecurity.registerOutputDirectory(outputDir);
      if (check.ok) {
        result.outputDir = check.resolvedPath;
      } else {
        result.errors.push(check.error || "outputDir");
      }
    }
    const videoPaths = Array.isArray(payload?.videoPaths) ? payload.videoPaths : [];
    for (const videoPath of videoPaths) {
      const check = pathSecurity.registerAllowedPath(videoPath, "video");
      if (check.ok) {
        result.videos += 1;
      } else {
        result.errors.push(check.error || videoPath);
      }
    }
    if (payload?.excelPath) {
      const check = pathSecurity.registerAllowedPath(payload.excelPath, "excel");
      if (check.ok) {
        result.excel = true;
      } else {
        result.errors.push(check.error || "excel");
      }
    }
    return result;
  });
}
