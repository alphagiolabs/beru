import { fetchVideoInfos } from "../../utils/video-info.js";
import { createQueueItem, uid, ensureNormalized } from "../../utils/types";
import { createOperation } from "../../utils/operation";
import { clampRegionToVideo, isRegionUsable } from "../../utils/video-utils";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../../utils/video-dimensions";
import { sanitizeOperation } from "../../utils/delogo-ops";
import { resolveDetachedOutputPath, resolveOutputPaths } from "../../utils/output-naming";
import { namingInputs } from "../../utils/export-pipeline.js";
import { reconcileBatchExport } from "../../utils/batch-export.js";
import {
  findTextOpForRegion,
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
} from "../../utils/text-style";
import { tStatic } from "../../utils/format-message.js";
import { swallow } from "../../utils/swallow.js";

const MAX_UNDO_STACK = 50;
const IMAGE_DATA_CACHE_MAX = 50;
const THUMBNAILS_BY_PATH_MAX = 2000;

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

let outputPathsCache = { key: null, paths: null };

const namingContext = (s) => ({
  templateRegions: s.templateRegions,
  exportFormat: s.exportFormat,
  cellText: (videoIdx, regionId) => s.getCellTextForRegion(videoIdx, regionId),
  displayId: (videoIdx) => s.getExcelDisplayId(videoIdx),
});

function resolveOutputPathsForState(s) {
  const key = namingInputs(s);
  const cached = outputPathsCache;
  if (cached.paths && cached.key.every((v, i) => v === key[i])) return cached.paths;
  const paths = resolveOutputPaths(s.queue, s.outputDir, namingContext(s));
  outputPathsCache = { key, paths };
  return paths;
}

