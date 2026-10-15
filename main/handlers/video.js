import fs from "fs";
import { ipcMain } from "electron";
import { IPC_INVOKE, IPC_EVENTS } from "../../shared/ipc-channels.js";
import { probeVideo, probeVideoFast } from "../utils/video-cache.js";
import { extractThumbnail, extractFilmstrip } from "../utils/thumbnail.js";
import { renderPreviewFrame, renderSourceFrame } from "../utils/preview-frame-cache.js";
import { sanitizeJobMedia } from "../utils/process-media-validation.js";
import { runMediaTask } from "../utils/media-task-pool.js";

const MAX_BATCH_PATHS = 500;

function artifactStatMatches(filePath, expected) {
  if (expected == null) return true;
  try {
    const stat = fs.statSync(filePath);
    return (
      stat.size === expected.size &&
      stat.mtimeMs === expected.mtimeMs &&
      stat.ctimeMs === expected.ctimeMs
    );
  } catch {
    return false;
  }
}

function collectValidVideoFiles(filePaths, pathSecurity) {
  const validated = filePaths.map((filePath) =>
    pathSecurity.validateReadableFile(filePath, "video"),
  );
  const validFiles = validated
    .map((check, i) => (check.ok ? { i, resolvedPath: check.resolvedPath } : null))
    .filter(Boolean);
  return { validated, validFiles };
}

