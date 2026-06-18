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
    const validated = filePaths.map((filePath) =>
      pathSecurity.validateReadableFile(filePath, "video"),
    );
    const results = validated.map((check) =>
      check.ok ? null : { exists: false, width: 0, height: 0, duration: 0, error: check.error },
    );
    const validFiles = validated
      .map((check, i) => (check.ok ? { i, resolvedPath: check.resolvedPath } : null))
      .filter(Boolean);
    if (validFiles.length === 0) return results;

    const cpus = os.cpus()?.length || 4;
    const limit = Math.max(2, Math.min(16, validFiles.length, cpus * 2));
    const fastResults = await runWithConcurrency(validFiles, limit, async ({ resolvedPath }) =>
      probeVideoFast(resolvedPath),
    );
    validFiles.forEach(({ i }, resultIndex) => {
      results[i] = fastResults[resultIndex];
    });

    // Build the fallback work list (only entries that need a full probe), then
    // run those probes with the same concurrency cap instead of an unbounded
    // Promise.all that could spawn one ffprobe process per queued file.
    const fallbacks = [];
    validFiles.forEach(({ i, resolvedPath }) => {
      const info = results[i] || {};
      if (info.width > 0 && info.height > 0) return;
      fallbacks.push({ i, resolvedPath });
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
    return results.map((info, i) => fullByIndex.get(i) || info);
  });

  ipcMain.handle("video:thumbnail", async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return null;
    return await extractThumbnail(check.resolvedPath, 80);
  });

  ipcMain.handle("video:thumbnailBatch", async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    const validated = filePaths.map((p) => pathSecurity.validateReadableFile(p, "video"));
    const results = new Array(filePaths.length).fill(null);
    const validFiles = validated
      .map((check, i) => (check.ok ? { i, resolvedPath: check.resolvedPath } : null))
      .filter(Boolean);
    if (validFiles.length === 0) return results;

    const cpus = os.cpus()?.length || 4;
    const limit = Math.max(2, Math.min(8, validFiles.length, cpus));
    const thumbnails = await runWithConcurrency(validFiles, limit, ({ resolvedPath }) =>
      extractThumbnail(resolvedPath, 80),
    );
    validFiles.forEach(({ i }, resultIndex) => {
      results[i] = thumbnails[resultIndex] || null;
    });
    return results;
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
