// ARCHITECTURE NOTE: This slice has cross-slice dependencies on batchSlice.
// Methods like syncTextToExcel, getCellTextForRegion, materializeBatchTextOps,
// and getExcelDisplayId are defined in batchSlice but called from queueSlice
// via get(). This works because all slices merge into a single store, but
// creates implicit coupling. If extracting to separate stores, these calls
// must be refactored to receive the dependencies as parameters.
import {
  createOperation,
  createQueueItem,
  uid,
  denormalizeRegion,
  ensureNormalized,
} from "../../utils/types";
import { clampRegionToVideo, isRegionUsable, stripExt } from "../../utils/video-utils";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { sanitizeOperation } from "../../utils/delogo-ops";
import { buildIdTextOutputName } from "../../utils/batch-process";
import {
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
} from "../../utils/text-style";
import { tStatic } from "../../utils/format-message.js";
import { swallow } from "../../utils/swallow.js";

const MAX_UNDO_STACK = 50;
const IMAGE_DATA_CACHE_MAX = 50;

function pruneImageDataCache(cache, queue) {
  const used = new Set();
  for (const item of queue) {
    for (const op of item.operations || []) {
      if (op.mode === "image" && op.imagePath) used.add(op.imagePath);
    }
  }
  const entries = Object.entries(cache || {}).filter(([path]) => used.has(path));
  if (entries.length > IMAGE_DATA_CACHE_MAX) {
    entries.splice(0, entries.length - IMAGE_DATA_CACHE_MAX);
  }
  const next = {};
  for (const [path, dataUrl] of entries) {
    next[path] = dataUrl;
  }
  return next;
}

/** Desired basename for a queue item (before batch collision suffixes). */
function desiredOutputNameFor(item, get) {
  if (!item) return null;
  const { exportFormat, templateRegions } = get();
  const filename = item.path.split(/[\\/]/).pop();
  const stem = stripExt(filename);
  let outputName = item.customOutputName;
  if (!outputName && templateRegions.length > 0) {
    const videoIdx = get().queue.findIndex((q) => q === item || q.path === item.path);
    const textFor = (region) =>
      videoIdx >= 0 ? String(get().getCellTextForRegion(videoIdx, region.id) ?? "") : "";
    const firstTextRegion =
      templateRegions.find(
        (r) => String(r.label || "").toUpperCase() === "TEXT_1" && textFor(r).trim(),
      ) ||
      templateRegions.find((r) => textFor(r).trim()) ||
      templateRegions.find((r) => String(r.label || "").toUpperCase() === "TEXT_1") ||
      templateRegions[0];
    const id = videoIdx >= 0 ? stripExt(get().getExcelDisplayId(videoIdx)) : stem;
    const text = textFor(firstTextRegion);
    outputName = buildIdTextOutputName(id, text, exportFormat);
  }
  return outputName || `${stem}_beru.${exportFormat}`;
}

