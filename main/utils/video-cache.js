import fs from "fs";
import { probeVideoFile, hasVideoDimensions } from "../videoProbe.js";
import { getFfprobePath, getFfmpegPath } from "./paths.js";

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

const pendingProbes = new Map();

function trimVideoInfoCache() {
  if (videoInfoCache.size <= VIDEO_INFO_CACHE_MAX) return;
  const keys = videoInfoCache.keys();
  const excess = videoInfoCache.size - VIDEO_INFO_CACHE_MAX;
  for (let i = 0; i < excess; i++) {
    videoInfoCache.delete(keys.next().value);
  }
}

function getVideoMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

function getCachedVideoInfo(filePath, mtime = getVideoMtimeMs(filePath)) {
  if (mtime < 0) return null;
  const hit = videoInfoCache.get(filePath);
  if (!hit || hit.mtime !== mtime || !hasVideoDimensions(hit.info)) return null;
  return hit.info;
}

function setCachedVideoInfo(filePath, mtime, info) {
  if (mtime < 0 || !hasVideoDimensions(info)) return;
  videoInfoCache.set(filePath, { mtime, info });
  trimVideoInfoCache();
}

function probeVideoCached(filePath, { key, timeoutMs, allowFfmpegFallback }) {
  const mtime = getVideoMtimeMs(filePath);
  const cached = getCachedVideoInfo(filePath, mtime);
  if (cached) return Promise.resolve(cached);

  const probeKey = `${key}:${filePath}:${mtime}`;
  const pending = pendingProbes.get(probeKey);
  if (pending) return pending;

  const probe = probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs,
    allowFfmpegFallback,
  })
    .then((info) => {
      setCachedVideoInfo(filePath, mtime, info);
      pendingProbes.delete(probeKey);
      return info;
    })
    .catch((err) => {
      pendingProbes.delete(probeKey);
      throw err;
    });

  pendingProbes.set(probeKey, probe);
  return probe;
}

export function probeVideoFast(filePath) {
  return probeVideoCached(filePath, {
    key: "fast",
    timeoutMs: 2500,
    allowFfmpegFallback: false,
  });
}

export function probeVideo(filePath) {
  return probeVideoCached(filePath, {
    key: "full",
    timeoutMs: 5000,
    allowFfmpegFallback: true,
  });
}
