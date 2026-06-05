import { ipcMain } from "electron";
import os from "os";
import { probeVideo, probeVideoFast } from "../utils/video-cache.js";
import { extractThumbnail } from "../utils/thumbnail.js";
import { runWithConcurrency } from "../utils/concurrency.js";

export function registerVideoHandlers(pathSecurity) {
  ipcMain.handle("fs:getVideoInfo", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return { exists: false, width: 0, height: 0, duration: 0, error: check.error };
    try {
      return await probeVideo(check.resolvedPath);
    } catch {
      return { exists: true, width: 0, height: 0, duration: 0 };
    }
  });

  ipcMain.handle("fs:getVideoInfoBatch", async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    const cpus = os.cpus()?.length || 4;
    const limit = Math.max(2, Math.min(16, filePaths.length, cpus * 2));
    const fastResults = await runWithConcurrency(filePaths, limit, probeVideoFast);
    return await Promise.all(
      fastResults.map(async (info, i) => {
        if (info.width > 0 && info.height > 0) return info;
        const check = pathSecurity.validateReadableFile(filePaths[i], "video");
        if (!check.ok) return info;
        try {
          const full = await probeVideo(check.resolvedPath);
          if (full.width > 0 && full.height > 0) return full;
        } catch (e) {
          console.error("[beru] Full video probe failed:", filePaths[i], e.message);
        }
        return info;
      }),
    );
  });

  ipcMain.handle("video:thumbnail", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return null;
    return await extractThumbnail(check.resolvedPath, 80);
  });

  ipcMain.handle("video:thumbnailBatch", async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    const validated = filePaths
      .map((p) => pathSecurity.validateReadableFile(p, "video"))
      .filter((c) => c.ok);
    if (validated.length === 0) return [];
    const cpus = os.cpus()?.length || 4;
    const limit = Math.max(2, Math.min(8, validated.length, cpus));
    return await runWithConcurrency(
      validated.map((c) => c.resolvedPath),
      limit,
      (p) => extractThumbnail(p, 80),
    );
  });
}
