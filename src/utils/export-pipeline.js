import { denormalizeRegion } from "./types.js";
import { sanitizeOperation } from "./delogo-ops.js";
import { filterOperationsForExport } from "./batch-process.js";
import { getLockedDimensions } from "./video-dimensions.js";
import { textStyleToPythonPayload } from "./text-style.js";

function isQueueJobIndex(idx, queueLength) {
  return Number.isInteger(idx) && idx >= 0 && idx < queueLength;
}

function applyJobProgressMessages(queue, messages) {
  const latestByIndex = new Map();
  for (const msg of messages) {
    const idx = msg?.index;
    if (isQueueJobIndex(idx, queue.length)) latestByIndex.set(idx, msg);
  }
  if (latestByIndex.size === 0) return queue;

  let next = null;
  for (const [idx, msg] of latestByIndex) {
    const current = (next || queue)[idx];
    if (current.status === "done" || current.status === "error") continue;

    const progress = Math.round(msg.percent ?? current.progress ?? 0);
    if (current.status === "processing" && current.progress === progress) continue;

    if (!next) next = [...queue];
    next[idx] = {
      ...current,
      status: "processing",
      progress,
    };
  }

  return next || queue;
}

/**
 * Flag-on path: flip `status` to "processing" the first time a job reports
 * progress, but keep the numeric `progress` out of `queue`.
 */
function applyJobProgressStatusOnly(queue, messages) {
  let next = null;
  for (const msg of messages) {
    const idx = msg?.index;
    if (!isQueueJobIndex(idx, queue.length)) continue;
    const current = (next || queue)[idx];
    if (current.status === "done" || current.status === "error") continue;
    if (current.status === "processing") continue;
    if (!next) next = [...queue];
    next[idx] = { ...current, status: "processing" };
  }
  return next || queue;
}

function applyJobProgressMap(jobProgress, queue, messages) {
  let next = jobProgress;
  let changed = false;
  for (const msg of messages) {
    const idx = msg?.index;
    if (!isQueueJobIndex(idx, queue.length)) continue;
    const current = queue[idx];
    if (current.status === "done" || current.status === "error") continue;
    const progress = Math.round(msg.percent ?? 0);
    if (!Number.isFinite(progress)) continue;
    if (!changed) {
      next = { ...jobProgress };
      changed = true;
    }
    next[idx] = progress;
  }
  return next;
}

/**
 * Build a processor job payload from a queue item.
 * @param {object|null} item
 * @param {number} index
 * @param {{ encodeProfile: string, outputPath: string, watermark?: object|null }} ctx
 */
export function buildExportJob(item, index, ctx) {
  if (!item) return null;
  const encodeProfile = ctx?.encodeProfile || "balanced";
  const outPath = ctx?.outputPath;
  const { width, height } = getLockedDimensions(item);
  return {
    id: index,
    input_path: item.path,
    output_path: outPath,
    width,
    height,
    source_width: width,
    source_height: height,
    operations: filterOperationsForExport(item.operations).map((op) => {
      const safe = sanitizeOperation(op);
      return {
        mode: safe.mode,
        region: safe.region
          ? width > 0 && height > 0
            ? denormalizeRegion(safe.region, width, height)
            : safe.region
          : safe.region,
        blur_strength: safe.blurStrength,
        delogo_method: safe.delogoMethod,
        delogo_fill_color: safe.delogoFillColor,
        delogo_fill_opacity: safe.delogoFillOpacity,
        delogo_image_path: safe.delogoImagePath,
        temporal_radius: safe.temporalRadius,
        mosaic_size: safe.mosaicSize,
        mirror_side: safe.mirrorSide,
        edge_feather: safe.edgeFeather,
        text: safe.text,
        ...textStyleToPythonPayload(safe),
        image_path: safe.imagePath,
        image_opacity: safe.imageOpacity,
        start_time: safe.startTime,
        end_time: safe.endTime,
      };
    }),
    video_duration: item.duration,
    video_codec: item.videoCodec || "",
    pix_fmt: item.pixFmt || "yuv420p",
    frame_rate: item.frameRate || 0,
    audio_codec: item.audioCodec || "",
    audio_channels: item.audioChannels || 0,
    encode_profile: encodeProfile,
    watermark: ctx?.watermark ?? null,
  };
}

