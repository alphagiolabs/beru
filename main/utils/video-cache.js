import fs from "fs";
import { probeVideoFile } from "../videoProbe.js";
import { hasVideoDimensions } from "../../shared/has-video-dimensions.js";
import { getFfprobePath, getFfmpegPath } from "./paths.js";
import { trimOldest } from "./cache-trim.js";

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

const pendingProbes = new Map();

function getVideoStatKey(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const { dev, ino, size, mtimeMs, ctimeMs } = stat;
    return JSON.stringify([dev, ino, size, mtimeMs, ctimeMs]);
  } catch {
    return null;
  }
}

function getCachedVideoInfo(filePath, statKey) {
  if (!statKey) return null;
  const hit = videoInfoCache.get(filePath);
  if (!hit || hit.statKey !== statKey || !hasVideoDimensions(hit.info)) return null;
  return hit.info;
}

function setCachedVideoInfo(filePath, statKey, info) {
  if (!statKey || !hasVideoDimensions(info)) return;
  videoInfoCache.set(filePath, { statKey, info });
  trimOldest(videoInfoCache, VIDEO_INFO_CACHE_MAX);
}

function probeVideoCached(filePath, { key, timeoutMs, allowFfmpegFallback }) {
  const statKey = getVideoStatKey(filePath);
  const cached = getCachedVideoInfo(filePath, statKey);
  if (cached) return Promise.resolve(cached);

  const probeKey = `${key}:${filePath}:${statKey}`;
  const pending = pendingProbes.get(probeKey);
  if (pending) return pending;

  const probe = probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs,
    allowFfmpegFallback,
  })
    .then((info) => {
      if (statKey === getVideoStatKey(filePath)) {
        setCachedVideoInfo(filePath, statKey, info);
      }
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
