import { spawn } from "child_process";
import fs from "fs";
import { getFfmpegPath } from "./paths.js";

const THUMBNAIL_CACHE_MAX = 300;
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

// Thumbnails are deterministic for (path, mtime, width) — cache like
// video-cache.js so re-imports/selections don't respawn ffmpeg per file.
const thumbnailCache = new Map();
const pendingThumbnails = new Map();

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

function trimThumbnailCache() {
  if (thumbnailCache.size <= THUMBNAIL_CACHE_MAX) return;
  const keys = thumbnailCache.keys();
  const excess = thumbnailCache.size - THUMBNAIL_CACHE_MAX;
  for (let i = 0; i < excess; i++) {
    thumbnailCache.delete(keys.next().value);
  }
}

function runThumbnailFfmpeg(ffmpeg, filePath, width) {
  return new Promise((resolve) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let killTimer = null;
    const proc = spawn(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      filePath,
      "-an",
      "-sn",
      "-dn",
      "-vframes",
      "1",
      "-vf",
      `scale=${width}:-2`,
      "-q:v",
      "10",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ]);
    const finish = (data) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      try {
        proc.kill();
      } catch {}
      resolve(data);
    };
    proc.stdout.on("data", (d) => {
      totalBytes += d.length;
      // A healthy 80px mjpeg is a few KB; anything larger means the source is
      // misbehaving — kill it instead of buffering unbounded output.
      if (totalBytes > MAX_THUMBNAIL_BYTES) return finish(null);
      chunks.push(d);
    });
    proc.stderr.on("data", () => {}); // ignore
    proc.on("error", () => finish(null));
    proc.on("close", (code) => {
      if (code !== 0) return finish(null);
      const buf = Buffer.concat(chunks);
      if (buf.length < 64) return finish(null);
      const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      finish({ dataUrl, size: buf.length });
    });
    killTimer = setTimeout(() => finish(null), 5000);
  });
}

export function extractThumbnail(filePath, width = 80) {
  const ffmpeg = getFfmpegPath();
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(filePath)) return Promise.resolve(null);
  const mtime = getMtimeMs(filePath);
  const cacheKey = `${filePath}:${mtime}:${width}`;
  if (mtime >= 0) {
    const hit = thumbnailCache.get(cacheKey);
    if (hit) return Promise.resolve(hit);
  }
  const pending = pendingThumbnails.get(cacheKey);
  if (pending) return pending;

  const task = runThumbnailFfmpeg(ffmpeg, filePath, width)
    .then((result) => {
      pendingThumbnails.delete(cacheKey);
      if (result && mtime >= 0) {
        thumbnailCache.set(cacheKey, result);
        trimThumbnailCache();
      }
      return result;
    })
    .catch(() => {
      pendingThumbnails.delete(cacheKey);
      return null;
    });
  pendingThumbnails.set(cacheKey, task);
  return task;
}
