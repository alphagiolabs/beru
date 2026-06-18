import { ipcMain } from "electron";
import os from "os";
import { probeVideo, probeVideoFast } from "../utils/video-cache.js";
import { extractThumbnail } from "../utils/thumbnail.js";
import { renderPreviewFrame } from "../utils/preview-frame.js";
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
    // Build the fallback work list (only entries that need a full probe), then
    // run those probes with the same concurrency cap instead of an unbounded
    // Promise.all that could spawn one ffprobe process per queued file.
    const fallbacks = [];
    fastResults.forEach((info, i) => {
      if (info.width > 0 && info.height > 0) return;
      const check = pathSecurity.validateReadableFile(filePaths[i], "video");
      if (!check.ok) return;
      fallbacks.push({ i, resolvedPath: check.resolvedPath });
    });
    const fallbackLimit = Math.max(2, Math.min(8, fallbacks.length, cpus));
    const fullResults = await runWithConcurrency(
      fallbacks,
      fallbackLimit,
      async ({ resolvedPath, i }) => {
        try {
          const full = await probeVideo(resolvedPath);
          if (full.width > 0 && full.height > 0) return { i, full };
        } catch (e) {
          console.error("[beru] Full video probe failed:", filePaths[i], e.message);
        }
        return { i, full: null };
      },
    );
    const fullByIndex = new Map();
    for (const r of fullResults) if (r.full) fullByIndex.set(r.i, r.full);
    return fastResults.map((info, i) => fullByIndex.get(i) || info);
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

  ipcMain.handle("video:renderPreviewFrame", async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Payload de preview inválido" };
    }
    const check = pathSecurity.validateReadableFile(payload.input_path, "video");
    if (!check.ok) return { ok: false, error: check.error };
    return await renderPreviewFrame({
      ...payload,
      input_path: check.resolvedPath,
    });
  });
}
