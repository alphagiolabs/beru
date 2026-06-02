import { denormalizeRegion } from "../../utils/types";
import { sanitizeOperation } from "../../utils/delogo-ops";

function isQueueJobIndex(idx, queueLength) {
  return Number.isInteger(idx) && idx >= 0 && idx < queueLength;
}

/** Batch encode progress, job building, and FFmpeg processing orchestration. */
export function createProcessingSlice(set, get) {
  return {
    isProcessing: false,
    encodeProfile: "balanced",
    batchWorkers: 0,
    exportFormat: "mp4",
    batchSummary: null,
    progressDone: 0,
    progressTotal: 0,
    logLines: [],

    appendLog: (line) => set((s) => ({
      logLines: [...s.logLines.slice(-199), line],
    })),

    updateProcessingProgress: (msg) => set((s) => {
      const current = msg.current ?? msg.done;
      const total = msg.total;
      return {
        progressDone: current != null ? current : s.progressDone,
        progressTotal: total != null && total > 0 ? total : s.progressTotal,
      };
    }),

    updateJobProgress: (msg) => set((s) => {
      const idx = msg.index;
      if (!isQueueJobIndex(idx, s.queue.length)) return {};
      const updated = [...s.queue];
      updated[idx] = {
        ...updated[idx],
        status: "processing",
        progress: Math.round(msg.percent ?? updated[idx].progress ?? 0),
      };
      return { queue: updated };
    }),

    markJobDone: (msg) => set((s) => {
      const idx = msg.index;
      if (!isQueueJobIndex(idx, s.queue.length)) return {};
      const updated = [...s.queue];
      updated[idx] = { ...updated[idx], status: "done", progress: 100, error: null };
      const terminal = updated.filter((q) => q.status === "done" || q.status === "error").length;
      return {
        queue: updated,
        progressDone: Math.max(s.progressDone, terminal),
      };
    }),

    markJobError: (msg) => set((s) => {
      const idx = msg.index;
      if (!isQueueJobIndex(idx, s.queue.length)) return {};
      const updated = [...s.queue];
      updated[idx] = { ...updated[idx], status: "error", error: msg.error };
      const terminal = updated.filter((q) => q.status === "done" || q.status === "error").length;
      return {
        queue: updated,
        progressDone: Math.max(s.progressDone, terminal),
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
        infos = api.getVideoInfoBatch
          ? await api.getVideoInfoBatch(missing.map((item) => item.path))
          : await Promise.all(missing.map((item) => api.getVideoInfo(item.path)));
      } catch {
        return get().queue;
      }
      if (!Array.isArray(infos)) infos = [];

      const infoByPath = new Map(missing.map((item, i) => [item.path, infos[i] || {}]));
      const current = get().queue;
      const next = current.map((item) => {
        if (item.width && item.height) return item;
        const info = infoByPath.get(item.path);
        const width = Number(info?.width || 0);
        const height = Number(info?.height || 0);
        if (width <= 0 || height <= 0) return item;
        return {
          ...item,
          width,
          height,
          duration: Number(info.duration || item.duration || 0),
          videoCodec: info.videoCodec || item.videoCodec || "",
          pixFmt: info.pixFmt || item.pixFmt || "yuv420p",
          frameRate: Number(info.frameRate || item.frameRate || 0),
          audioCodec: info.audioCodec || item.audioCodec || "",
        };
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
      return {
        id: index,
        input_path: item.path,
        output_path: outPath,
        width: item.width || 0,
        height: item.height || 0,
        operations: item.operations.map((op) => {
          const safe = sanitizeOperation(op);
          return {
            mode: safe.mode,
            region: safe.region
              ? (item.width > 0 && item.height > 0
                ? denormalizeRegion(safe.region, item.width, item.height)
                : safe.region)
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
            font_size: safe.fontSize,
            font_color: safe.fontColor,
            font_family: safe.fontFamily,
            font_weight: safe.fontWeight,
            letter_spacing: safe.letterSpacing,
            text_align: safe.textAlign,
            text_opacity: safe.textOpacity,
            bold: safe.bold,
            italic: safe.italic,
            bg_enabled: safe.bgEnabled,
            bg_color: safe.bgColor,
            bg_opacity: safe.bgOpacity,
            box_border_width: safe.boxBorderWidth,
            border_width: safe.borderWidth,
            border_color: safe.borderColor,
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
        encode_profile: encodeProfile,
      };
    },

    processSingle: async (videoIdx) => {
      const api = window.api;
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
        const result = await api.startProcessing([job]);
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

    setProcessing: (val) => set({ isProcessing: val }),
    setBatchSummary: (val) => set({ batchSummary: val }),

    setEncodeProfile: async (val) => {
      const profile = val === "fast" || val === "quality" ? val : "balanced";
      set({ encodeProfile: profile });
      const api = window.api;
      if (api?.saveSettings) {
        try { await api.saveSettings({ encodeProfile: profile }); } catch (e) {
          console.error("[beru] Failed to save encode profile:", e.message);
        }
      }
    },

    setBatchWorkers: async (val) => {
      const n = Number(val);
      const workers = Number.isFinite(n) && n >= 0 ? Math.min(8, Math.floor(n)) : 0;
      set({ batchWorkers: workers });
      const api = window.api;
      if (api?.saveSettings) {
        try { await api.saveSettings({ batchWorkers: workers }); } catch (e) {
          console.error("[beru] Failed to save batch workers:", e.message);
        }
      }
    },

    setExportFormat: (val) => set({ exportFormat: val }),
  };
}