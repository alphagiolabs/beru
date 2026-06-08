import fs from "fs";
import { probeVideoFile } from "../videoProbe.js";
import { getFfprobePath, getFfmpegPath } from "./paths.js";

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

function hasVideoDimensions(info) {
  return Number(info?.width || 0) > 0 && Number(info?.height || 0) > 0;
}

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

/** Fast metadata read for batch import (ffprobe only, cached by path+mtime). */
export async function probeVideoFast(filePath) {
  const mtime = getVideoMtimeMs(filePath);
  const cached = getCachedVideoInfo(filePath, mtime);
  if (cached) return cached;
  const info = await probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 2500,
    allowFfmpegFallback: false,
  });
  setCachedVideoInfo(filePath, mtime, info);
  return info;
}

export async function probeVideo(filePath) {
  const mtime = getVideoMtimeMs(filePath);
  const cached = getCachedVideoInfo(filePath, mtime);
  if (cached) return cached;
  const info = await probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 5000,
    allowFfmpegFallback: true,
  });
  setCachedVideoInfo(filePath, mtime, info);
  return info;
}
