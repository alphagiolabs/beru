import { normalizeTransform } from "../../shared/video-transform.js";
import { clipTimeline } from "../../shared/clip-timeline.js";

function requiresEncode(item, sourceHeight) {
  const transform = normalizeTransform(item.transform);
  const timing = clipTimeline(item);
  const duration = Number(item.duration) || 0;
  const trimmed =
    duration > 0 && timing.end > timing.start && (timing.start > 0 || timing.end < duration);
  return (
    (item.operations || []).length > 0 ||
    transform.rotation !== 0 ||
    transform.flipH ||
    transform.flipV ||
    transform.outputWidth != null ||
    (transform.outputHeight != null &&
      (sourceHeight <= 0 || transform.outputHeight < sourceHeight)) ||
    timing.rate !== 1 ||
    timing.repeatCount !== 1 ||
    trimmed
  );
}

export function queueCapacityInput(queue = [], templateRegions = [], watermark = null) {
  let maxSourcePixels = 0;
  let hasOps = false;
  const jobs = [];
  for (const item of queue) {
    const w = Number(item.sourceWidth || item.width || 0);
    const h = Number(item.sourceHeight || item.height || 0);
    if (w > 0 && h > 0) maxSourcePixels = Math.max(maxSourcePixels, w * h);
    if (requiresEncode(item, h)) hasOps = true;
    jobs.push({
      videoCodec: item.videoCodec || "",
      pixFmt: item.pixFmt || "",
      sourceWidth: w,
      sourceHeight: h,
    });
  }
  return {
    queueLength: queue.length,
    maxSourcePixels,
    hasVideoFilters: templateRegions.length > 0 || hasOps || watermark?.enabled === true,
    jobs,
  };
}

export function capacityJobsSignature(queue = [], templateRegions = [], watermark = null) {
  return JSON.stringify(queueCapacityInput(queue, templateRegions, watermark));
}
