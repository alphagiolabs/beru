import { fetchVideoInfos } from "../../utils/video-info.js";
import { hasVideoDimensions } from "../../utils/batch-process";
import { buildBatchTextOperationsForPreview } from "../../utils/batch-text-ops";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { swallow } from "../../utils/swallow.js";
import { buildExportJob } from "../../utils/export-pipeline.js";
import { createProcessingRun } from "../../utils/processing-run.js";
import { prepareRun } from "../../utils/export-run.js";
import { stampJobTimestamp } from "../../utils/job-signature.js";
import {
  normalizeBatchWorkers,
  normalizeBatchWorkersMode,
  normalizeEncodeProfile,
} from "../../utils/processing-settings.js";
import { createJobManifest } from "../../utils/job-manifest.js";

async function persistProcessingSetting(partial, label) {
  const api = window.api;
  if (!api?.saveSettings) return;
  try {
    await api.saveSettings(partial);
  } catch (e) {
    console.error(`[beru] Failed to save ${label}:`, e.message);
  }
}

const MEDIA_START_BY_KIND = {
  composition: "startComposition",
  stabilization: "startStabilization",
};

export function createProcessingSlice(set, get) {
  const processingRun = createProcessingRun(set, get);
  return {
    isProcessing: false,
    mediaExport: null,
    exportMediaArtifact: async (job, { signature = null } = {}) => {
      if (!job) return { ok: false, code: "no_job" };
      const state = get(),
        api = window.api;
      const start = api?.[MEDIA_START_BY_KIND[job.kind]];
      if (!start) return { ok: false, code: "api_unavailable" };
      const previous = state.mediaExport?.kind === job.kind ? state.mediaExport : null;
      const prepared = {
        ok: true,
        jobs: [job],
        manifest: createJobManifest([job]),
        startPatch: {
          queue: state.queue,
          exportSignatures: state.exportSignatures,
          isProcessing: true,
          mediaExport: {
            kind: job.kind,
            jobId: job.id,
            status: "processing",
            progress: 0,
            outputPath: null,
            error: null,
            signature,
            sourcePath: job.input_path || null,
            variant: job.kind === "stabilization" && job.sample_seconds != null ? "sample" : "full",
            confirmedOutputPath: previous ? previous.confirmedOutputPath : null,
            confirmedSignature: previous ? previous.confirmedSignature : null,
            confirmedAt: previous ? previous.confirmedAt : null,
            confirmedVariant: previous ? previous.confirmedVariant : null,
            confirmedSourcePath: previous ? previous.confirmedSourcePath : null,
          },
        },
      };
      return processingRun.start({ ...api, startProcessing: start }, prepared, job.id);
    },
    activeProcessRunId: null,
    activeProcessingKind: null,
    encodeProfile: "balanced",
    batchWorkers: 0,
    batchWorkersMode: "balanced",
    batchRetryFailed: true,
    exportFormat: "mp4",
    batchSummary: null,
    progressDone: 0,
    progressTotal: 0,
    exportSignatures: {},

    jobProgress: {},
    connectProcessing: processingRun.connect,

    refreshMissingVideoInfo: async (api) => {
      const missing = get().queue.filter((item) => !item.width || !item.height);
      if (missing.length === 0 || (!api?.getVideoInfoBatch && !api?.getVideoInfo)) {
        return get().queue;
      }

      let infos = [];
      try {
        infos = await fetchVideoInfos(
          api,
          missing.map((item) => item.path),
        );
      } catch (e) {
        swallow("refreshMissingVideoInfo-batch", e);
        return get().queue;
      }

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

    buildPreviewFrameJob: (videoIdx, timestamp) => {
      const state = get();
      const item = state.queue[videoIdx];
      if (!item) return null;

      const operations =
        state.templateRegions?.length > 0
          ? buildBatchTextOperationsForPreview(state, videoIdx)
          : item.operations;
      const syntheticItem = { ...item, operations };
      const job = buildExportJob(syntheticItem, videoIdx, {
        encodeProfile: state.encodeProfile,
        outputPath: state.outputPathsForAll()[videoIdx],
        watermark: state.watermark?.enabled ? state.watermark : null,
      });
      return job ? stampJobTimestamp(job, timestamp) : null;
    },

    processAll: async () => {
      const api = window.api;
      if (!api?.startProcessing) {
        return { ok: false, code: "api_unavailable" };
      }
      if (get().isProcessing) return { ok: false, code: "busy" };
      const { templateRegions, sidebarMode } = get();
      if (sidebarMode === "batch" || templateRegions.length > 0) {
        get().materializeBatchTextOps();
      }

      let queueForProcessing = get().queue;
      if (queueForProcessing.some((q) => !hasVideoDimensions(q))) {
        queueForProcessing = await get().refreshMissingVideoInfo(api);
      }

      if (get().isProcessing) {
        return { ok: false, code: "busy" };
      }

      const live = get();
      const prepared = prepareRun({
        queue: queueForProcessing,
        templateRegions,
        getCellText: (videoIdx, regionId) => live.getCellTextForRegion(videoIdx, regionId),
        outputPaths: live.outputPathsForAll(),
        encodeProfile: live.encodeProfile,
        watermark: live.watermark?.enabled ? live.watermark : null,
      });
      if (!prepared.ok) return prepared;
      return processingRun.start(api, prepared);
    },

    cancelProcessing: () => processingRun.cancel(window.api),

    processSingle: async (videoIdx) => {
      const api = window.api;
      if (!api?.startProcessing) {
        return { ok: false, code: "api_unavailable", error: "API de procesamiento no disponible" };
      }
      if (get().isProcessing) {
        return { ok: false, code: "already_processing", error: "Ya hay un proceso en ejecución" };
      }
      if (get().templateRegions.length > 0) {
        get().materializeBatchTextOps();
      }
      let { queue } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) {
        return { ok: false, code: "invalid_video", error: "Video inválido" };
      }
      if (!queue[videoIdx].width || !queue[videoIdx].height) {
        queue = await get().refreshMissingVideoInfo(api);
        if (videoIdx < 0 || videoIdx >= queue.length) {
          return { ok: false, code: "invalid_video", error: "Video inválido" };
        }
      }
      const live = get();
      if (live.isProcessing) {
        return { ok: false, code: "already_processing", error: "Ya hay un proceso en ejecución" };
      }
      const prepared = prepareRun({
        queue,
        videoIdx,
        outputPaths: live.outputPathsForAll(),
        encodeProfile: live.encodeProfile,
        watermark: live.watermark?.enabled ? live.watermark : null,
        exportSignatures: live.exportSignatures,
      });
      if (!prepared.ok) return prepared;
      return processingRun.start(api, prepared, videoIdx);
    },

    setEncodeProfile: async (val) => {
      const profile = normalizeEncodeProfile(val);
      set({ encodeProfile: profile });
      await persistProcessingSetting({ encodeProfile: profile }, "encode profile");
    },

    setBatchWorkers: async (val) => {
      const workers = normalizeBatchWorkers(val);
      set({ batchWorkers: workers });
      await persistProcessingSetting({ batchWorkers: workers }, "batch workers");
    },

    setBatchWorkersMode: async (val) => {
      const batchWorkersMode = normalizeBatchWorkersMode(val);
      set({ batchWorkersMode });
      await persistProcessingSetting({ batchWorkersMode }, "batch workers mode");
    },

    setBatchRetryFailed: async (enabled) => {
      const batchRetryFailed = !!enabled;
      set({ batchRetryFailed });
      await persistProcessingSetting({ batchRetryFailed }, "batch retry setting");
    },

    setExportFormat: (val) => set({ exportFormat: val }),
  };
}