/** Video queue, region drawing, per-video operations, and undo/redo. */
export function createQueueSlice(set, get) {
  return {
    queue: [],
    selectedIdx: -1,
    selectedOperationIdx: null,
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

    /* Compute the output file path for a queue item. */
    outputPathFor: (item) => {
      if (!item) return null;
      const { outputDir, queue } = get();
      let outputName = desiredOutputNameFor(item, get);
      // When several queue items share the same basename, keep the first and
      // suffix later ones (__2, __3, ...) so batch export does not overwrite.
      let count = 0;
      let rank = -1;
      for (const q of queue) {
        if (desiredOutputNameFor(q, get) !== outputName) continue;
        if (q === item || q.path === item.path) rank = count;
        count++;
      }
      if (count > 1 && rank > 0) {
        const stem = stripExt(outputName);
        const ext = outputName.slice(stem.length);
        outputName = `${stem}__${rank + 1}${ext}`;
      }
      const outDir = outputDir || item.path.replace(/[\\/][^\\/]*$/, "");
      const base = outDir.replace(/[\\/]+$/, "");
      const sep = base.includes("\\") ? "\\" : "/";
      return `${base}${sep}${outputName}`;
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

    _thumbnailAbortController: null,
    /** Display-only thumbnails keyed by video path — not on queue items (plan 018). */
    thumbnailsByPath: {},

    _scheduleThumbnailLoads: (api, toAdd, startIdx) => {
      if (!api?.getThumbnailBatch || toAdd.length === 0) return;

      const THUMB_CHUNK = 12;
      const MAX_THUMB_BATCHES_IN_FLIGHT = 2;

      const abortController = new AbortController();
      set({ _thumbnailAbortController: abortController });

      const applyThumbResults = (paths, results, offset) => {
        if (abortController.signal.aborted) return;
        if (!Array.isArray(results) || results.length === 0) return;
        set((s) => {
          let changed = false;
          const nextMap = { ...s.thumbnailsByPath };
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const target = offset + i;
            const path = paths[i];
            if (!r?.dataUrl || !path) continue;
            if (!s.queue[target] || s.queue[target].path !== path) continue;
            if (nextMap[path] === r.dataUrl) continue;
            nextMap[path] = r.dataUrl;
            changed = true;
          }
          return changed ? { thumbnailsByPath: nextMap } : s;
        });
      };

      const loadChunk = (paths, offset) => {
        if (abortController.signal.aborted) return;
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
        let nextOff = 0;
        let inFlight = 0;

        const pump = () => {
          if (abortController.signal.aborted) return;
          while (inFlight < MAX_THUMB_BATCHES_IN_FLIGHT && nextOff < rest.length) {
            const off = nextOff;
            nextOff += THUMB_CHUNK;
            const slice = rest.slice(off, off + THUMB_CHUNK);
            const offset = startIdx + firstCount + off;
            inFlight++;
            api
              .getThumbnailBatch(slice)
              .then((results) => applyThumbResults(slice, results, offset))
              .catch(() => {})
              .finally(() => {
                inFlight--;
                pump();
              });
          }
        };

        pump();
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
        .catch((err) => {
          swallow("getVideoInfoBatch", err);
          const lang = get().language;
          get().showToast?.({
            kind: "warn",
            text: tStatic("errors.videoInfoProbeFailed", { count: toAdd.length }, lang),
          });
        });
    },

    /**
     * Prime `imageDataCache` for a path that isn't tied to a queue op yet.
     * Used by the delogo "cover" picker so the live preview can render the
     * chosen image before the user commits the operation.
     */
    cacheImageData: (imagePath, dataUrl) => {
      if (!imagePath || !dataUrl) return;
      set((s) => ({
        imageDataCache: { ...s.imageDataCache, [imagePath]: dataUrl },
      }));
    },

    removeVideo: (idx) => {
      set((s) => {
        const removed = s.queue[idx];
        const next = s.queue.filter((_, i) => i !== idx);
        let sel = s.selectedIdx;
        if (sel >= next.length) sel = next.length - 1;
        else if (sel === idx) sel = Math.min(idx, next.length - 1);
        else if (sel > idx) sel = sel - 1;
        // Rebuild excelMatchStatus with re-indexed keys
        const newStatus = {};
        Object.entries(s.excelMatchStatus).forEach(([k, v]) => {
          const ki = Number(k);
          if (ki < idx) newStatus[ki] = v;
          else if (ki > idx) newStatus[ki - 1] = v;
        });
        let thumbnailsByPath = s.thumbnailsByPath;
        if (removed?.path && thumbnailsByPath?.[removed.path]) {
          thumbnailsByPath = { ...thumbnailsByPath };
          delete thumbnailsByPath[removed.path];
        }
        return {
          queue: next,
          selectedIdx: sel,
          selectedOperationIdx: null,
          currentRegion: null,
          undoStack: [],
          redoStack: [],
          excelMatchStatus: newStatus,
          imageDataCache: pruneImageDataCache(s.imageDataCache, next),
          thumbnailsByPath,
          batchSummary: null,
        };
      });
    },

    clearQueue: () => {
      const { queue, _thumbnailAbortController } = get();
      if (queue.length === 0) return false;
      _thumbnailAbortController?.abort();
      set((s) => ({
        queue: [],
        selectedIdx: -1,
        selectedOperationIdx: null,
        currentRegion: null,
        undoStack: [],
        redoStack: [],
        excelMatchStatus: {},
        imageDataCache: pruneImageDataCache(s.imageDataCache, []),
        batchSummary: null,
        templateIdx: -1,
        _thumbnailAbortController: null,
        thumbnailsByPath: {},
      }));
      return true;
    },

    selectVideo: (idx) => {
      set({
        selectedIdx: idx,
        selectedOperationIdx: null,
        currentRegion: null,
        undoStack: [],
        redoStack: [],
      });
      const api = window.api;
      const item = get().queue[idx];
      if (api?.getThumbnail && item?.path && !get().thumbnailsByPath?.[item.path]) {
        api
          .getThumbnail(item.path)
          .then((r) => {
            if (!r?.dataUrl) return;
            set((s) => {
              if (s.selectedIdx !== idx || !s.queue[idx] || s.queue[idx].path !== item.path) {
                return s;
              }
              if (s.thumbnailsByPath?.[item.path] === r.dataUrl) return s;
              return {
                thumbnailsByPath: { ...s.thumbnailsByPath, [item.path]: r.dataUrl },
              };
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
      const bounds = get().videoBounds();
      const w = bounds?.width || 1920;
      const h = bounds?.height || 1080;
      const isFreshDraw = region.w === 0 && region.h === 0;
      const safe = ensureNormalized(region, w, h);
      const clamped = clampRegionToVideo(safe);
      if (!clamped) return;

      const { sidebarMode, selectedTemplateRegionId } = get();
      if (sidebarMode === "batch" && selectedTemplateRegionId != null) {
        if (isFreshDraw) {
          set({
            selectedTemplateRegionId: null,
            currentRegion: clamped,
            selectedOperationIdx: null,
          });
          return;
        }
        get().updateTemplateRegion(selectedTemplateRegionId, { region: clamped });
        set({ currentRegion: clamped, selectedOperationIdx: null });
        return;
      }

      set({ currentRegion: clamped, selectedOperationIdx: null });
    },

    updateRegionValue: (key, value) => {
      const r = get().currentRegion;
      if (!r) return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const next = clampRegionToVideo({ ...r, [key]: parsed });
      if (!next) return;

      const { sidebarMode, selectedTemplateRegionId } = get();
      if (sidebarMode === "batch" && selectedTemplateRegionId != null) {
        get().updateTemplateRegion(selectedTemplateRegionId, { region: next });
      }
      set({ currentRegion: next });
    },

    /* ── Operations ─────────────────────────────────────────────────── */

    selectOperation: (opIdx) => {
      const { queue, selectedIdx } = get();
      const ops =
        selectedIdx >= 0 && selectedIdx < queue.length ? queue[selectedIdx].operations : [];
      if (opIdx == null || opIdx < 0 || opIdx >= ops.length) {
        set({ selectedOperationIdx: null });
        return;
      }
      set({ selectedOperationIdx: opIdx, currentRegion: null });
    },

    _saveUndo: () => {
      const { queue, selectedIdx, undoStack } = get();
      if (selectedIdx < 0 || selectedIdx >= queue.length) return;
      const ops = queue[selectedIdx].operations.map((op) => ({
        ...op,
        region: op.region ? { ...op.region } : null,
      }));
      set({
        undoStack: [...undoStack.slice(-(MAX_UNDO_STACK - 1)), ops],
        redoStack: [],
      });
    },

    _cloneOps: (ops) =>
      ops.map((op) => ({
        ...op,
        region: op.region ? { ...op.region } : null,
      })),

    addOperation: (mode) => {
      const { queue, selectedIdx, currentRegion } = get();
      if (selectedIdx < 0 || !currentRegion || !isRegionUsable(currentRegion)) return;
      if (mode === "image" && !String(get().tempImagePath ?? "").trim()) return;
      if (mode === "text" && !String(get().textInput ?? "").trim()) return;
      get()._saveUndo();

      const op = sanitizeOperation(
        createOperation({
          mode,
          region: { ...currentRegion },
          blurStrength: get().blurStrength,
          delogoMethod: get().delogoMethod,
          delogoFillColor: get().delogoFillColor,
          delogoFillOpacity: get().delogoFillOpacity,
          delogoImagePath: get().delogoImagePath,
          temporalRadius: get().temporalRadius,
          mosaicSize: get().mosaicSize,
          mirrorSide: get().mirrorSide,
          edgeFeather: get().edgeFeather,
          text: get().textInput,
          ...pickTextStyle(getGlobalTextStyleFromState(get())),
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
      set({
        queue: updated,
        selectedOperationIdx: updated[selectedIdx].operations.length - 1,
        currentRegion: null,
        imageDataCache: newCache,
      });
    },

    removeOperation: (opIdx) => {
      const { selectedIdx } = get();
      if (selectedIdx < 0) return;
      get().removeOperationAt(selectedIdx, opIdx);
    },

    removeOperationAt: (videoIdx, opIdx) => {
      const { queue, selectedIdx } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return;
      const ops = queue[videoIdx].operations;
      if (opIdx < 0 || opIdx >= ops.length) return;
      if (videoIdx === selectedIdx) get()._saveUndo();
      const op = ops[opIdx];
      const regionId = get().findTemplateRegionIdForOp(op);
      const updated = [...queue];
      updated[videoIdx] = {
        ...updated[videoIdx],
        operations: ops.filter((_, i) => i !== opIdx),
      };
      const selectedOperationIdx = get().selectedOperationIdx;
      const nextSelectedOperationIdx =
        videoIdx !== selectedIdx || selectedOperationIdx == null
          ? selectedOperationIdx
          : selectedOperationIdx === opIdx
            ? null
            : selectedOperationIdx > opIdx
              ? selectedOperationIdx - 1
              : selectedOperationIdx;
      set({
        queue: updated,
        selectedOperationIdx: nextSelectedOperationIdx,
        imageDataCache: pruneImageDataCache(get().imageDataCache, updated),
      });
      if (regionId != null && op?.mode === "text") {
        get().syncTextToExcel(videoIdx, regionId, "");
      }
    },

    moveOperation: (fromIdx, toIdx) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      const ops = queue[selectedIdx]?.operations;
      if (!ops || fromIdx < 0 || fromIdx >= ops.length || toIdx < 0 || toIdx > ops.length) return;
      get()._saveUndo();
      const updated = [...queue];
      const nextOps = [...updated[selectedIdx].operations];
      const [moved] = nextOps.splice(fromIdx, 1);
      nextOps.splice(toIdx, 0, moved);
      updated[selectedIdx] = { ...updated[selectedIdx], operations: nextOps };
      const selectedOperationIdx = get().selectedOperationIdx;
      let nextSelectedOperationIdx = selectedOperationIdx;
      if (selectedOperationIdx === fromIdx) {
        nextSelectedOperationIdx = toIdx;
      } else if (
        selectedOperationIdx != null &&
        fromIdx < selectedOperationIdx &&
        toIdx >= selectedOperationIdx
      ) {
        nextSelectedOperationIdx = selectedOperationIdx - 1;
      } else if (
        selectedOperationIdx != null &&
        fromIdx > selectedOperationIdx &&
        toIdx <= selectedOperationIdx
      ) {
        nextSelectedOperationIdx = selectedOperationIdx + 1;
      }
      set({ queue: updated, selectedOperationIdx: nextSelectedOperationIdx });
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
      set({ queue: updated, selectedOperationIdx: opIdx + 1 });
    },

    updateOperationRegion: (opIdx, region, { recordHistory = true } = {}) => {
      const { queue, selectedIdx } = get();
      if (selectedIdx < 0) return;
      // Live drag passes recordHistory:false and snapshots once on pointerdown.
      if (recordHistory) get()._saveUndo();
      const updated = [...queue];
      const ops = [...updated[selectedIdx].operations];
      ops[opIdx] = { ...ops[opIdx], region: { ...region } };
      updated[selectedIdx] = { ...updated[selectedIdx], operations: ops };
      set({ queue: updated });
    },

    updateOperation: (videoIdx, opIdx, patch, { recordHistory = true } = {}) => {
      const { queue, selectedIdx } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return;
      const updated = [...queue];
      const ops = [...updated[videoIdx].operations];
      if (opIdx < 0 || opIdx >= ops.length) return;
      if (recordHistory && videoIdx === selectedIdx) get()._saveUndo();
      const nextOp = { ...ops[opIdx], ...patch };
      ops[opIdx] = nextOp;
      updated[videoIdx] = { ...updated[videoIdx], operations: ops };
      set({ queue: updated });
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        const regionId = get().findTemplateRegionIdForOp(nextOp);
        if (regionId != null) get().syncTextToExcel(videoIdx, regionId, patch.text ?? "");
      }
    },

    updateOperationText: (videoIdx, opIdx, text) => {
      get().updateOperation(videoIdx, opIdx, { text });
    },

    createTextOpForRegion: (videoIdx, regionId) => {
      const { queue, templateRegions } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return -1;
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return -1;
      // Match materializeBatchTextOps / _reapplyExcel: global + template style.
      const style = mergeTextStyles(getGlobalTextStyleFromState(get()), tr.style);
      const op = createOperation({
        mode: "text",
        batchRegionId: tr.id,
        region: { ...tr.region },
        text: "",
        ...pickTextStyle(style),
      });
      if (videoIdx === get().selectedIdx) get()._saveUndo();
      const updated = [...queue];
      updated[videoIdx] = {
        ...updated[videoIdx],
        operations: [...updated[videoIdx].operations, op],
      };
      set({ queue: updated });
      return updated[videoIdx].operations.length - 1;
    },

    /* ── Undo / Redo ────────────────────────────────────────────────── */
    /* DESIGN: Undo/redo is per-video, not global. Switching videos resets the
     * stack (see selectVideo). This is a deliberate trade-off: it keeps the
     * implementation simple and avoids cross-video state confusion, but means
     * users can't undo an operation after switching to another video. A global
     * undo that tracks the affected video index is a future enhancement. */

    undo: () => {
      const { undoStack, queue, selectedIdx } = get();
      if (undoStack.length === 0 || selectedIdx < 0) return;
      const prev = undoStack[undoStack.length - 1];
      const current = get()._cloneOps(queue[selectedIdx].operations);
      set((s) => {
        const updated = [...s.queue];
        updated[selectedIdx] = {
          ...updated[selectedIdx],
          operations: get()._cloneOps(prev),
        };
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
      const current = get()._cloneOps(queue[selectedIdx].operations);
      set((s) => {
        const updated = [...s.queue];
        updated[selectedIdx] = {
          ...updated[selectedIdx],
          operations: get()._cloneOps(next),
        };
        return {
          queue: updated,
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, current],
        };
      });
    },
  };
}
