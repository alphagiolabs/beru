import { denormalizeRegion } from "../../utils/types";
import { sanitizeOperation } from "../../utils/delogo-ops";
import { filterOperationsForExport, hasVideoDimensions } from "../../utils/batch-process";
import { buildBatchTextOperationsForPreview } from "../../utils/preview-frame-job";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { textStyleToPythonPayload } from "../../utils/text-style";
import { createJobManifest } from "../../utils/job-manifest";
import { appendProcessingLog, formatProcessingLogs } from "../../utils/processing-logs";
import {
  appendLineToRun,
  createExecutionRun,
  finalizeExecutionRun,
  formatExecutionHistoryExport,
  normalizeExecutionHistory,
  prependExecutionRun,
  summarizeQueue,
} from "../../utils/execution-history.js";
import { PERF_FLAGS } from "../../utils/perf-flags.js";
import { swallow } from "../../utils/swallow.js";

// Module-level debounce timer for execution history persistence.
// This is safe because the store lives for the entire app session — the timer
// is never leaked. The debounce (1200ms) coalesces rapid history updates
// (e.g. batch log lines) into a single IPC save call.
let persistHistoryTimer = null;

function schedulePersistExecutionHistory(history) {
  if (typeof window === "undefined" || !window.api?.saveExecutionHistory) return;
  if (persistHistoryTimer) clearTimeout(persistHistoryTimer);
  persistHistoryTimer = setTimeout(() => {
    persistHistoryTimer = null;
    void window.api.saveExecutionHistory(history);
  }, 1200);
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

/**
 * Flag-on path: flip `status` to "processing" the first time a job reports
 * progress, but keep the numeric `progress` out of `queue` (it lives in the
 * standalone `jobProgress` map). Returns the same `queue` reference when no
 * item needs a status flip, so subscribers that only read `queue` don't
 * re-render on every progress tick.
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

/**
 * Build the next `jobProgress` map from the current map and a batch of
 * `job_progress` messages. Returns the same reference when nothing changed.
 */
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

/** Batch encode progress, job building, and FFmpeg processing orchestration. */
export function createProcessingSlice(set, get) {
  return {
    isProcessing: false,
    encodeProfile: "balanced",
    batchWorkers: 0,
    batchWorkersMode: "balanced",
    batchRetryFailed: true,
    exportFormat: "mp4",
    batchSummary: null,
    progressDone: 0,
    progressTotal: 0,
    logLines: [],
    executionHistory: [],
    activeExecutionId: null,
    /**
     * Standalone per-job progress map (0..100) used when
     * `VITE_BERU_RENDER_PROGRESS_MAP` is enabled. Keeps `queue` referentially
     * stable during processing. Read via `getJobProgress(idx)` or
     * `useEditorStore((s) => s.jobProgress)`.
     */
    jobProgress: {},
    /** @param {number} idx */
    getJobProgress: (idx) => {
      const map = get().jobProgress;
      const v = map?.[idx];
      return Number.isFinite(v) ? v : null;
    },

    loadExecutionHistory: async () => {
      const api = window.api;
      if (!api?.listExecutionHistory) return [];
      try {
        const res = await api.listExecutionHistory();
        const history = normalizeExecutionHistory(res?.history || []);
        set({ executionHistory: history });
        return history;
      } catch (e) {
        swallow("loadExecutionHistory", e);
        return [];
      }
    },

    clearExecutionHistory: async () => {
      const api = window.api;
      if (api?.clearExecutionHistory) {
        try {
          await api.clearExecutionHistory();
        } catch (e) {
          swallow("clearExecutionHistory", e);
        }
      }
      set({ executionHistory: [], activeExecutionId: null, logLines: [] });
      return { ok: true };
    },

    startExecutionRun: ({ kind = "batch", jobCount = 0 } = {}) =>
      set((s) => {
        let history = normalizeExecutionHistory(s.executionHistory);
        if (s.activeExecutionId) {
          history = finalizeExecutionRun(
            history,
            s.activeExecutionId,
            s.batchSummary || summarizeQueue(s.queue),
          );
        }
        const run = createExecutionRun({ kind, jobCount });
        history = prependExecutionRun(history, run);
        schedulePersistExecutionHistory(history);
        return {
          executionHistory: history,
          activeExecutionId: run.id,
          batchSummary: null,
          logLines: [],
        };
      }),

    finalizeActiveExecution: (summary) =>
      set((s) => {
        if (!s.activeExecutionId) return {};
        const history = finalizeExecutionRun(
          s.executionHistory,
          s.activeExecutionId,
          summary ?? s.batchSummary ?? summarizeQueue(s.queue),
        );
        schedulePersistExecutionHistory(history);
        return {
          executionHistory: history,
          activeExecutionId: null,
        };
      }),

    appendLog: (line) =>
      set((s) => {
        let history = s.executionHistory;
        let activeId = s.activeExecutionId;
        if (!activeId) {
          const run = createExecutionRun({ kind: "batch", jobCount: 0 });
          history = prependExecutionRun(history, run);
          activeId = run.id;
        }
        history = appendLineToRun(history, activeId, line);
        schedulePersistExecutionHistory(history);
        return {
          executionHistory: history,
          activeExecutionId: activeId,
          logLines: appendProcessingLog(s.logLines, line),
        };
      }),

    // Batched variant of appendLog — one store update for N log lines.
    appendLogBatch: (lines) => {
      if (!lines || lines.length === 0) return;
      set((s) => {
        let history = s.executionHistory;
        let activeId = s.activeExecutionId;
        if (!activeId) {
          const run = createExecutionRun({ kind: "batch", jobCount: 0 });
          history = prependExecutionRun(history, run);
          activeId = run.id;
        }
        for (const line of lines) {
          history = appendLineToRun(history, activeId, line);
        }
        let logLines = s.logLines;
        for (const line of lines) {
          logLines = appendProcessingLog(logLines, line);
        }
        schedulePersistExecutionHistory(history);
        return { executionHistory: history, activeExecutionId: activeId, logLines };
      });
    },

    exportProcessingLogsText: () => {
      const { executionHistory, batchSummary, logLines } = get();
      if (executionHistory.length > 0) {
        return formatExecutionHistoryExport(executionHistory, {
          summary: batchSummary
            ? `${batchSummary.succeeded || 0}/${batchSummary.total || 0} OK, ${
                batchSummary.failed || 0
              } failed`
            : "",
        });
      }
      return formatProcessingLogs(logLines, {
        summary: batchSummary
          ? `${batchSummary.succeeded || 0}/${batchSummary.total || 0} OK, ${
              batchSummary.failed || 0
            } failed`
          : "",
      });
    },

    updateProcessingProgress: (msg) =>
      set((s) => {
        const current = msg.current ?? msg.done;
        const total = msg.total;
        return {
          progressDone: current != null ? current : s.progressDone,
          progressTotal: total != null && total > 0 ? total : s.progressTotal,
        };
      }),

    updateJobProgressBatch: (messages) =>
      set((s) => {
        const msgs = Array.isArray(messages) ? messages : [];
        if (PERF_FLAGS.progressMap) {
          const queue = applyJobProgressStatusOnly(s.queue, msgs);
          const jobProgress = applyJobProgressMap(s.jobProgress, s.queue, msgs);
          const queueChanged = queue !== s.queue;
          const progressChanged = jobProgress !== s.jobProgress;
          if (!queueChanged && !progressChanged) return s;
          return queueChanged ? { queue, jobProgress } : { jobProgress };
        }
        const queue = applyJobProgressMessages(s.queue, msgs);
        return queue === s.queue ? s : { queue };
      }),

    markJobDone: (msg) =>
      set((s) => {
        const idx = msg.index;
        if (!isQueueJobIndex(idx, s.queue.length)) return {};
        const updated = [...s.queue];
        updated[idx] = { ...updated[idx], status: "done", progress: 100, error: null };
        const jobProgress =
          PERF_FLAGS.progressMap && s.jobProgress?.[idx] !== undefined
            ? { ...s.jobProgress, [idx]: 100 }
            : s.jobProgress;
        return {
          queue: updated,
          progressDone: Math.min(s.progressDone + 1, s.progressTotal),
          jobProgress,
        };
      }),

    markJobError: (msg) =>
      set((s) => {
        const idx = msg.index;
        if (!isQueueJobIndex(idx, s.queue.length)) return {};
        const updated = [...s.queue];
        updated[idx] = { ...updated[idx], status: "error", error: msg.error };
        // Delete the key (instead of setting it to undefined) so
        // hasOwnProperty-based consumers like getBatchProgress don't read NaN
        // and applyJobProgressMap doesn't carry stale entries forward.
        const jobProgress =
          PERF_FLAGS.progressMap && s.jobProgress?.[idx] !== undefined
            ? (() => {
                const next = { ...s.jobProgress };
                delete next[idx];
                return next;
              })()
            : s.jobProgress;
        return {
          queue: updated,
          progressDone: Math.min(s.progressDone + 1, s.progressTotal),
          jobProgress,
        };
      }),

    refreshMissingVideoInfo: async (api) => {
      const missing = get().queue.filter((item) => !item.width || !item.height);
      if (missing.length === 0 || (!api?.getVideoInfoBatch && !api?.getVideoInfo)) {
        return get().queue;
      }

      let infos = [];
      try {
        if (api.getVideoInfoBatch) {
          infos = await api.getVideoInfoBatch(missing.map((item) => item.path));
        } else if (api.getVideoInfo) {
          infos = await Promise.all(missing.map((item) => api.getVideoInfo(item.path)));
        }
      } catch (e) {
        swallow("refreshMissingVideoInfo-batch", e);
        return get().queue;
      }
      if (!Array.isArray(infos)) infos = [];

      if (api.getVideoInfo) {
        await Promise.all(
          missing.map(async (item, i) => {
            if (hasVideoDimensions({ width: infos[i]?.width, height: infos[i]?.height })) return;
            try {
              const retry = await api.getVideoInfo(item.path);
              if (hasVideoDimensions(retry)) infos[i] = retry;
            } catch (e) {
              swallow("refreshMissingVideoInfo-retry", e);
            }
          }),
        );
      }

      const infoByPath = new Map(missing.map((item, i) => [item.path, infos[i] || {}]));
      const current = get().queue;
      const next = current.map((item) => {
        if (hasVideoDimensions(getLockedDimensions(item))) return item;
        const info = infoByPath.get(item.path);
        const { width, height } = getLockedDimensions({ ...item, ...info });
        if (width <= 0 || height <= 0) return item;
        return mergeProbeIntoQueueItem(item, info);
      });

      if (next.some((item, i) => item !== current[i])) {
        set({ queue: next });
        return next;
      }
      return current;
    },

    _buildJobFor: (item, index) => {
      if (!item) return null;
      const { encodeProfile } = get();
      const outPath = get().outputPathFor(item);
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
        watermark: get().watermark?.enabled ? get().watermark : null,
      };
    },

    buildPreviewFrameJob: (videoIdx, timestamp) => {
      const state = get();
      const item = state.queue[videoIdx];
      if (!item) return null;

      const operations =
        state.templateRegions?.length > 0
          ? buildBatchTextOperationsForPreview(state, videoIdx)
          : item.operations;
      const syntheticItem = { ...item, operations };
      const job = get()._buildJobFor(syntheticItem, videoIdx);
      if (!job) return null;

      const ts = Number(timestamp);
      return {
        ...job,
        timestamp: Number.isFinite(ts) && ts >= 0 ? ts : 0,
      };
    },

    processSingle: async (videoIdx) => {
      const api = window.api;
      if (!api?.startProcessing) {
        return { ok: false, error: "API de procesamiento no disponible" };
      }
      if (get().templateRegions.length > 0) {
        get().materializeBatchTextOps();
      }
      let { queue, isProcessing } = get();
      if (isProcessing) return { ok: false, error: "Ya hay un proceso en ejecución" };
      if (videoIdx < 0 || videoIdx >= queue.length) return { ok: false, error: "Video inválido" };
      if (!queue[videoIdx].width || !queue[videoIdx].height) {
        queue = await get().refreshMissingVideoInfo(api);
        if (videoIdx < 0 || videoIdx >= queue.length) return { ok: false, error: "Video inválido" };
      }
      const item = queue[videoIdx];
      const job = get()._buildJobFor(item, videoIdx);
      if (!job) return { ok: false, error: "No se pudo construir el job" };

      get().startExecutionRun({ kind: "single", jobCount: 1 });
      set({ isProcessing: true, progressTotal: 1, progressDone: 0, jobProgress: {} });
      const updated = [...queue];
      updated[videoIdx] = { ...updated[videoIdx], status: "processing", progress: 0, error: null };
      set({ queue: updated });

      try {
        const result = await api.startProcessing(createJobManifest([job]));
        const itemError = get().queue[videoIdx]?.error;
        return {
          ok: !!result?.success,
          outputPath: job.output_path,
          error: result?.error || itemError || undefined,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      } finally {
        get().finalizeActiveExecution(summarizeQueue(get().queue));
        set({ isProcessing: false });
      }
    },

    setProcessing: (val) =>
      set((s) => {
        const isProcessing = !!val;
        if (s.isProcessing && !isProcessing) {
          schedulePersistExecutionHistory(s.executionHistory);
        }
        return s.isProcessing === isProcessing ? {} : { isProcessing };
      }),

    /** Reset queue rows left mid-batch after user cancel or main-process abort. */
    abortActiveProcessing: () =>
      set((s) => {
        let queueChanged = false;
        const queue = s.queue.map((item) => {
          if (item.status !== "processing") return item;
          queueChanged = true;
          return { ...item, status: "idle", progress: 0, error: null };
        });
        return {
          ...(queueChanged ? { queue } : {}),
          jobProgress: {},
          isProcessing: false,
        };
      }),
    setBatchSummary: (val) =>
      set((s) => {
        if (!val || !s.activeExecutionId) {
          return { batchSummary: val };
        }
        const history = finalizeExecutionRun(s.executionHistory, s.activeExecutionId, val);
        schedulePersistExecutionHistory(history);
        return {
          batchSummary: val,
          executionHistory: history,
          activeExecutionId: null,
        };
      }),

    setEncodeProfile: async (val) => {
      const profile = val === "fast" || val === "quality" || val === "uquality" ? val : "balanced";
      set({ encodeProfile: profile });
      const api = window.api;
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ encodeProfile: profile });
        } catch (e) {
          console.error("[beru] Failed to save encode profile:", e.message);
        }
      }
    },

    setBatchWorkers: async (val) => {
      const n = Number(val);
      const workers = Number.isFinite(n) && n >= 0 ? Math.min(16, Math.floor(n)) : 0;
      set({ batchWorkers: workers });
      const api = window.api;
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ batchWorkers: workers });
        } catch (e) {
          console.error("[beru] Failed to save batch workers:", e.message);
        }
      }
    },

    setBatchRetryFailed: async (enabled) => {
      const batchRetryFailed = !!enabled;
      set({ batchRetryFailed });
      const api = window.api;
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ batchRetryFailed });
        } catch (e) {
          console.error("[beru] Failed to save batch retry setting:", e.message);
        }
      }
    },

    setExportFormat: (val) => set({ exportFormat: val }),
  };
}
