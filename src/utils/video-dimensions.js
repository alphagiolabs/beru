/** Locked and display dimensions for a queue video. */

export function getLockedDimensions(item) {
  const width = Number(item?.sourceWidth || item?.width || 0);
  const height = Number(item?.sourceHeight || item?.height || 0);
  return { width, height };
}

export function hasLockedDimensions(item) {
  const { width, height } = getLockedDimensions(item);
  return width > 0 && height > 0;
}

/** Apply probe result; source* is set once and never overwritten. */
export function mergeProbeIntoQueueItem(item, info = {}) {
  const w = Number(info.width || 0);
  const h = Number(info.height || 0);
  const hasProbe = w > 0 && h > 0;
  const sourceWidth = item.sourceWidth > 0 ? item.sourceWidth : hasProbe ? w : 0;
  const sourceHeight = item.sourceHeight > 0 ? item.sourceHeight : hasProbe ? h : 0;
  return {
    ...item,
    width: item.width > 0 ? item.width : w,
    height: item.height > 0 ? item.height : h,
    sourceWidth,
    sourceHeight,
    duration: info.duration || item.duration || 0,
    videoCodec: info.videoCodec || item.videoCodec || "",
    pixFmt: info.pixFmt || item.pixFmt || "yuv420p",
    frameRate: info.frameRate || item.frameRate || 0,
    audioCodec: info.audioCodec || item.audioCodec || "",
    audioChannels: info.audioChannels || item.audioChannels || 0,
  };
}
