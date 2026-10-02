import { normalizeJob } from "../../shared/job-manifest.js";
import { getLockedDimensions } from "./video-dimensions.js";
import { operationsToJobPayload } from "./operation.js";
import { getGlobalTextStyleFromState } from "./text-style.js";

export function namingInputs(s) {
  return [
    s.queue,
    s.outputDir,
    s.exportFormat,
    s.templateRegions,
    s.excelRows,
    s.excelMapping,
    s.excelRowIndexByFilename,
  ];
}

export function jobInputs(s, videoIdx) {
  const [_queue, _outputDir, _exportFormat, ...batchInputs] = namingInputs(s);
  return [
    s.outputPathsForAll()[videoIdx],
    s.encodeProfile,
    s.watermark,
    ...batchInputs,
    getGlobalTextStyleFromState(s),
  ];
}

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

function omitJobIndex(jobProgress, idx) {
  if (jobProgress?.[idx] === undefined) return jobProgress;
  const next = { ...jobProgress };
  delete next[idx];
  return next;
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

export function buildExportJob(item, index, ctx) {
  if (!item) return null;
  const outPath = ctx?.outputPath;
  const { width, height } = getLockedDimensions(item);
  const duration = Number(item.duration) || 0;
  const trimStart = Number(item.trimStart);
  const trimEnd = Number(item.trimEnd);
  const start = Number.isFinite(trimStart) ? Math.max(0, Math.min(trimStart, duration)) : 0;
  const end =
    item.trimEnd == null || !Number.isFinite(trimEnd)
      ? duration
      : Math.max(0, Math.min(trimEnd, duration));
  const hasTrim = duration > 0 && end > start && (start > 0 || end < duration);
  return normalizeJob(
    {
      input_path: item.path,
      output_path: outPath,
      width,
      height,
      source_width: width,
      source_height: height,
      operations: operationsToJobPayload(item.operations, width, height),
      video_duration: item.duration,
      ...(hasTrim ? { trim_start: start, trim_end: end < duration ? end : null } : {}),
      video_codec: item.videoCodec,
      pix_fmt: item.pixFmt,
      frame_rate: item.frameRate,
      audio_codec: item.audioCodec,
      audio_channels: item.audioChannels,
      encode_profile: ctx?.encodeProfile,
      watermark: ctx?.watermark,
    },
    index,
  );
}

export function buildExportJobs(queue, buildOne) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item, i) => buildOne(item, i)).filter(Boolean);
}

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
  exportSignatures,
}) {
  const idx = msg?.index;
  if (!isQueueJobIndex(idx, queue.length)) return {};
  const updated = [...queue];
  const signature = exportSignatures?.[idx];
  const artifactPath = typeof msg?.output === "string" ? msg.output : null;
  updated[idx] = {
    ...updated[idx],
    status: "done",
    progress: 100,
    error: null,
    ...(signature && artifactPath
      ? { exportSignature: signature, exportedOutputPath: artifactPath }
      : {}),
  };
  const nextProgress =
    progressMap && jobProgress?.[idx] !== undefined ? { ...jobProgress, [idx]: 100 } : jobProgress;
  return {
    queue: updated,
    progressDone: Math.min(progressDone + 1, progressTotal),
    jobProgress: nextProgress,
  };
}

function applyUnsuccessfulJob(
  { queue, jobProgress = {}, progressDone = 0, progressTotal = 0, msg, progressMap = false },
  cancelled,
) {
  const idx = msg?.index;
  if (!isQueueJobIndex(idx, queue.length)) return {};
  const updated = [...queue];
  updated[idx] = cancelled
    ? { ...updated[idx], status: "idle", progress: 0, error: null }
    : { ...updated[idx], status: "error", error: msg.error };
  const nextProgress = progressMap ? omitJobIndex(jobProgress, idx) : jobProgress;
  return {
    queue: updated,
    progressDone: Math.min(progressDone + 1, progressTotal),
    jobProgress: nextProgress,
  };
}

export function applyJobError(state) {
  return applyUnsuccessfulJob(state, false);
}

export function applyJobCancelled(state) {
  return applyUnsuccessfulJob(state, true);
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
    batchSummary: null,
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
    batchSummary: null,
  };
}
