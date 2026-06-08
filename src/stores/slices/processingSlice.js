import { denormalizeRegion } from "../../utils/types";
import { sanitizeOperation } from "../../utils/delogo-ops";
import { filterOperationsForExport, hasVideoDimensions } from "../../utils/batch-process";
import { buildBatchTextOperationsForPreview } from "../../utils/preview-frame-job";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { textStyleToPythonPayload } from "../../utils/text-style";
import { createJobManifest } from "../../utils/job-manifest";
import { appendProcessingLog, formatProcessingLogs } from "../../utils/processing-logs";

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

    appendLog: (line) =>
      set((s) => ({
        logLines: appendProcessingLog(s.logLines, line),
      })),

    exportProcessingLogsText: () =>
      formatProcessingLogs(get().logLines, {
        summary: get().batchSummary
          ? `${get().batchSummary.succeeded || 0}/${get().batchSummary.total || 0} OK, ${
              get().batchSummary.failed || 0
            } failed`
          : "",
      }),

    updateProcessingProgress: (msg) =>
      set((s) => {
        const current = msg.current ?? msg.done;
        const total = msg.total;
        return {
          progressDone: current != null ? current : s.progressDone,
          progressTotal: total != null && total > 0 ? total : s.progressTotal,
        };
      }),

    updateJobProgress: (msg) => get().updateJobProgressBatch([msg]),

    updateJobProgressBatch: (messages) =>
      set((s) => {
        const queue = applyJobProgressMessages(s.queue, Array.isArray(messages) ? messages : []);
        return queue === s.queue ? s : { queue };
      }),

    markJobDone: (msg) =>
      set((s) => {
        const idx = msg.index;
        if (!isQueueJobIndex(idx, s.queue.length)) return {};
        const updated = [...s.queue];
        updated[idx] = { ...updated[idx], status: "done", progress: 100, error: null };
        return {
          queue: updated,
          progressDone: Math.min(s.progressDone + 1, s.progressTotal),
        };
      }),

    markJobError: (msg) =>
      set((s) => {
        const idx = msg.index;
        if (!isQueueJobIndex(idx, s.queue.length)) return {};
        const updated = [...s.queue];
        updated[idx] = { ...updated[idx], status: "error", error: msg.error };
        return {
          queue: updated,
          progressDone: Math.min(s.progressDone + 1, s.progressTotal),
        };
      }),

    updateQueueItemStatus: (idx, patch) => {
      set((s) => {
        const updated = [...s.queue];
        updated[idx] = { ...updated[idx], ...patch };
        return { queue: updated };
      });
    },

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
      } catch {
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
            } catch {
              /* keep prior info */
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

      set({ isProcessing: true, progressTotal: 1, progressDone: 0 });
      const updated = [...queue];
      updated[videoIdx] = { ...updated[videoIdx], status: "processing", progress: 0, error: null };
      set({ queue: updated });

      try {
        const result = await api.startProcessing(
          createJobManifest([job], { profile: get().encodeProfile }),
        );
        const itemError = get().queue[videoIdx]?.error;
        return {
          ok: !!result?.success,
          outputPath: job.output_path,
          error: result?.error || itemError || undefined,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      } finally {
        set({ isProcessing: false });
      }
    },

    setProcessing: (val) =>
      set((s) => {
        const isProcessing = !!val;
        return s.isProcessing === isProcessing ? {} : { isProcessing };
      }),
    setBatchSummary: (val) => set({ batchSummary: val }),

    setEncodeProfile: async (val) => {
      const profile = val === "fast" || val === "quality" ? val : "balanced";
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
