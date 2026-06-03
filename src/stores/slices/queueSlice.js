import {
  createOperation,
  createQueueItem,
  uid,
  denormalizeRegion,
  ensureNormalized,
} from "../../utils/types";
import { clampRegionToVideo, isRegionUsable } from "../../utils/video-utils";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { sanitizeOperation } from "../../utils/delogo-ops";

const MAX_UNDO_STACK = 50;

function pruneImageDataCache(cache, queue) {
  const used = new Set();
  for (const item of queue) {
    for (const op of item.operations || []) {
      if (op.mode === "image" && op.imagePath) used.add(op.imagePath);
    }
  }
  const next = {};
  for (const [path, dataUrl] of Object.entries(cache || {})) {
    if (used.has(path)) next[path] = dataUrl;
  }
  return next;
}

/** Video queue, region drawing, per-video operations, and undo/redo. */
export function createQueueSlice(set, get) {
  return {
    queue: [],
    selectedIdx: -1,
    currentRegion: null,
    imageDataCache: {},
    undoStack: [],
    redoStack: [],

    /* ── Computed helpers ────────────────────────────────────────────── */

    selected: () => {
      const { queue, selectedIdx } = get();
      return selectedIdx >= 0 && selectedIdx < queue.length ? queue[selectedIdx] : null;
    },

    videoBounds: () => {
      const s = get().selected();
      return getLockedDimensions(s);
    },

    /* Convert a normalized region to pixel coords for the current selected video. */
    currentRegionPx: () => {
      const r = get().currentRegion;
      const b = get().videoBounds();
      if (!r || !b.width || !b.height) return null;
      return denormalizeRegion(r, b.width, b.height);
    },

    /* Convert a normalized region to pixel coords for an arbitrary video. */
    regionPxFor: (region, videoW, videoH) => {
      if (!region || !videoW || !videoH) return null;
      return denormalizeRegion(region, videoW, videoH);
    },

    /* Compute the output file path for a queue item. */
    outputPathFor: (item) => {
      if (!item) return null;
      const { outputDir, exportFormat } = get();
      const filename = item.path.split(/[\\/]/).pop();
      const stem = filename.replace(/\.[^.]+$/, "");
      const outputName = item.customOutputName || `${stem}_beru.${exportFormat}`;
      const outDir = outputDir || item.path.replace(/[\\/][^\\/]*$/, "");
      return `${outDir.replace(/[\\/]+$/, "")}\\${outputName}`;
    },

    /* ── Queue management ───────────────────────────────────────────── */

    _patchQueueVideoInfo: (startIdx, pathList, infos) => {
      if (!Array.isArray(infos) || infos.length === 0) return;
      set((s) => {
        const next = s.queue.slice();
        for (let i = 0; i < pathList.length; i++) {
          const idx = startIdx + i;
          const info = infos[i] || {};
          if (!next[idx] || next[idx].path !== pathList[i]) continue;
          next[idx] = mergeProbeIntoQueueItem(next[idx], info);
        }
        return { queue: next };
      });
    },

    _scheduleThumbnailLoads: (api, toAdd, startIdx) => {
      if (!api?.getThumbnailBatch || toAdd.length === 0) return;

      const applyThumbResults = (paths, results, offset) => {
        if (!Array.isArray(results) || results.length === 0) return;
        set((s) => {
          const next = s.queue.slice();
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const target = offset + i;
            if (!r?.dataUrl || !next[target] || next[target].path !== paths[i]) continue;
            next[target] = { ...next[target], thumbnail: r.dataUrl };
          }
          return { queue: next };
        });
      };

      const loadChunk = (paths, offset) => {
        api
          .getThumbnailBatch(paths)
          .then((results) => applyThumbResults(paths, results, offset))
          .catch(() => {});
      };

      const firstCount = Math.min(4, toAdd.length);
      loadChunk(toAdd.slice(0, firstCount), startIdx);

      const rest = toAdd.slice(firstCount);
      if (rest.length === 0) return;

      const loadRestInChunks = () => {
        const CHUNK = 12;
        for (let off = 0; off < rest.length; off += CHUNK) {
          const slice = rest.slice(off, off + CHUNK);
          loadChunk(slice, startIdx + firstCount + off);
        }
      };

      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(loadRestInChunks, { timeout: 2000 });
      } else {
        setTimeout(loadRestInChunks, 300);
      }
    },

    addVideos: async (paths, api) => {
      const { queue } = get();
      const existing = new Set(queue.map((q) => q.path));
      const toAdd = paths.filter((p) => !existing.has(p));
      if (toAdd.length === 0) return;

      const newItems = toAdd.map((p) => {
        const filename = p.split(/[\\/]/).pop();
        return createQueueItem({
          path: p,
          src: `beru://local/${encodeURIComponent(p)}`,
          filename,
          width: 0,
          height: 0,
          duration: 0,
        });
      });
      const startIdx = queue.length;
      set((s) => ({
        queue: [...s.queue, ...newItems],
        selectedIdx: s.selectedIdx < 0 && newItems.length > 0 ? startIdx : s.selectedIdx,
      }));

      get()._scheduleThumbnailLoads(api, toAdd, startIdx);

      const fetchInfos = api?.getVideoInfoBatch
        ? () => api.getVideoInfoBatch(toAdd)
        : () =>
            Promise.all(
              toAdd.map((p) =>
                api?.getVideoInfo
                  ? api.getVideoInfo(p)
                  : Promise.resolve({ width: 0, height: 0, duration: 0 }),
              ),
            );

      return fetchInfos()
        .then((infos) => get()._patchQueueVideoInfo(startIdx, toAdd, infos))
        .catch(() => {});
    },

    removeVideo: (idx) => {
      set((s) => {
        const next = s.queue.filter((_, i) => i !== idx);
        let sel = s.selectedIdx;
        if (sel >= next.length) sel = next.length - 1;
        if (sel === idx) sel = Math.min(idx, next.length - 1);
        // Rebuild excelMatchStatus with re-indexed keys
        const newStatus = {};
        Object.entries(s.excelMatchStatus).forEach(([k, v]) => {
          const ki = Number(k);
          if (ki < idx) newStatus[ki] = v;
          else if (ki > idx) newStatus[ki - 1] = v;
        });
        return {
          queue: next,
          selectedIdx: sel,
          excelMatchStatus: newStatus,
          imageDataCache: pruneImageDataCache(s.imageDataCache, next),
        };
      });
    },

    selectVideo: (idx) => {
      set({ selectedIdx: idx, currentRegion: null, undoStack: [], redoStack: [] });
      const api = window.api;
      const item = get().queue[idx];
      if (api?.getThumbnail && item && !item.thumbnail) {
        api
          .getThumbnail(item.path)
          .then((r) => {
            if (!r?.dataUrl) return;
            set((s) => {
              if (s.selectedIdx !== idx || !s.queue[idx]) return s;
              const next = s.queue.slice();
              next[idx] = { ...next[idx], thumbnail: r.dataUrl };
              return { queue: next };
            });
          })
          .catch(() => {});
      }
    },

    /* ── Region operations ──────────────────────────────────────────── */
    /* All regions are stored NORMALIZED (0..1) so the same region can be reused
     * across videos of any resolution. */

    setCurrentRegion: (region) => {
      if (!region) {
        set({ currentRegion: null });
        return;
      }
      const safe = ensureNormalized(region, 1920, 1080);
      set({ currentRegion: clampRegionToVideo(safe) });
    },

    updateRegionValue: (key, value) => {
      const r = get().currentRegion;
      if (!r) return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      set({ currentRegion: clampRegionToVideo({ ...r, [key]: parsed }) });
    },

    /* ── Operations ─────────────────────────────────────────────────── */

    _saveUndo: () => {
      const { queue, selectedIdx, undoStack } = get();
      if (selectedIdx < 0 || selectedIdx >= queue.length) return;
      const ops = queue[selectedIdx].operations.map((op) => ({
        ...op,
        region: op.region ? { ...op.region } : null,
      }));
      set({ undoStack: [...undoStack.slice(-(MAX_UNDO_STACK - 1)), ops], redoStack: [] });
    },

    addOperation: (mode) => {
      const { queue, selectedIdx, currentRegion } = get();
      if (selectedIdx < 0 || !currentRegion || !isRegionUsable(currentRegion)) return;
      get()._saveUndo();

      const op = sanitizeOperation(
        createOperation({
          mode,
          region: { ...currentRegion },
          blurStrength: get().blurStrength,
          delogoMethod: get().delogoMethod,
          delogoFillColor: get().delogoFillColor,
          delogoFillOpacity: get().delogoFillOpacity,
          temporalRadius: get().temporalRadius,
          mosaicSize: get().mosaicSize,
          mirrorSide: get().mirrorSide,
          edgeFeather: get().edgeFeather,
          text: get().textInput,
          fontSize: get().textFontSize,
          fontColor: get().textFontColor,
          fontFamily: get().fontFamily,
          bold: get().bold,
          italic: get().italic,
          bgEnabled: get().bgEnabled,
          bgColor: get().bgColor,
          bgOpacity: get().bgOpacity,
          borderWidth: get().borderWidth,
          borderColor: get().borderColor,
          imagePath: get().tempImagePath,
          imageOpacity: get().tempImageOpacity,
          startTime: get().tempStart,
          endTime: get().tempEnd,
        }),
      );

      const updated = [...queue];
      updated[selectedIdx] = {
        ...updated[selectedIdx],
        operations: [...updated[selectedIdx].operations, op],
      };
      const newCache = { ...get().imageDataCache };
      if (mode === "image" && op.imagePath && get().tempImageDataUrl) {
        newCache[op.imagePath] = get().tempImageDataUrl;
      }
      set({ queue: updated, currentRegion: null, imageDataCache: newCache });
    },

    removeOperation: (opIdx) => {
      const { selectedIdx } = get();
      if (selectedIdx < 0) return;
      get().removeOperationAt(selectedIdx, opIdx);
    },

    removeOperationAt: (videoIdx, opIdx) => {
      const { queue } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return;
      const ops = queue[videoIdx].operations;
      if (opIdx < 0 || opIdx >= ops.length) return;
      const op = ops[opIdx];
      const regionId = get().findTemplateRegionIdForOp(op);
      const updated = [...queue];
      updated[videoIdx] = {
        ...updated[videoIdx],
        operations: ops.filter((_, i) => i !== opIdx),
      };
      set({
        queue: updated,
        imageDataCache: pruneImageDataCache(get().imageDataCache, updated),
      });
      if (regionId != null && op?.mode === "text") {
        get().syncTextToExcel(videoIdx, regionId, "");
      }
    },

    moveOperation: (fromIdx, toIdx) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      get()._saveUndo();
      const updated = [...queue];
      const ops = [...updated[selectedIdx].operations];
      const [moved] = ops.splice(fromIdx, 1);
      ops.splice(toIdx, 0, moved);
      updated[selectedIdx] = { ...updated[selectedIdx], operations: ops };
      set({ queue: updated });
    },

    duplicateOperation: (opIdx) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      get()._saveUndo();
      const updated = [...queue];
      const ops = [...updated[selectedIdx].operations];
      const clone = sanitizeOperation({
        ...ops[opIdx],
        id: uid(),
        region: ops[opIdx].region ? { ...ops[opIdx].region } : null,
      });
      ops.splice(opIdx + 1, 0, clone);
      updated[selectedIdx] = { ...updated[selectedIdx], operations: ops };
      set({ queue: updated });
    },

    updateOperationRegion: (opIdx, region) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      const updated = [...queue];
      const ops = [...updated[selectedIdx].operations];
      ops[opIdx] = { ...ops[opIdx], region: { ...region } };
      updated[selectedIdx] = { ...updated[selectedIdx], operations: ops };
      set({ queue: updated });
    },

    clearOperations: () => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      get()._saveUndo();
      const updated = [...queue];
      updated[selectedIdx] = {
        ...updated[selectedIdx],
        operations: [],
        status: "idle",
        progress: 0,
        error: null,
      };
      set({ queue: updated });
    },

    applyStyleToOperation: (opIdx, style) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      const updated = [...queue];
      const ops = [...updated[selectedIdx].operations];
      ops[opIdx] = { ...ops[opIdx], ...style };
      updated[selectedIdx] = { ...updated[selectedIdx], operations: ops };
      set({ queue: updated });
    },

    updateOperation: (videoIdx, opIdx, patch) => {
      const { queue } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return;
      const updated = [...queue];
      const ops = [...updated[videoIdx].operations];
      if (opIdx < 0 || opIdx >= ops.length) return;
      ops[opIdx] = { ...ops[opIdx], ...patch };
      updated[videoIdx] = { ...updated[videoIdx], operations: ops };
      set({ queue: updated });
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        const regionId = get().findTemplateRegionIdForOp(ops[opIdx]);
        if (regionId != null) get().syncTextToExcel(videoIdx, regionId, patch.text ?? "");
      }
    },

    updateOperationText: (videoIdx, opIdx, text) => {
      get().updateOperation(videoIdx, opIdx, { text });
    },

    createTextOpForRegion: (videoIdx, regionId) => {
      const {
        queue,
        templateRegions,
        textFontSize,
        textFontColor,
        fontFamily,
        fontWeight,
        letterSpacing,
        textAlign,
        textOpacity,
        bold,
        italic,
        bgEnabled,
        bgColor,
        bgOpacity,
        boxBorderWidth,
        borderWidth,
        borderColor,
      } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return -1;
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return -1;
      const op = createOperation({
        mode: "text",
        region: { ...tr.region },
        text: "",
        fontSize: textFontSize,
        fontColor: textFontColor,
        fontFamily,
        fontWeight,
        letterSpacing,
        textAlign,
        textOpacity,
        bold,
        italic,
        bgEnabled,
        bgColor,
        bgOpacity,
        boxBorderWidth,
        borderWidth,
        borderColor,
      });
      const updated = [...queue];
      updated[videoIdx] = {
        ...updated[videoIdx],
        operations: [...updated[videoIdx].operations, op],
      };
      set({ queue: updated });
      return updated[videoIdx].operations.length - 1;
    },

    /* ── Undo / Redo ────────────────────────────────────────────────── */

    undo: () => {
      const { undoStack, queue, selectedIdx } = get();
      if (undoStack.length === 0 || selectedIdx < 0) return;
      const prev = undoStack[undoStack.length - 1];
      const current = queue[selectedIdx].operations.map((op) => ({
        ...op,
        region: op.region ? { ...op.region } : null,
      }));
      set((s) => {
        const updated = [...s.queue];
        updated[selectedIdx] = { ...updated[selectedIdx], operations: prev };
        return {
          queue: updated,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, current],
        };
      });
    },

    redo: () => {
      const { redoStack, queue, selectedIdx } = get();
      if (redoStack.length === 0 || selectedIdx < 0) return;
      const next = redoStack[redoStack.length - 1];
      const current = queue[selectedIdx].operations.map((op) => ({
        ...op,
        region: op.region ? { ...op.region } : null,
      }));
      set((s) => {
        const updated = [...s.queue];
        updated[selectedIdx] = { ...updated[selectedIdx], operations: next };
        return {
          queue: updated,
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, current],
        };
      });
    },
  };
}
