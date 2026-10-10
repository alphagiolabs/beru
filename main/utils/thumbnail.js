import fs from "fs";
import { getFfmpegPath, getThumbnailCacheDirectory } from "./paths.js";
import { trimOldest } from "./cache-trim.js";
import { runMediaTask } from "./media-task-pool.js";
import { runCapturedProcess } from "./run-captured.js";
import { createThumbnailDiskCache } from "./thumbnail-disk-cache.js";

const FILMSTRIP_CACHE_MAX = 12;
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

const filmstripCache = new Map();
let diskCache;

function thumbnailKey(filePath, width) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const { dev, ino, size, mtimeMs, ctimeMs } = stat;
    return JSON.stringify(["thumbnail-v1", filePath, dev, ino, size, mtimeMs, ctimeMs, width]);
  } catch {
    return null;
  }
}

function getDiskCache() {
  diskCache ||= createThumbnailDiskCache({ directory: getThumbnailCacheDirectory() });
  return diskCache;
}

function jpegDimensions(buf) {
  let offset = 2;
  while (offset + 8 < buf.length) {
    if (buf[offset] !== 0xff || buf[offset + 1] === 0x00 || buf[offset + 1] === 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset +=
      marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) ? 2 : 2 + buf.readUInt16BE(offset + 2);
  }
  return null;
}

async function runThumbnailFfmpeg(ffmpeg, filePath, filter, seekSeconds = 1, signal) {
  const result = await runCapturedProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "2",
      "-filter_threads",
      "1",
      "-ss",
      String(seekSeconds),
      "-i",
      filePath,
      "-an",
      "-sn",
      "-dn",
      "-vframes",
      "1",
      "-vf",
      filter,
      "-q:v",
      "10",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ],
    {
      timeoutMs: 5000,
      maxStdoutBytes: MAX_THUMBNAIL_BYTES,
      stdoutMode: "buffer",
      stderrMode: "drain",
      spawnOptions: { signal },
    },
  );
  if (result.code !== 0 || result.error || result.timedOut || result.outputExceeded) return null;
  const buf = result.stdout;
  if (buf.length < 64) return null;
  const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
  const dims = jpegDimensions(buf);
  return { dataUrl, size: buf.length, width: dims?.width || 0, height: dims?.height || 0 };
}

export async function extractThumbnail(filePath, width = 80, priority = {}) {
  const cacheKey = thumbnailKey(filePath, width);
  if (!cacheKey) return null;
  const stored = await getDiskCache().get(cacheKey);
  if (cacheKey !== thumbnailKey(filePath, width)) return null;
  if (stored) return stored;
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg || !fs.existsSync(ffmpeg)) return null;
  return runMediaTask(
    async () => {
      const first = await runThumbnailFfmpeg(ffmpeg, filePath, `scale=${width}:-2`, 1);
      if (first) return first;
      try {
        if (fs.statSync(filePath).size >= 50 * 1024 * 1024) return null;
      } catch {
        return null;
      }
      return runThumbnailFfmpeg(ffmpeg, filePath, `scale=${width}:-2`, 0);
    },
    { ...priority, key: `thumbnail:${cacheKey}` },
  )
    .then(async (result) => {
      if (result && cacheKey === thumbnailKey(filePath, width)) {
        await getDiskCache().set(cacheKey, result);
      }
      return result;
    })
    .catch(() => null);
}

function filmstripKey(filePath, count, height, duration) {
  try {
    const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(filePath);
    return JSON.stringify([filePath, dev, ino, size, mtimeMs, ctimeMs, count, height, duration]);
  } catch {
    return null;
  }
}

export async function extractFilmstrip(
  filePath,
  { count = 20, height = 64, duration = 0, signal, onFrame } = {},
  priority = {},
) {
  const ffmpeg = getFfmpegPath();
  if (!fs.existsSync(ffmpeg) || !Number.isFinite(duration) || !(duration > 0) || signal?.aborted) {
    return null;
  }
  const cacheKey = filmstripKey(filePath, count, height, duration);
  if (!cacheKey) return null;
  const hit = filmstripCache.get(cacheKey);
  if (hit) {
    filmstripCache.delete(cacheKey);
    filmstripCache.set(cacheKey, hit);
    return hit;
  }
  const times = Array.from({ length: count }, (_, i) =>
    Math.max(0, Math.min(duration - 0.05, ((i + 0.5) * duration) / count)),
  );
  const order = [...new Set([0, Math.floor(count / 2), count - 1, ...times.map((_, i) => i)])];
  const frames = new Array(count).fill(null);
  let next = 0;
  let aspect = 16 / 9;
  async function extractNext() {
    while (next < order.length && !signal?.aborted) {
      const index = order[next++];
      const result = await runMediaTask(
        () => runThumbnailFfmpeg(ffmpeg, filePath, `scale=-2:${height}`, times[index], signal),
        { ...priority, signal },
      ).catch(() => null);
      if (signal?.aborted) return;
      if (!result?.dataUrl) continue;
      frames[index] = result.dataUrl;
      if (result.width > 0 && result.height > 0) aspect = result.width / result.height;
      onFrame?.({ index, frame: result.dataUrl, aspect, count });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, count) }, extractNext));
  if (signal?.aborted || !frames.some(Boolean)) return null;
  const result = { frames, aspect };
  if (frames.every(Boolean) && cacheKey === filmstripKey(filePath, count, height, duration)) {
    filmstripCache.set(cacheKey, result);
    trimOldest(filmstripCache, FILMSTRIP_CACHE_MAX);
  }
  return result;
}
