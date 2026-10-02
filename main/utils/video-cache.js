import fs from "fs";
import { probeVideoFile } from "../videoProbe.js";
import { hasVideoDimensions } from "../../shared/has-video-dimensions.js";
import { getFfprobePath, getFfmpegPath } from "./paths.js";
import { trimOldest } from "./cache-trim.js";

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

const pendingProbes = new Map();

function getVideoMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

function getCachedVideoInfo(filePath, mtime) {
  if (mtime < 0) return null;
  const hit = videoInfoCache.get(filePath);
  if (!hit || hit.mtime !== mtime || !hasVideoDimensions(hit.info)) return null;
  return hit.info;
}

function setCachedVideoInfo(filePath, mtime, info) {
  if (mtime < 0 || !hasVideoDimensions(info)) return;
  videoInfoCache.set(filePath, { mtime, info });
  trimOldest(videoInfoCache, VIDEO_INFO_CACHE_MAX);
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