export function createQueueSlice(set, get) {
  const priorityThumbnailLoads = new Map();
  const pendingThumbnails = new Map();
  let thumbnailFlushQueued = false;

  const flushPendingThumbnails = () => {
    thumbnailFlushQueued = false;
    if (pendingThumbnails.size === 0) return;
    const batch = [...pendingThumbnails];
    pendingThumbnails.clear();
    set((s) => {
      let changed = false;
      const nextMap = { ...s.thumbnailsByPath };
      const currentPaths = new Set(s.queue.map((item) => item.path));
      for (const [path, dataUrl] of batch) {
        if (!currentPaths.has(path) || nextMap[path] === dataUrl) continue;
        nextMap[path] = dataUrl;
        changed = true;
      }
      if (!changed) return s;
      const keys = Object.keys(nextMap);
      for (let i = 0; i < keys.length - THUMBNAILS_BY_PATH_MAX; i++) {
        delete nextMap[keys[i]];
      }
      return { thumbnailsByPath: nextMap };
    });
  };

  const queueThumbnail = (path, dataUrl) => {
    if (!path || !dataUrl) return;
    pendingThumbnails.set(path, dataUrl);
    if (!thumbnailFlushQueued) {
      thumbnailFlushQueued = true;
      queueMicrotask(flushPendingThumbnails);
    }
  };

  const restoreHistory = (sourceStack, targetStack) => {
    const { [sourceStack]: history, queue, selectedIdx } = get();
    if (history.length === 0 || selectedIdx < 0) return;
    const operations = history[history.length - 1];
    const current = get()._cloneOps(queue[selectedIdx].operations);
    set((s) => {
      const updated = [...s.queue];
      updated[selectedIdx] = {
        ...updated[selectedIdx],
        operations: get()._cloneOps(operations),
      };
      return {
        queue: updated,
        [sourceStack]: s[sourceStack].slice(0, -1),
        [targetStack]: [...s[targetStack], current],
      };
    });
  };

  return {
    queue: [],
    selectedIdx: -1,
    selectedOperationIdx: null,
    currentRegion: null,
    imageDataCache: {},
    undoStack: [],
    redoStack: [],

    selected: () => {
      const { queue, selectedIdx } = get();
      return selectedIdx >= 0 && selectedIdx < queue.length ? queue[selectedIdx] : null;
    },

    videoBounds: () => {
      const s = get().selected();
      return getLockedDimensions(s);
    },

    outputPathFor: (item) => {
      if (!item) return null;
      const s = get();
      const idx = s.queue.indexOf(item);
      if (idx >= 0) return resolveOutputPathsForState(s)[idx];
      return resolveDetachedOutputPath(item, s.queue, s.outputDir, namingContext(s));
    },

    outputPathsForAll: () => resolveOutputPathsForState(get()),

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

    _thumbnailAbortControllers: new Set(),
    thumbnailsByPath: {},

    prioritizeThumbnails: (paths, { interactive = false } = {}, api = window.api) => {
      if (!api?.getThumbnail || !Array.isArray(paths)) return Promise.resolve([]);
      const currentPaths = new Set(get().queue.map((item) => item.path));
      return Promise.all(
        paths
          .filter((path) => currentPaths.has(path))
          .map((path) => {
            if (get().thumbnailsByPath[path] || pendingThumbnails.has(path))
              return Promise.resolve();
            const pending = priorityThumbnailLoads.get(path);
            if (pending && (!interactive || pending.interactive)) return pending.promise;
            const controller = new AbortController();
            const registry = get()._thumbnailAbortControllers;
            registry.add(controller);
            const entry = { interactive };
            entry.promise = api
              .getThumbnail(path, { visible: !interactive })
              .then((result) => {
                if (controller.signal.aborted || !result?.dataUrl) return;
                queueThumbnail(path, result.dataUrl);
              })
              .catch(() => {})
              .finally(() => {
                registry.delete(controller);
                if (priorityThumbnailLoads.get(path) === entry) priorityThumbnailLoads.delete(path);
              });
            priorityThumbnailLoads.set(path, entry);
            return entry.promise;
          }),
      );
    },

    _scheduleThumbnailLoads: (api, toAdd) => {
      if (!api?.getThumbnailBatch || toAdd.length === 0) return;

      const THUMB_CHUNK = 4;
      const MAX_THUMB_BATCHES_IN_FLIGHT = 2;

      const abortController = new AbortController();
      const registry = get()._thumbnailAbortControllers;
      registry?.add(abortController);
      const unregister = () => registry?.delete(abortController);

      const applyThumbResults = (paths, results) => {
        if (abortController.signal.aborted || !Array.isArray(results)) return;
        for (let i = 0; i < results.length; i++) {
          queueThumbnail(paths[i], results[i]?.dataUrl);
        }
      };

      const loadChunk = (paths) => {
        if (abortController.signal.aborted) return Promise.resolve();
        return api
          .getThumbnailBatch(paths)
          .then((results) => applyThumbResults(paths, results))
          .catch(() => {});
      };

      const firstCount = Math.min(4, toAdd.length);
      void get().prioritizeThumbnails(
        [get().queue[get().selectedIdx]?.path],
        { interactive: true },
        api,
      );
      const firstPromise = loadChunk(toAdd.slice(0, firstCount));

      const rest = toAdd.slice(firstCount);
      if (rest.length === 0) {
        firstPromise.then(unregister, unregister);
        return;
      }

      const loadRestInChunks = () =>
        new Promise((resolve) => {
          let nextOff = 0;
          let inFlight = 0;

          const pump = () => {
            if (abortController.signal.aborted) return resolve();
            while (inFlight < MAX_THUMB_BATCHES_IN_FLIGHT && nextOff < rest.length) {
              const off = nextOff;
              nextOff += THUMB_CHUNK;
              const slice = rest.slice(off, off + THUMB_CHUNK);
              inFlight++;
              loadChunk(slice).finally(() => {
                inFlight--;
                if (nextOff >= rest.length && inFlight === 0) return resolve();
                pump();
              });
            }
            if (nextOff >= rest.length && inFlight === 0) resolve();
          };

          pump();
        });

      const restPromise = new Promise((resolve) => {
        const start = () => resolve(loadRestInChunks());
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(start, { timeout: 2000 });
        } else {
          setTimeout(start, 300);
        }
      });

      Promise.all([firstPromise, restPromise]).then(unregister, unregister);
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
      set(
        (s) =>
          reconcileBatchExport(s, {
            queue: [...s.queue, ...newItems],
            selectedIdx: s.selectedIdx < 0 && newItems.length > 0 ? startIdx : s.selectedIdx,
          }).patch,
      );

      get()._scheduleThumbnailLoads(api, toAdd);

      return fetchVideoInfos(api, toAdd)
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
        let thumbnailsByPath = s.thumbnailsByPath;
        if (removed?.path && thumbnailsByPath?.[removed.path]) {
          thumbnailsByPath = { ...thumbnailsByPath };
          delete thumbnailsByPath[removed.path];
        }
        return reconcileBatchExport(s, {
          queue: next,
          selectedIdx: sel,
          selectedOperationIdx: null,
          currentRegion: null,
          undoStack: [],
          redoStack: [],
          imageDataCache: pruneImageDataCache(s.imageDataCache, next),
          thumbnailsByPath,
          batchSummary: null,
        }).patch;
      });
    },

    clearQueue: () => {
      const { queue, _thumbnailAbortControllers } = get();
      if (queue.length === 0) return false;
      for (const controller of _thumbnailAbortControllers ?? []) {
        try {
          controller.abort();
        } catch {}
      }
      priorityThumbnailLoads.clear();
      pendingThumbnails.clear();
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
        _thumbnailAbortControllers: new Set(),
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
      const item = get().queue[idx];
      if (item?.path) void get().prioritizeThumbnails([item.path], { interactive: true });
    },

    setVideoTrim: (videoIdx, start, end, mediaDuration) => {
      set((s) => {
        const item = s.queue[videoIdx];
        if (!item || s.isProcessing) return s;
        const duration = Number(mediaDuration) > 0 ? Number(mediaDuration) : Number(item.duration);
        if (!(duration > 0) || !Number.isFinite(start) || !Number.isFinite(end)) return s;
        const nextStart = Math.max(0, Math.min(start, duration));
        const nextEnd = Math.max(0, Math.min(end, duration));
        if (nextEnd <= nextStart) return s;
        const trimStart = nextStart > 0 ? nextStart : null;
        const trimEnd = nextEnd < duration ? nextEnd : null;
        if (item.trimStart === trimStart && item.trimEnd === trimEnd) return s;
        const queue = [...s.queue];
        queue[videoIdx] = { ...item, duration, trimStart, trimEnd };
        return { queue };
      });
    },

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
      const changes = {
        queue: updated,
        selectedOperationIdx: nextSelectedOperationIdx,
        imageDataCache: pruneImageDataCache(get().imageDataCache, updated),
      };
      if (regionId != null && op?.mode === "text") {
        get().syncTextToExcel(videoIdx, regionId, "", changes);
      } else set(changes);
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
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        const regionId = get().findTemplateRegionIdForOp(nextOp);
        if (regionId != null) {
          get().syncTextToExcel(videoIdx, regionId, patch.text ?? "", { queue: updated });
          return;
        }
      }
      set({ queue: updated });
    },

    updateOperationText: (videoIdx, opIdx, text) => {
      get().updateOperation(videoIdx, opIdx, { text });
    },

    createTextOpForRegion: (videoIdx, regionId, text = "") => {
      const { queue, templateRegions } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return -1;
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return -1;
      const style = mergeTextStyles(getGlobalTextStyleFromState(get()), tr.style);
      const op = createOperation({
        mode: "text",
        batchRegionId: tr.id,
        region: { ...tr.region },
        text,
        ...pickTextStyle(style),
      });
      if (videoIdx === get().selectedIdx) get()._saveUndo();
      const updated = [...queue];
      updated[videoIdx] = {
        ...updated[videoIdx],
        operations: [...updated[videoIdx].operations, op],
      };
      get().syncTextToExcel(videoIdx, regionId, text, { queue: updated });
      return updated[videoIdx].operations.length - 1;
    },

    setTextForRegion: (videoIdx, regionId, text) => {
      const { queue, templateRegions } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return -1;
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return -1;
      const { op, opIdx } = findTextOpForRegion(queue[videoIdx].operations, tr.region, tr.id);
      const materialize = text === undefined;
      const nextText = materialize
        ? String(get().getCellTextForRegion(videoIdx, regionId) ?? "")
        : String(text ?? "");
      if (op) {
        if (!materialize && String(op.text ?? "") !== nextText) {
          get().updateOperationText(videoIdx, opIdx, nextText);
        }
        return opIdx;
      }
      if (!materialize && nextText === "") {
        get().syncTextToExcel(videoIdx, regionId, "");
        return -1;
      }
      return get().createTextOpForRegion(videoIdx, regionId, nextText);
    },

    undo: () => restoreHistory("undoStack", "redoStack"),
    redo: () => restoreHistory("redoStack", "undoStack"),
  };
}
