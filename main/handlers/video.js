import { ipcMain } from "electron";
import os from "os";
import { probeVideo, probeVideoFast } from "../utils/video-cache.js";
import { extractThumbnail } from "../utils/thumbnail.js";
import { renderPreviewFrame } from "../utils/preview-frame.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { sanitizeJobMedia } from "../utils/process-media-validation.js";
import { runMediaTask } from "../utils/media-task-pool.js";

function collectValidVideoFiles(filePaths, pathSecurity) {
  const validated = filePaths.map((filePath) =>
    pathSecurity.validateReadableFile(filePath, "video"),
  );
  const validFiles = validated
    .map((check, i) => (check.ok ? { i, resolvedPath: check.resolvedPath } : null))
    .filter(Boolean);
  const cpus = os.cpus()?.length || 4;
  const limit = Math.max(2, Math.min(8, validFiles.length, cpus));
  return { validated, validFiles, limit };
}

export function registerVideoHandlers(pathSecurity) {
  ipcMain.handle("fs:getVideoInfo", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return { exists: false, width: 0, height: 0, duration: 0, error: check.error };
    try {
      return await runMediaTask(() => probeVideo(check.resolvedPath), { interactive: true });
    } catch {
      return { exists: true, width: 0, height: 0, duration: 0 };
    }
  });

  ipcMain.handle("fs:getVideoInfoBatch", async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    const { validated, validFiles, limit } = collectValidVideoFiles(filePaths, pathSecurity);
    const results = validated.map((check) =>
      check.ok ? null : { exists: false, width: 0, height: 0, duration: 0, error: check.error },
    );
    if (validFiles.length === 0) return results;
    const probed = await runWithConcurrency(validFiles, limit, async ({ resolvedPath, i }) => {
      try {
        const fast = await runMediaTask(() => probeVideoFast(resolvedPath));
        if (fast.width > 0 && fast.height > 0) return { i, info: fast };
        const full = await runMediaTask(() => probeVideo(resolvedPath));
        return { i, info: full.width > 0 && full.height > 0 ? full : fast };
      } catch (e) {
        console.error("[beru] Full video probe failed:", filePaths[i], e.message);
      }
      return { i, info: null };
    });
    for (const item of probed) if (item.info) results[item.i] = item.info;
    return results;
  });

  ipcMain.handle("video:thumbnail", (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return null;
    return runMediaTask(() => extractThumbnail(check.resolvedPath, 80), {
      interactive: true,
    });
  });

  ipcMain.handle("video:thumbnailBatch", async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    const { validFiles, limit } = collectValidVideoFiles(filePaths, pathSecurity);
    const results = new Array(filePaths.length).fill(null);
    if (validFiles.length === 0) return results;
    const thumbnails = await runWithConcurrency(validFiles, limit, ({ resolvedPath }) =>
      runMediaTask(() => extractThumbnail(resolvedPath, 80)),
    );
    validFiles.forEach(({ i }, resultIndex) => {
      results[i] = thumbnails[resultIndex] || null;
    });
    return results;
  });

  ipcMain.handle("video:renderPreviewFrame", (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Payload de preview inválido" };
    }
    let safePayload;
    try {
      safePayload = sanitizeJobMedia(payload, pathSecurity);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
    return runMediaTask(() => renderPreviewFrame(safePayload), { interactive: true });
  });
}
