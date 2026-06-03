import fs from "fs";
import { probeVideoFile } from "../videoProbe.js";
import { getFfprobePath, getFfmpegPath } from "./paths.js";

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

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

/** Fast metadata read for batch import (ffprobe only, cached by path+mtime). */
export async function probeVideoFast(filePath) {
  const mtime = getVideoMtimeMs(filePath);
  if (mtime >= 0) {
    const hit = videoInfoCache.get(filePath);
    if (hit && hit.mtime === mtime) return hit.info;
  }
  const info = await probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 2500,
    allowFfmpegFallback: false,
  });
  if (mtime >= 0) {
    videoInfoCache.set(filePath, { mtime, info });
    trimVideoInfoCache();
  }
  return info;
}

export function probeVideo(filePath) {
  return probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 5000,
    allowFfmpegFallback: true,
  });
}