/** @param {Array} queue @param {(item, index) => object|null} buildOne */
export function buildExportJobs(queue, buildOne) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item, i) => buildOne(item, i)).filter(Boolean);
}

/**
 * Apply a batch of job_progress messages.
 * @returns {{ queue: Array, jobProgress: object }}
 */
export function applyJobProgressBatch({ queue, jobProgress = {}, messages, progressMap = false }) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (progressMap) {
    const nextQueue = applyJobProgressStatusOnly(queue, msgs);
    const nextProgress = applyJobProgressMap(jobProgress, queue, msgs);
    return { queue: nextQueue, jobProgress: nextProgress };
  }
  return {
    queue: applyJobProgressMessages(queue, msgs),
    jobProgress,
  };
}

export function applyJobDone({
  queue,
  jobProgress = {},
  progressDone = 0,
  progressTotal = 0,
  msg,
  progressMap = false,
}) {
  const idx = msg?.index;
  if (!isQueueJobIndex(idx, queue.length)) return {};
  const updated = [...queue];
  updated[idx] = { ...updated[idx], status: "done", progress: 100, error: null };
  const nextProgress =
    progressMap && jobProgress?.[idx] !== undefined ? { ...jobProgress, [idx]: 100 } : jobProgress;
  return {
    queue: updated,
    progressDone: Math.min(progressDone + 1, progressTotal),
    jobProgress: nextProgress,
  };
}

export function applyJobError({
  queue,
  jobProgress = {},
  progressDone = 0,
  progressTotal = 0,
  msg,
  progressMap = false,
}) {
  const idx = msg?.index;
  if (!isQueueJobIndex(idx, queue.length)) return {};
  const updated = [...queue];
  updated[idx] = { ...updated[idx], status: "error", error: msg.error };
  const nextProgress =
    progressMap && jobProgress?.[idx] !== undefined
      ? (() => {
          const next = { ...jobProgress };
          delete next[idx];
          return next;
        })()
      : jobProgress;
  return {
    queue: updated,
    progressDone: Math.min(progressDone + 1, progressTotal),
    jobProgress: nextProgress,
  };
}

export function applyJobCancelled({
  queue,
  jobProgress = {},
  progressDone = 0,
  progressTotal = 0,
  msg,
  progressMap = false,
}) {
  const idx = msg?.index;
  if (!isQueueJobIndex(idx, queue.length)) return {};
  const updated = [...queue];
  updated[idx] = { ...updated[idx], status: "idle", progress: 0, error: null };
  const nextProgress =
    progressMap && jobProgress?.[idx] !== undefined
      ? (() => {
          const next = { ...jobProgress };
          delete next[idx];
          return next;
        })()
      : jobProgress;
  return {
    queue: updated,
    progressDone: Math.min(progressDone + 1, progressTotal),
    jobProgress: nextProgress,
  };
}

export function resetQueueForRun(queue) {
  return (Array.isArray(queue) ? queue : []).map((item) => ({
    ...item,
    status: "idle",
    progress: 0,
    error: null,
  }));
}

export function abortProcessingQueue(queue) {
  let queueChanged = false;
  const next = (Array.isArray(queue) ? queue : []).map((item) => {
    const isLegacyCancelled = item.status === "error" && item.error === "Cancelled";
    if (item.status !== "processing" && !isLegacyCancelled) return item;
    queueChanged = true;
    return { ...item, status: "idle", progress: 0, error: null };
  });
  return { queue: next, queueChanged };
}

export function createBatchStartPatch({ queue, jobCount }) {
  return {
    queue: resetQueueForRun(queue),
    progressTotal: jobCount,
    progressDone: 0,
    jobProgress: {},
    isProcessing: true,
  };
}

export function createSingleStartPatch({ queue, videoIdx }) {
  const updated = [...queue];
  updated[videoIdx] = {
    ...updated[videoIdx],
    status: "processing",
    progress: 0,
    error: null,
  };
  return {
    queue: updated,
    isProcessing: true,
    progressTotal: 1,
    progressDone: 0,
    jobProgress: {},
  };
}