export function registerVideoHandlers(pathSecurity) {
  const filmstripRequests = new Map();
  ipcMain.handle(IPC_INVOKE.releaseVideoPaths, (_event, filePaths, retainedPaths) => {
    if (!Array.isArray(filePaths)) return false;
    if (filePaths.length > MAX_BATCH_PATHS)
      throw new Error("Demasiados videos en una sola solicitud");
    if (
      retainedPaths !== undefined &&
      (!Array.isArray(retainedPaths) || retainedPaths.length > 10000)
    )
      return false;
    if (retainedPaths === undefined) pathSecurity.releaseVideoPaths(filePaths);
    else pathSecurity.releaseVideoPaths(filePaths, retainedPaths);
    return true;
  });
  ipcMain.handle(IPC_INVOKE.getVideoInfo, async (_event, filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return { exists: false, width: 0, height: 0, duration: 0, error: check.error };
    try {
      return await runMediaTask(() => probeVideo(check.resolvedPath), { interactive: true });
    } catch {
      return { exists: true, width: 0, height: 0, duration: 0 };
    }
  });

  ipcMain.handle(IPC_INVOKE.getVideoInfoBatch, async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    if (filePaths.length > MAX_BATCH_PATHS) {
      throw new Error("Demasiados videos en una sola solicitud");
    }
    const { validated, validFiles } = collectValidVideoFiles(filePaths, pathSecurity);
    const results = validated.map((check) =>
      check.ok ? null : { exists: false, width: 0, height: 0, duration: 0, error: check.error },
    );
    if (validFiles.length === 0) return results;
    const probed = await Promise.all(
      validFiles.map(async ({ resolvedPath, i }) => {
        try {
          const fast = await runMediaTask(() => probeVideoFast(resolvedPath), {
            memoryMb: 32,
            metadata: true,
          });
          if (fast.width > 0 && fast.height > 0) return { i, info: fast };
          const full = await runMediaTask(() => probeVideo(resolvedPath));
          return { i, info: full.width > 0 && full.height > 0 ? full : fast };
        } catch (e) {
          console.error("[beru] Full video probe failed:", filePaths[i], e.message);
        }
        return { i, info: null };
      }),
    );
    for (const item of probed) if (item.info) results[item.i] = item.info;
    return results;
  });

  ipcMain.handle(IPC_INVOKE.getThumbnail, (_event, filePath, options) => {
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) return null;
    return extractThumbnail(check.resolvedPath, 80, {
      interactive: options?.visible !== true,
      visible: options?.visible === true,
    });
  });

  ipcMain.handle(IPC_INVOKE.getThumbnailBatch, async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    if (filePaths.length > MAX_BATCH_PATHS) {
      throw new Error("Demasiados videos en una sola solicitud");
    }
    const { validFiles } = collectValidVideoFiles(filePaths, pathSecurity);
    const results = new Array(filePaths.length).fill(null);
    if (validFiles.length === 0) return results;
    const thumbnails = await Promise.all(
      validFiles.map(({ resolvedPath }) => extractThumbnail(resolvedPath, 80)),
    );
    validFiles.forEach(({ i }, resultIndex) => {
      results[i] = thumbnails[resultIndex] || null;
    });
    return results;
  });

  ipcMain.handle(IPC_INVOKE.getFilmstrip, async (event, payload) => {
    const check = pathSecurity.validateReadableFile(payload?.path, "video");
    if (!check.ok) return null;
    const count = Math.max(1, Math.min(60, Math.floor(Number(payload?.count) || 20)));
    const height = Math.max(16, Math.min(256, Math.floor(Number(payload?.height) || 64)));
    const duration = Math.max(0, Number(payload?.duration) || 0);
    const start = Math.max(0, Number(payload?.start) || 0);
    const requestId = payload?.requestId;
    if (requestId === undefined) {
      return extractFilmstrip(
        check.resolvedPath,
        { count, height, duration, start },
        { interactive: true },
      );
    }
    if (typeof requestId !== "string" || !requestId.length || requestId.length > 128) return null;
    const owner =
      typeof payload?.owner === "string" && payload.owner.length <= 128 ? payload.owner : "";
    const sender = event.sender;
    const slot = `${sender.id}\u0000${owner}`;
    filmstripRequests.get(slot)?.controller.abort();
    const controller = new AbortController();
    const request = { requestId, senderId: sender.id, controller };
    filmstripRequests.set(slot, request);
    const cancel = () => controller.abort();
    const navigate = (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) cancel();
    };
    sender.once("destroyed", cancel);
    sender.once("render-process-gone", cancel);
    sender.on("did-start-navigation", navigate);
    try {
      return await extractFilmstrip(
        check.resolvedPath,
        {
          count,
          height,
          duration,
          start,
          signal: controller.signal,
          onFrame: (frame) => {
            if (
              !controller.signal.aborted &&
              !sender.isDestroyed() &&
              filmstripRequests.get(slot) === request
            ) {
              sender.send(IPC_EVENTS.onFilmstripProgress, { ...frame, requestId });
            }
          },
        },
        { interactive: true },
      );
    } finally {
      sender.removeListener("destroyed", cancel);
      sender.removeListener("render-process-gone", cancel);
      sender.removeListener("did-start-navigation", navigate);
      if (filmstripRequests.get(slot) === request) filmstripRequests.delete(slot);
    }
  });

  ipcMain.handle(IPC_INVOKE.cancelFilmstrip, (event, requestId) => {
    for (const request of filmstripRequests.values()) {
      if (request.senderId === event.sender.id && request.requestId === requestId) {
        request.controller.abort();
        return true;
      }
    }
    return false;
  });

  ipcMain.handle(IPC_INVOKE.renderPreviewFrame, (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Payload de preview inválido" };
    }
    let safePayload;
    try {
      safePayload = sanitizeJobMedia(payload, pathSecurity);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
    return renderPreviewFrame(safePayload);
  });

  ipcMain.handle(IPC_INVOKE.renderSourceFrame, (_event, payload) => {
    const filePath = payload?.input_path;
    const check = pathSecurity.validateReadableFile(filePath, "video");
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    if (!artifactStatMatches(check.resolvedPath, payload?.expected_stat)) {
      return { ok: false, error: "La exportación en disco ya no coincide" };
    }
    const timestamp = Math.max(0, Number(payload?.timestamp) || 0);
    return renderSourceFrame({ input_path: check.resolvedPath, timestamp });
  });
}
