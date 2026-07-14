import { hasVideoDimensions } from "../../utils/batch-process";
import { buildBatchTextOperationsForPreview } from "../../utils/preview-frame-job";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
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
import {
  applyJobDone,
  applyJobError,
  applyJobCancelled,
  applyJobProgressBatch,
  abortProcessingQueue,
  buildExportJob,
} from "../../utils/export-pipeline.js";
import { runSingle } from "../../utils/batch-runner.js";

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

function processingHooks(set, get) {
  return {
    startExecutionRun: (opts) => get().startExecutionRun(opts),
    applyPatch: (patch) => set(patch),
    getQueue: () => get().queue,
    finalizeActiveExecution: (summary) => get().finalizeActiveExecution(summary),
    summarizeQueue,
  };
}

/** Batch encode progress, job building, and FFmpeg processing orchestration. */
export function createProcessingSlice(set, get) {
  return {
    isProcessing: false,
    /** Main-process processing run id (for ignoring stale process:error/finished). */
    activeProcessRunId: null,
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

    setActiveProcessRunId: (runId) => set({ activeProcessRunId: runId || null }),
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
        const { queue, jobProgress } = applyJobProgressBatch({
          queue: s.queue,
          jobProgress: s.jobProgress,
          messages,
          progressMap: PERF_FLAGS.progressMap,
        });
        const queueChanged = queue !== s.queue;
        const progressChanged = jobProgress !== s.jobProgress;
        if (!queueChanged && !progressChanged) return s;
        if (PERF_FLAGS.progressMap) {
          return queueChanged ? { queue, jobProgress } : { jobProgress };
        }
        return queueChanged ? { queue } : s;
      }),

    markJobDone: (msg) =>
      set((s) =>
        applyJobDone({
          queue: s.queue,
          jobProgress: s.jobProgress,
          progressDone: s.progressDone,
          progressTotal: s.progressTotal,
          msg,
          progressMap: PERF_FLAGS.progressMap,
        }),
      ),

    markJobError: (msg) =>
      set((s) =>
        applyJobError({
          queue: s.queue,
          jobProgress: s.jobProgress,
          progressDone: s.progressDone,
          progressTotal: s.progressTotal,
          msg,
          progressMap: PERF_FLAGS.progressMap,
        }),
      ),

    markJobCancelled: (msg) =>
      set((s) =>
        applyJobCancelled({
          queue: s.queue,
          jobProgress: s.jobProgress,
          progressDone: s.progressDone,
          progressTotal: s.progressTotal,
          msg,
          progressMap: PERF_FLAGS.progressMap,
        }),
      ),

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
      return buildExportJob(item, index, {
        encodeProfile: get().encodeProfile,
        outputPath: get().outputPathFor(item),
        watermark: get().watermark?.enabled ? get().watermark : null,
      });
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
      if (videoIdx < 0 || videoIdx >= queue.length) {
        return { ok: false, error: "Video inválido" };
      }
      if (!queue[videoIdx].width || !queue[videoIdx].height) {
        queue = await get().refreshMissingVideoInfo(api);
        if (videoIdx < 0 || videoIdx >= queue.length) {
          return { ok: false, error: "Video inválido" };
        }
      }
      const live = get();
      if (live.isProcessing) {
        return { ok: false, error: "Ya hay un proceso en ejecución" };
      }
      const item = queue[videoIdx];
      const job = get()._buildJobFor(item, videoIdx);
      return runSingle({
        api,
        job,
        videoIdx,
        queue,
        isProcessing: live.isProcessing,
        hooks: processingHooks(set, get),
      });
    },

    setProcessing: (val) =>
      set((s) => {
        const isProcessing = !!val;
        if (s.isProcessing && !isProcessing) {
          schedulePersistExecutionHistory(s.executionHistory);
        }
        if (s.isProcessing === isProcessing && (isProcessing || !s.activeProcessRunId)) {
          return {};
        }
        return {
          isProcessing,
          ...(isProcessing ? {} : { activeProcessRunId: null }),
        };
      }),

    /** Reset queue rows left mid-batch after user cancel or main-process abort. */
    abortActiveProcessing: () =>
      set((s) => {
        const { queue, queueChanged } = abortProcessingQueue(s.queue);
        return {
          ...(queueChanged ? { queue } : {}),
          jobProgress: {},
          isProcessing: false,
          activeProcessRunId: null,
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

    setBatchWorkersMode: async (val) => {
      const batchWorkersMode = val === "conservative" ? "conservative" : "balanced";
      set({ batchWorkersMode });
      const api = window.api;
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ batchWorkersMode });
        } catch (e) {
          console.error("[beru] Failed to save batch workers mode:", e.message);
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
