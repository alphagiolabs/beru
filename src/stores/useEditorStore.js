import { create } from "zustand";
import * as XLSX from "xlsx";
import { createRegion, createOperation, createQueueItem, createPreset, uid, normalizeRegion, denormalizeRegion, ensureNormalized } from "../utils/types";
import { stripExt, rowGet, clampRegionToVideo, isRegionUsable } from "../utils/video-utils";
import { sanitizeOperation } from "../utils/delogo-ops";
import {
  getGlobalTextStyleFromState,
  mergeTextStyles,
  patchToGlobalState,
  pickTextStyle,
  regionsMatch,
} from "../utils/text-style";

const MAX_UNDO_STACK = 50;

const applyThemeToDom = (theme) => {
  if (typeof document === "undefined") return;
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
};

/* ── Editor Store ─────────────────────────────────────────────────────── */

const useEditorStore = create((set, get) => ({
  // Queue
  queue: [],
  selectedIdx: -1,
  activeTool: "blur",
  sidebarMode: "logo",

  // Region being drawn
  currentRegion: null,

  // Text style state
  textInput: "Sample Text",
  textFontSize: 32,
  textFontColor: "white",
  fontFamily: "Arial",
  fontWeight: 400,
  letterSpacing: 0,
  textAlign: "left",
  textOpacity: 1,
  bold: false,
  italic: false,
  bgEnabled: true,
  bgColor: "black",
  bgOpacity: 0.65,
  boxBorderWidth: 4,
  borderWidth: 0,
  borderColor: "black",
  blurStrength: 20,
  delogoMethod: "temporal",
  delogoFillColor: "black",
  delogoFillOpacity: 1,
  temporalRadius: 3,
  mosaicSize: 12,
  mirrorSide: "right",
  edgeFeather: 6,

  // Time range
  tempStart: null,
  tempEnd: null,

  // Image (active when activeTool === "image")
  tempImagePath: "",
  tempImageDataUrl: "",
  tempImageOpacity: 1,
  tempImageScale: 1,
  imageDataCache: {},

  // Processing
  isProcessing: false,
  /** @type {"fast"|"balanced"|"quality"} */
  encodeProfile: "balanced",
  /** 0 = auto (CPU/GPU aware in processor.py) */
  batchWorkers: 0,
  exportFormat: "mp4",
  batchSummary: null,
  progressDone: 0,
  progressTotal: 0,

  // Template / batch
  templateIdx: -1,
  templateRegions: [],
  selectedTemplateRegionId: null,
  nextRegionLabel: 1,

  // Excel data + mapping
  excelPath: null,
  excelHeaders: [],
  excelRows: [],
  excelMapping: { idColumn: null, columns: {} },
  excelMatchStatus: {},

  // Mapping modal
  showMappingModal: false,

  // Output
  outputDir: null,

  // Presets
  presets: [],
  presetsUserDir: null,

  // Theme
  theme: "dark",

  // i18n
  language: "es",

  // Recent projects
  recent: [],

  // Updater
  update: { status: "idle", version: null, percent: 0, error: null },

  // Undo
  undoStack: [],
  redoStack: [],

  // UI
  showShortcuts: false,
  showTableEditor: false,
  isDragging: false,

  // Log
  logLines: [],

  /* ── Computed helpers ────────────────────────────────────────────── */

  selected: () => {
    const { queue, selectedIdx } = get();
    return selectedIdx >= 0 && selectedIdx < queue.length ? queue[selectedIdx] : null;
  },

  videoBounds: () => {
    const s = get().selected();
    return { width: s?.width || 0, height: s?.height || 0 };
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

  addVideos: async (paths, api) => {
    const { queue } = get();
    const existing = new Set(queue.map((q) => q.path));
    const toAdd = paths.filter((p) => !existing.has(p));
    if (toAdd.length === 0) return;

    const infos = api?.getVideoInfoBatch
      ? await api.getVideoInfoBatch(toAdd)
      : await Promise.all(toAdd.map((p) =>
          api?.getVideoInfo
            ? api.getVideoInfo(p)
            : Promise.resolve({ width: 0, height: 0, duration: 0 })
        ));

    const newItems = toAdd.map((p, i) => {
      const filename = p.split(/[\\/]/).pop();
      const info = infos[i] || {};
      return createQueueItem({
        path: p,
        src: `file:///${p.replace(/\\/g, "/")}`,
        filename,
        width: info.width || 0,
        height: info.height || 0,
        duration: info.duration || 0,
        videoCodec: info.videoCodec || "",
        pixFmt: info.pixFmt || "yuv420p",
        frameRate: info.frameRate || 0,
        audioCodec: info.audioCodec || "",
      });
    });
    const startIdx = queue.length;
    set((s) => ({
      queue: [...s.queue, ...newItems],
      selectedIdx: s.selectedIdx < 0 && newItems.length > 0 ? s.queue.length : s.selectedIdx,
    }));

    // Thumbnails: only for the first batch slice + selected video (rest on demand).
    const thumbTargets = toAdd.slice(0, Math.min(12, toAdd.length));
    if (api?.getThumbnailBatch && thumbTargets.length > 0) {
      api.getThumbnailBatch(thumbTargets)
        .then((results) => {
          if (!Array.isArray(results) || results.length === 0) return;
          set((s) => {
            const next = s.queue.slice();
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              const target = startIdx + i;
              if (!r || !r.dataUrl || !next[target]) continue;
              next[target] = { ...next[target], thumbnail: r.dataUrl };
            }
            // Lazy-load remaining thumbnails when idle
            const rest = toAdd.slice(thumbTargets.length);
            if (rest.length > 0 && api.getThumbnailBatch) {
              const runRest = () => {
                api.getThumbnailBatch(rest).then((more) => {
                  if (!Array.isArray(more) || more.length === 0) return;
                  set((s2) => {
                    const n2 = s2.queue.slice();
                    const off = startIdx + thumbTargets.length;
                    for (let j = 0; j < more.length; j++) {
                      const mr = more[j];
                      const t = off + j;
                      if (!mr?.dataUrl || !n2[t]) continue;
                      n2[t] = { ...n2[t], thumbnail: mr.dataUrl };
                    }
                    return { queue: n2 };
                  });
                });
              };
              if (typeof requestIdleCallback === "function") {
                requestIdleCallback(runRest, { timeout: 4000 });
              } else {
                setTimeout(runRest, 500);
              }
            }
            return { queue: next };
          });
        })
        .catch(() => {});
    }
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
      return { queue: next, selectedIdx: sel, excelMatchStatus: newStatus };
    });
  },

  selectVideo: (idx) => {
    set({ selectedIdx: idx, currentRegion: null, undoStack: [], redoStack: [] });
    const api = window.api;
    const item = get().queue[idx];
    if (api?.getThumbnail && item && !item.thumbnail) {
      api.getThumbnail(item.path).then((r) => {
        if (!r?.dataUrl) return;
        set((s) => {
          if (s.selectedIdx !== idx || !s.queue[idx]) return s;
          const next = s.queue.slice();
          next[idx] = { ...next[idx], thumbnail: r.dataUrl };
          return { queue: next };
        });
      }).catch(() => {});
    }
  },

  /* ── Region operations ──────────────────────────────────────────── */
  /* All regions are stored NORMALIZED (0..1) so the same region can be reused
   * across videos of any resolution. */

  setCurrentRegion: (region) => {
    if (!region) { set({ currentRegion: null }); return; }
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

    const op = sanitizeOperation(createOperation({
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
    }));

    const updated = [...queue];
    updated[selectedIdx] = { ...updated[selectedIdx], operations: [...updated[selectedIdx].operations, op] };
    const newCache = { ...get().imageDataCache };
    if (mode === "image" && op.imagePath && get().tempImageDataUrl) {
      newCache[op.imagePath] = get().tempImageDataUrl;
    }
    set({ queue: updated, currentRegion: null, imageDataCache: newCache });
  },

  addTemplateRegion: () => {
    const { currentRegion, templateRegions, nextRegionLabel } = get();
    if (!currentRegion || !isRegionUsable(currentRegion)) return;
    const id = Date.now();
    const style = getGlobalTextStyleFromState(get());
    set({
      templateRegions: [
        ...templateRegions,
        { id, region: { ...currentRegion }, label: `TEXT_${nextRegionLabel}`, style },
      ],
      selectedTemplateRegionId: id,
      nextRegionLabel: nextRegionLabel + 1,
      currentRegion: null,
    });
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
    set({ queue: updated });
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
    updated[selectedIdx] = { ...updated[selectedIdx], operations: [], status: "idle", progress: 0, error: null };
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
    const { queue, templateRegions, textFontSize, textFontColor, fontFamily, fontWeight, letterSpacing, textAlign, textOpacity, bold, italic, bgEnabled, bgColor, bgOpacity, boxBorderWidth, borderWidth, borderColor } = get();
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
    updated[videoIdx] = { ...updated[videoIdx], operations: [...updated[videoIdx].operations, op] };
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

  /* ── Batch / Template ────────────────────────────────────────────── */

  getGlobalTextStyle: () => getGlobalTextStyleFromState(get()),

  getTemplateRegionStyle: (regionId) => {
    const { templateRegions } = get();
    const tr = templateRegions.find((r) => r.id === regionId);
    return mergeTextStyles(getGlobalTextStyleFromState(get()), tr?.style);
  },

  getBatchPreviewText: (videoIdx, regionId) => {
    const text = get().getCellTextForRegion(videoIdx, regionId);
    if (text) return text;
    const tr = get().templateRegions.find((r) => r.id === regionId);
    return tr?.label || "Texto de ejemplo";
  },

  getBatchPreviewPayload: (videoIdx, regionId) => {
    const { queue, templateRegions } = get();
    const tr = templateRegions.find((r) => r.id === regionId);
    if (!tr) return null;
    const globalStyle = getGlobalTextStyleFromState(get());
    const templateStyle = tr.style || {};
    let opStyle = {};
    if (videoIdx >= 0 && videoIdx < queue.length) {
      const op = queue[videoIdx].operations.find(
        (o) => o.mode === "text" && regionsMatch(o.region, tr.region),
      );
      if (op) opStyle = pickTextStyle(op);
    }
    return {
      region: tr.region,
      text: get().getBatchPreviewText(videoIdx, regionId),
      style: mergeTextStyles(globalStyle, templateStyle, opStyle),
    };
  },

  setSelectedTemplateRegion: (id) => {
    const tr = get().templateRegions.find((r) => r.id === id);
    const style = tr?.style ? mergeTextStyles(getGlobalTextStyleFromState(get()), tr.style) : null;
    set({
      selectedTemplateRegionId: id,
      ...(style ? patchToGlobalState(style) : {}),
    });
  },

  patchBatchTextStyle: (patch) => {
    const opPatch = pickTextStyle(patch);
    if (Object.keys(opPatch).length === 0) return;

    const globalPatch = patchToGlobalState(opPatch);
    const { sidebarMode, selectedTemplateRegionId, templateRegions, queue } = get();

    const nextTemplateRegions = sidebarMode === "batch"
      ? templateRegions.map((tr) =>
          selectedTemplateRegionId == null || tr.id === selectedTemplateRegionId
            ? { ...tr, style: mergeTextStyles(tr.style, opPatch) }
            : tr,
        )
      : templateRegions;

    let nextQueue = queue;
    if (sidebarMode === "batch") {
      const targets = selectedTemplateRegionId != null
        ? templateRegions.filter((r) => r.id === selectedTemplateRegionId)
        : templateRegions;
      if (targets.length > 0) {
        nextQueue = queue.map((item) => ({
          ...item,
          operations: item.operations.map((op) => {
            if (op.mode !== "text") return op;
            const tr = targets.find((t) => regionsMatch(op.region, t.region));
            return tr ? { ...op, ...opPatch } : op;
          }),
        }));
      }
    }

    set({
      ...globalPatch,
      templateRegions: nextTemplateRegions,
      queue: nextQueue,
    });
  },

  applyToAll: () => {
    const { queue, selectedIdx } = get();
    if (selectedIdx < 0) return;
    const sourceOps = queue[selectedIdx].operations;
    if (sourceOps.length === 0) return;
    const updated = queue.map((item, i) => {
      if (i === selectedIdx) return item;
      return {
        ...item,
        operations: sourceOps.map((op) => sanitizeOperation({
          ...op,
          id: uid(),
          region: op.region ? { ...op.region } : null,
        })),
        status: item.status === "done" || item.status === "error" ? "idle" : item.status,
        progress: 0,
        error: null,
      };
    });
    set({ queue: updated });
  },

  importExcel: async (excelPath) => {
    try {
      const api = window.api;
      if (!api?.readExcel) {
        return { success: false, error: "Excel API not available" };
      }

      const result = await api.readExcel(excelPath);
      if (!result || result.error) {
        return { success: false, error: result?.error || "Failed to read Excel file" };
      }
      const base64Data = result.data;
      if (!base64Data) {
        return { success: false, error: "Empty Excel file data" };
      }

      const wb = XLSX.read(base64Data, { type: "base64" });
      const sheetName = wb.SheetNames && wb.SheetNames[0];
      if (!sheetName) return { success: false, error: "Excel file has no sheets" };
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      if (rows.length === 0) return { success: false, error: "Empty sheet" };

      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

      // Auto-detect initial mapping
      const idAliases = ["id", "code", "codigo", "video", "archivo", "filename", "name", "nombre", "identificador"];
      const idColumn = headers.find((h) => idAliases.includes(h.toLowerCase().trim())) || headers[0] || null;

      const { templateRegions } = get();
      const columns = {};
      for (const tr of templateRegions) {
        const labelKey = tr.label.toLowerCase().trim();
        const match = headers.find((h) => h.toLowerCase().trim() === labelKey);
        if (match) columns[tr.id] = match;
      }

      set({
        excelPath,
        excelHeaders: headers,
        excelRows: rows,
        excelMapping: { idColumn, columns },
      });

      const report = get()._reapplyExcel();
      return {
        success: true,
        rowCount: rows.length,
        headers,
        ...report,
        message: report.matched === report.total
          ? `Vinculados ${report.matched}/${report.total} videos correctamente`
          : `Vinculados ${report.matched}/${report.total} videos. ${report.unmatched} sin coincidencia, ${report.duplicate} con ID duplicado.`,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /* Match a text operation to its template region id (by normalized coords). */
  findTemplateRegionIdForOp: (op) => {
    if (!op || op.mode !== "text" || !op.region) return null;
    const { templateRegions } = get();
    const tr = templateRegions.find((r) =>
      r.region &&
      Math.abs(r.region.x - op.region.x) < 0.001 &&
      Math.abs(r.region.y - op.region.y) < 0.001
    );
    return tr?.id ?? null;
  },

  /* Row index in excelRows for a queue video (by id column), or -1. */
  getExcelRowIndexForVideo: (videoIdx) => {
    const { queue, excelRows, excelMapping } = get();
    const idColumn = excelMapping.idColumn;
    if (!idColumn || videoIdx < 0 || videoIdx >= queue.length) return -1;
    const id = stripExt(queue[videoIdx].filename).trim().toLowerCase();
    return excelRows.findIndex((row) => {
      const v = rowGet(row, idColumn);
      return v !== undefined && v !== null && String(v).trim().toLowerCase() === id;
    });
  },

  /* Write one cell back to the in-memory Excel row (by region → column mapping). */
  syncTextToExcel: (videoIdx, regionId, text) => {
    const { excelMapping, excelRows } = get();
    if (!excelMapping.idColumn || excelRows.length === 0) return;
    const colName = excelMapping.columns?.[regionId];
    if (!colName) return;
    const rowIdx = get().getExcelRowIndexForVideo(videoIdx);
    if (rowIdx < 0) return;
    const updatedRows = excelRows.map((row, i) =>
      (i === rowIdx ? { ...row, [colName]: text } : row)
    );
    set({ excelRows: updatedRows });
  },

  /* Push all text ops from the queue into excelRows (used when closing table editor). */
  syncAllOperationsToExcel: () => {
    const { queue, templateRegions, excelMapping, excelRows } = get();
    if (!excelMapping.idColumn || excelRows.length === 0 || templateRegions.length === 0) return;

    const idToRowIdx = new Map();
    excelRows.forEach((row, idx) => {
      const raw = rowGet(row, excelMapping.idColumn);
      if (raw === undefined || raw === null || raw === "") return;
      const key = String(raw).trim().toLowerCase();
      if (!idToRowIdx.has(key)) idToRowIdx.set(key, idx);
    });

    let changed = false;
    const rows = excelRows.map((row) => ({ ...row }));

    queue.forEach((item) => {
      const id = stripExt(item.filename).trim().toLowerCase();
      const rowIdx = idToRowIdx.get(id);
      if (rowIdx === undefined) return;

      templateRegions.forEach((tr) => {
        const colName = excelMapping.columns[tr.id];
        if (!colName) return;
        const op = item.operations.find((o) =>
          o.mode === "text" && o.region && tr.region &&
          Math.abs(o.region.x - tr.region.x) < 0.001 &&
          Math.abs(o.region.y - tr.region.y) < 0.001
        );
        const nextText = op?.text ?? "";
        if (String(rows[rowIdx][colName] ?? "") !== nextText) {
          rows[rowIdx] = { ...rows[rowIdx], [colName]: nextText };
          changed = true;
        }
      });
    });

    if (changed) set({ excelRows: rows });
  },

  /* Text shown in table: operation text, else Excel cell for mapped column. */
  getCellTextForRegion: (videoIdx, regionId) => {
    const { queue, templateRegions, excelRows, excelMapping } = get();
    if (videoIdx < 0 || videoIdx >= queue.length) return "";
    const tr = templateRegions.find((r) => r.id === regionId);
    if (!tr) return "";
    const item = queue[videoIdx];
    const op = item.operations.find((o) =>
      o.mode === "text" && o.region && tr.region &&
      Math.abs(o.region.x - tr.region.x) < 0.001 &&
      Math.abs(o.region.y - tr.region.y) < 0.001
    );
    if (op?.text) return op.text;
    const rowIdx = get().getExcelRowIndexForVideo(videoIdx);
    const colName = excelMapping.columns?.[regionId];
    if (rowIdx < 0 || !colName) return "";
    const val = rowGet(excelRows[rowIdx], colName);
    return val !== undefined && val !== null ? String(val) : "";
  },

  getExcelDisplayId: (videoIdx) => {
    const { queue, excelRows, excelMapping } = get();
    if (videoIdx < 0 || videoIdx >= queue.length) return "";
    const fallback = stripExt(queue[videoIdx].filename);
    const rowIdx = get().getExcelRowIndexForVideo(videoIdx);
    if (rowIdx < 0 || !excelMapping.idColumn) return fallback;
    const val = rowGet(excelRows[rowIdx], excelMapping.idColumn);
    return val !== undefined && val !== null ? String(val) : fallback;
  },

  /* Re-apply current excelMapping to the queue. Returns match report. */
  _reapplyExcel: () => {
    const { queue, excelRows, excelMapping, templateRegions, textFontSize, textFontColor, fontFamily, fontWeight, letterSpacing, textAlign, textOpacity, bold, italic, bgEnabled, bgColor, bgOpacity, boxBorderWidth, borderWidth, borderColor } = get();
    const { idColumn, columns } = excelMapping;

    if (!idColumn || excelRows.length === 0) {
      const status = {};
      queue.forEach((_, i) => { status[i] = "unmatched"; });
      set({ excelMatchStatus: status });
      return { matched: 0, unmatched: queue.length, duplicate: 0, total: queue.length };
    }

    // Build ID → row index map, track duplicates
    const idToRowIdx = new Map();
    const duplicateIds = new Set();
    excelRows.forEach((row, idx) => {
      const raw = rowGet(row, idColumn);
      if (raw === undefined || raw === null || raw === "") return;
      const key = String(raw).trim().toLowerCase();
      if (idToRowIdx.has(key)) duplicateIds.add(key);
      else idToRowIdx.set(key, idx);
    });

    const status = {};
    let matched = 0, unmatched = 0, duplicate = 0;
    const updated = queue.map((item, i) => {
      const id = stripExt(item.filename).trim().toLowerCase();
      const rowIdx = idToRowIdx.get(id);
      if (rowIdx === undefined) {
        status[i] = "unmatched";
        unmatched++;
        return { ...item, status: "idle", progress: 0, error: null };
      }
      if (duplicateIds.has(id)) {
        status[i] = "duplicate";
        duplicate++;
        return { ...item, status: "idle", progress: 0, error: null };
      }
      const row = excelRows[rowIdx];
      // Preserve non-text operations (blur, crop, delogo, image) and text
      // operations that don't match any template region.
      const preservedOps = item.operations.filter((op) => {
        if (op.mode !== "text") return true;
        // Keep text ops that don't correspond to any template region
        return !templateRegions.some((tr) =>
          op.region && tr.region &&
          Math.abs(op.region.x - tr.region.x) < 0.001 &&
          Math.abs(op.region.y - tr.region.y) < 0.001
        );
      });
      // Build new text ops from template + Excel data
      const newTextOps = templateRegions.map((tr) => {
        // Check if there's an existing text op for this template region
        // with manually edited styling — preserve its style if so
        const existingOp = item.operations.find((op) =>
          op.mode === "text" && op.region && tr.region &&
          Math.abs(op.region.x - tr.region.x) < 0.001 &&
          Math.abs(op.region.y - tr.region.y) < 0.001
        );
        const colName = columns[tr.id];
        const textVal = colName ? rowGet(row, colName) : undefined;
        const baseStyle = existingOp || mergeTextStyles(
          getGlobalTextStyleFromState(get()),
          tr.style,
        );
        return createOperation({
          mode: "text",
          region: { ...tr.region },
          text: textVal !== undefined && textVal !== null ? String(textVal) : "",
          fontSize: baseStyle.fontSize ?? textFontSize,
          fontColor: baseStyle.fontColor ?? textFontColor,
          fontFamily: baseStyle.fontFamily ?? fontFamily,
          fontWeight: baseStyle.fontWeight,
          letterSpacing: baseStyle.letterSpacing,
          textAlign: baseStyle.textAlign,
          textOpacity: baseStyle.textOpacity,
          bold: baseStyle.bold ?? bold,
          italic: baseStyle.italic ?? italic,
          bgEnabled: baseStyle.bgEnabled ?? bgEnabled,
          bgColor: baseStyle.bgColor ?? bgColor,
          bgOpacity: baseStyle.bgOpacity ?? bgOpacity,
          boxBorderWidth: baseStyle.boxBorderWidth,
          borderWidth: baseStyle.borderWidth ?? borderWidth,
          borderColor: baseStyle.borderColor ?? borderColor,
        });
      });
      const ops = [...preservedOps, ...newTextOps];
      status[i] = "matched";
      matched++;
      return { ...item, operations: ops, status: "idle", progress: 0, error: null };
    });

    set({ queue: updated, excelMatchStatus: status });
    return { matched, unmatched, duplicate, total: queue.length };
  },

  /* ── Presets ────────────────────────────────────────────────────── */

  loadPreset: (preset) => {
    const stylePatch = {
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontColor: preset.fontColor,
      bold: preset.bold,
      italic: preset.italic,
      bgEnabled: preset.bgEnabled,
      bgColor: preset.bgColor,
      bgOpacity: preset.bgOpacity,
      borderWidth: preset.borderWidth,
      borderColor: preset.borderColor,
    };
    if (get().sidebarMode === "batch") {
      get().patchBatchTextStyle(stylePatch);
    } else {
      set(patchToGlobalState(stylePatch));
    }
  },

  deletePreset: (id) => {
    set((s) => {
      const next = s.presets.filter((p) => p.id !== id);
      try { localStorage.setItem("beru-presets", JSON.stringify(next)); } catch (e) {
        console.error("[beru] Failed to persist presets during delete:", e.message);
      }
      return { presets: next };
    });
  },

  loadPresetsFromStorage: () => {
    try {
      const raw = localStorage.getItem("beru-presets");
      if (raw) set({ presets: JSON.parse(raw) });
    } catch (e) {
      console.error("[beru] Failed to load presets from storage:", e.message);
      try { localStorage.removeItem("beru-presets"); } catch {}
    }
  },

  /* ── Settings (theme) ──────────────────────────────────────────── */

  loadSettings: async () => {
    const api = window.api;
    if (!api?.loadSettings) return { ok: false };
    try {
      const settings = await api.loadSettings();
      const theme = settings?.theme === "light" ? "light" : "dark";
      const language = settings?.language === "en" ? "en" : "es";
      const encodeProfile =
        settings?.encodeProfile === "fast" || settings?.encodeProfile === "quality"
          ? settings.encodeProfile
          : "balanced";
      const batchWorkers = Number.isFinite(Number(settings?.batchWorkers))
        ? Math.max(0, Math.min(8, Math.floor(Number(settings.batchWorkers))))
        : 0;
      applyThemeToDom(theme);
      set({ theme, language, encodeProfile, batchWorkers });
      return { ok: true, settings };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  setTheme: async (theme) => {
    const next = theme === "light" ? "light" : "dark";
    applyThemeToDom(next);
    set({ theme: next });
    const api = window.api;
    if (api?.saveSettings) {
      try { await api.saveSettings({ theme: next }); } catch {}
    }
  },

  toggleTheme: () => {
    const cur = get().theme;
    return get().setTheme(cur === "light" ? "dark" : "light");
  },

  setLanguage: async (language) => {
    const next = language === "en" ? "en" : "es";
    set({ language: next });
    const api = window.api;
    if (api?.saveSettings) {
      try { await api.saveSettings({ language: next }); } catch {}
    }
  },

  /* ── Recent projects ──────────────────────────────────────────── */

  loadRecents: async () => {
    const api = window.api;
    if (!api?.listRecent) return [];
    try {
      const list = await api.listRecent();
      if (Array.isArray(list)) set({ recent: list });
      return list || [];
    } catch {
      return [];
    }
  },

  addRecent: async (filePath, name) => {
    const api = window.api;
    if (!api?.addRecent || !filePath) return;
    try {
      const res = await api.addRecent({ path: filePath, name: name || "" });
      if (res?.success && Array.isArray(res.recent)) {
        const decorated = res.recent.map((r) => {
          let exists = true;
          try { exists = api._statExists ? api._statExists(r.path) : true; } catch {}
          return { ...r, exists };
        });
        set({ recent: decorated });
      }
    } catch {}
  },

  removeRecent: async (filePath) => {
    const api = window.api;
    if (!api?.removeRecent || !filePath) return;
    try {
      const res = await api.removeRecent(filePath);
      if (res?.success && Array.isArray(res.recent)) {
        set({ recent: res.recent.map((r) => ({ ...r, exists: true })) });
      } else {
        // Fallback: just remove locally
        set((s) => ({ recent: s.recent.filter((r) => r.path !== filePath) }));
      }
    } catch {
      set((s) => ({ recent: s.recent.filter((r) => r.path !== filePath) }));
    }
  },

  loadProjectFromPath: async (filePath) => {
    const api = window.api;
    if (!api?.loadProjectFromPath) return { ok: false, error: "API no disponible" };
    const res = await api.loadProjectFromPath(filePath);
    if (res.canceled) return { ok: false, canceled: true };
    if (!res.success) {
      if (res.missing) {
        // Auto-prune from recents
        get().removeRecent(filePath);
      }
      return { ok: false, error: res.error };
    }
    const r = get()._applyProject(res.data);
    if (r.ok) {
      get().addRecent(filePath, res.data?.savedAt ? `${res.data.savedAt}` : "");
    }
    return { ok: r.ok, error: r.error, warnings: r.warnings, filePath };
  },

  /* ── Updater ──────────────────────────────────────────────────── */

  applyUpdaterEvent: (payload) => {
    if (!payload || typeof payload !== "object") return;
    const type = payload.type;
    if (type === "checking") {
      set({ update: { status: "checking", version: null, percent: 0, error: null } });
    } else if (type === "available") {
      set({ update: { status: "available", version: payload.version, percent: 0, error: null } });
    } else if (type === "not-available") {
      set({ update: { status: "idle", version: null, percent: 0, error: null } });
    } else if (type === "downloading") {
      set({ update: { status: "downloading", version: null, percent: payload.percent || 0, error: null } });
    } else if (type === "ready") {
      set({ update: { status: "ready", version: payload.version, percent: 100, error: null } });
    } else if (type === "error") {
      set({ update: { status: "error", version: null, percent: 0, error: payload.message || "Error desconocido" } });
    } else if (type === "disabled") {
      set({ update: { status: "disabled", version: null, percent: 0, error: null } });
    }
  },

  checkForUpdates: async () => {
    const api = window.api;
    if (!api?.checkForUpdates) return { ok: false, reason: "no-api" };
    return await api.checkForUpdates();
  },

  downloadUpdate: async () => {
    const api = window.api;
    if (!api?.downloadUpdate) return { ok: false, reason: "no-api" };
    return await api.downloadUpdate();
  },

  installUpdate: () => {
    const api = window.api;
    if (!api?.installUpdate) return;
    api.installUpdate();
  },

  dismissUpdateBanner: () => {
    set({ update: { ...get().update, status: "idle" } });
  },

  /* ── Processing state ──────────────────────────────────────────── */

  appendLog: (line) => set((s) => ({
    logLines: [...s.logLines.slice(-199), line],
  })),

  updateProcessingProgress: (msg) => set({
    progressDone: msg.current || msg.done || 0,
    progressTotal: msg.total || get().progressTotal,
  }),

  updateJobProgress: (msg) => set((s) => {
    const idx = msg.index;
    if (idx < 0 || idx >= s.queue.length) return {};
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
    if (idx < 0 || idx >= s.queue.length) return {};
    const updated = [...s.queue];
    updated[idx] = { ...updated[idx], status: "done", progress: 100, error: null };
    return { queue: updated };
  }),

  markJobError: (msg) => set((s) => {
    const idx = msg.index;
    if (idx < 0 || idx >= s.queue.length) return {};
    const updated = [...s.queue];
    updated[idx] = { ...updated[idx], status: "error", error: msg.error };
    return { queue: updated };
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

  /* Build a single job object for a queue item, ready for FFmpeg. */
  _buildJobFor: (item, index) => {
    if (!item) return null;
    const { encodeProfile, exportFormat } = get();
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

  /* Process a single video. Returns { ok, outputPath } or { ok: false, error }. */
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
      return { ok: !!result?.success, outputPath: job.output_path, error: result?.error };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      set({ isProcessing: false });
    }
  },

  setDelogoMethod: (val) => set({ delogoMethod: val }),
  setDelogoFillColor: (val) => set({ delogoFillColor: val }),
  setDelogoFillOpacity: (val) => set({ delogoFillOpacity: Number(val) }),
  setTemporalRadius: (val) => set({ temporalRadius: Number(val) }),
  setMosaicSize: (val) => set({ mosaicSize: Number(val) }),
  setMirrorSide: (val) => set({ mirrorSide: val }),
  setEdgeFeather: (val) => set({ edgeFeather: Number(val) }),
  setTextInput: (val) => set({ textInput: val }),
  setTextFontSize: (val) => set({ textFontSize: Number(val) }),
  setTextFontColor: (val) => set({ textFontColor: val }),
  setFontFamily: (val) => set({ fontFamily: val }),
  setFontWeight: (val) => set({ fontWeight: Number(val) }),
  setLetterSpacing: (val) => set({ letterSpacing: Number(val) }),
  setTextAlign: (val) => set({ textAlign: val }),
  setTextOpacity: (val) => set({ textOpacity: Number(val) }),
  setBoxBorderWidth: (val) => set({ boxBorderWidth: Number(val) }),
  setBold: (val) => set({ bold: val }),
  setItalic: (val) => set({ italic: val }),
  setBgEnabled: (val) => set({ bgEnabled: val }),
  setBgColor: (val) => set({ bgColor: val }),
  setBgOpacity: (val) => set({ bgOpacity: Number(val) }),
  setBorderWidth: (val) => set({ borderWidth: Number(val) }),
  setBorderColor: (val) => set({ borderColor: val }),
  setBlurStrength: (val) => set({ blurStrength: Number(val) }),
  setTempStart: (val) => set({ tempStart: val === null || val === "" ? null : Number(val) }),
  setTempEnd: (val) => set({ tempEnd: val === null || val === "" ? null : Number(val) }),
  setTempImagePath: (val) => set({ tempImagePath: val || "" }),
  setTempImageDataUrl: (val) => set({ tempImageDataUrl: val || "" }),
  setTempImageOpacity: (val) => set({ tempImageOpacity: Number(val) }),
  setTempImageScale: (val) => set({ tempImageScale: Number(val) }),
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
  setActiveTool: (val) => set({
    activeTool: val,
    currentRegion: null,
    tempImagePath: val === "image" ? get().tempImagePath : "",
    tempImageDataUrl: val === "image" ? get().tempImageDataUrl : "",
  }),
  setSidebarMode: (val) => {
    if (val === "batch") {
      const { templateRegions, selectedTemplateRegionId } = get();
      if (templateRegions.length > 0 && selectedTemplateRegionId == null) {
        get().setSelectedTemplateRegion(templateRegions[0].id);
      }
    }
    set({ sidebarMode: val });
  },
  setShowShortcuts: (val) => set({ showShortcuts: val }),
  setShowTableEditor: (val) => {
    if (!val && get().showTableEditor) {
      get().syncAllOperationsToExcel();
    }
    set({ showTableEditor: val });
  },
  setIsDragging: (val) => set({ isDragging: val }),
  setShowMappingModal: (val) => set({ showMappingModal: val }),

  /* ── Template helpers ───────────────────────────────────────────── */

  removeTemplateRegion: (id) => {
    set((s) => {
      const cols = { ...s.excelMapping.columns };
      delete cols[id];
      const remaining = s.templateRegions.filter((r) => r.id !== id);
      return {
        templateRegions: remaining,
        excelMapping: { ...s.excelMapping, columns: cols },
        selectedTemplateRegionId:
          s.selectedTemplateRegionId === id
            ? (remaining[0]?.id ?? null)
            : s.selectedTemplateRegionId,
      };
    });
  },

  setTemplate: (videoIdx) => set({ templateIdx: videoIdx }),
  setOutputDir: (dir) => set({ outputDir: dir || null }),

  /* ── Excel mapping ───────────────────────────────────────────────── */

  setShowMappingModal: (val) => set({ showMappingModal: val }),

  updateExcelMapping: (mapping) => {
    set({ excelMapping: mapping });
    get()._reapplyExcel();
  },

  clearExcel: () => set({
    excelPath: null,
    excelHeaders: [],
    excelRows: [],
    excelMapping: { idColumn: null, columns: {} },
    excelMatchStatus: {},
  }),

  getMatchReport: () => {
    const { excelMatchStatus, queue } = get();
    const matched = Object.values(excelMatchStatus).filter((s) => s === "matched").length;
    const unmatched = Object.values(excelMatchStatus).filter((s) => s === "unmatched").length;
    const duplicate = Object.values(excelMatchStatus).filter((s) => s === "duplicate").length;
    return { matched, unmatched, duplicate, total: queue.length };
  },

  /* ── Project save / load ──────────────────────────────────────────── */

  /* Capture the template, text style, blur/delogo defaults and Excel config
     into a portable JSON object. Per-video operations are not included; they
     are regenerated from the template + Excel mapping on load. */
  serializeProject: () => {
    const s = get();
    return {
      type: "beru-project",
      version: "1.2.0",
      savedAt: new Date().toISOString(),
      templateRegions: s.templateRegions.map((r) => ({ ...r, region: ensureNormalized(r.region) })),
      textStyle: {
        textInput: s.textInput,
        textFontSize: s.textFontSize,
        textFontColor: s.textFontColor,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        textAlign: s.textAlign,
        textOpacity: s.textOpacity,
        bold: s.bold,
        italic: s.italic,
        bgEnabled: s.bgEnabled,
        bgColor: s.bgColor,
        bgOpacity: s.bgOpacity,
        boxBorderWidth: s.boxBorderWidth,
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
      },
      defaults: {
        blurStrength: s.blurStrength,
        delogoMethod: s.delogoMethod,
        delogoFillColor: s.delogoFillColor,
        delogoFillOpacity: s.delogoFillOpacity,
        temporalRadius: s.temporalRadius,
        mosaicSize: s.mosaicSize,
        mirrorSide: s.mirrorSide,
        edgeFeather: s.edgeFeather,
      },
      excel: s.excelPath
        ? { path: s.excelPath, headers: s.excelHeaders, rows: s.excelRows, mapping: s.excelMapping }
        : null,
    };
  },

  saveProject: async () => {
    const api = window.api;
    if (!api?.saveProject) return { ok: false, error: "API no disponible" };
    const payload = get().serializeProject();
    const res = await api.saveProject(payload);
    if (res.canceled) return { ok: false, canceled: true };
    if (!res.success) return { ok: false, error: res.error };
    get().addRecent(res.filePath, payload.savedAt);
    return { ok: true, filePath: res.filePath };
  },

  serializePreset: () => {
    const s = get();
    const project = s.serializeProject();
    return {
      ...project,
      type: "beru-preset",
      excel: null,
    };
  },

  savePreset: async (name) => {
    const api = window.api;
    if (!api?.savePreset) return { ok: false, error: "API no disponible" };
    const cleanName = (name || "").trim();
    if (!cleanName) return { ok: false, error: "Nombre vacío" };
    const payload = get().serializePreset();
    const jsonStr = JSON.stringify(payload, null, 2);
    const res = await api.savePreset(cleanName, jsonStr);
    if (!res.success) return { ok: false, error: res.error };
    // Refresh the presets list so the new file appears immediately
    if (api.listPresets) {
      try {
        const r = await api.listPresets();
        if (r?.success) {
          set({ presets: r.presets, presetsUserDir: r.userDir });
        }
      } catch {}
    }
    return { ok: true, fileName: res.fileName, filePath: res.filePath };
  },

  loadProject: async () => {
    const api = window.api;
    if (!api?.loadProject) return { ok: false, error: "API no disponible" };
    const res = await api.loadProject();
    if (res.canceled) return { ok: false, canceled: true };
    if (!res.success) return { ok: false, error: res.error };
    const r = get()._applyProject(res.data);
    if (r.ok) get().addRecent(res.filePath, res.data?.savedAt);
    return { ok: r.ok, error: r.error, filePath: res.filePath, warnings: r.warnings };
  },

  /* Apply a project payload to the current state. Validates and silently
     ignores unknown fields. Returns { ok, error?, warnings? }. */
  /* Apply template regions, text style, and tool defaults from a project or
     preset payload. Does not touch Excel state. */
  _applyTemplateState: (data) => {
    const textStyle = data.textStyle || {};
    const defaults = data.defaults || {};
    const templateRegions = Array.isArray(data.templateRegions)
      ? data.templateRegions.map((r) => ({
          id: r.id,
          label: r.label,
          region: ensureNormalized(r.region),
          style: r.style ? pickTextStyle(r.style) : undefined,
        }))
      : [];
    set({
      templateRegions,
      selectedTemplateRegionId: templateRegions[0]?.id ?? null,
      currentRegion: null,
      templateIdx: -1,
      textInput: textStyle.textInput ?? get().textInput,
      textFontSize: textStyle.textFontSize ?? get().textFontSize,
      textFontColor: textStyle.textFontColor ?? get().textFontColor,
      fontFamily: textStyle.fontFamily ?? get().fontFamily,
      fontWeight: textStyle.fontWeight ?? get().fontWeight,
      letterSpacing: textStyle.letterSpacing ?? get().letterSpacing,
      textAlign: textStyle.textAlign ?? get().textAlign,
      textOpacity: textStyle.textOpacity ?? get().textOpacity,
      bold: textStyle.bold ?? get().bold,
      italic: textStyle.italic ?? get().italic,
      bgEnabled: textStyle.bgEnabled ?? get().bgEnabled,
      bgColor: textStyle.bgColor ?? get().bgColor,
      bgOpacity: textStyle.bgOpacity ?? get().bgOpacity,
      boxBorderWidth: textStyle.boxBorderWidth ?? get().boxBorderWidth,
      borderWidth: textStyle.borderWidth ?? get().borderWidth,
      borderColor: textStyle.borderColor ?? get().borderColor,
      blurStrength: defaults.blurStrength ?? get().blurStrength,
      delogoMethod: defaults.delogoMethod ?? get().delogoMethod,
      delogoFillColor: defaults.delogoFillColor ?? get().delogoFillColor,
      delogoFillOpacity: defaults.delogoFillOpacity ?? get().delogoFillOpacity,
      temporalRadius: defaults.temporalRadius ?? get().temporalRadius,
      mosaicSize: defaults.mosaicSize ?? get().mosaicSize,
      mirrorSide: defaults.mirrorSide ?? get().mirrorSide,
      edgeFeather: defaults.edgeFeather ?? get().edgeFeather,
    });
  },

  _applyProject: (data) => {
    if (!data || (data.type !== "beru-project" && data.type !== "beru-preset")) {
      return { ok: false, error: "Archivo no es un proyecto Beru" };
    }
    const warnings = [];
    get()._applyTemplateState(data);
    const excel = data.excel || null;
    if (excel) {
      set({
        excelPath: excel.path || null,
        excelHeaders: Array.isArray(excel.headers) ? excel.headers : [],
        excelRows: Array.isArray(excel.rows) ? excel.rows : [],
        excelMapping: excel.mapping && typeof excel.mapping === "object"
          ? { idColumn: excel.mapping.idColumn ?? null, columns: excel.mapping.columns || {} }
          : { idColumn: null, columns: {} },
      });
      get()._reapplyExcel();
    } else {
      set({
        excelPath: null,
        excelHeaders: [],
        excelRows: [],
        excelMapping: { idColumn: null, columns: {} },
        excelMatchStatus: {},
      });
    }
    if (data.version && data.version !== "1.2.0") {
      warnings.push(`Versión del proyecto: ${data.version} (actual 1.2.0)`);
    }
    return { ok: true, warnings };
  },

  /* Apply a preset payload. Replaces template regions + text style + defaults
     but PRESERVES the current Excel state. If Excel data is loaded, per-video
     operations are regenerated from the new template + the existing mapping. */
  applyPreset: (data) => {
    if (!data || (data.type !== "beru-preset" && data.type !== "beru-project")) {
      return { ok: false, error: "Preset inválido" };
    }
    get()._applyTemplateState(data);
    const { excelRows, excelMapping } = get();
    if (excelRows.length > 0 && Object.keys(excelMapping.columns || {}).length > 0) {
      get()._reapplyExcel();
    } else {
      // No Excel: reset each video's operations to match the new template
      const tr = get().templateRegions;
      set((s) => ({
        queue: s.queue.map((item) => ({
          ...item,
          operations: tr.map((r) => createOperation({
            mode: "text",
            region: { ...r.region },
            text: get().textInput || "",
            fontSize: get().textFontSize,
            fontColor: get().textFontColor,
            fontFamily: get().fontFamily,
            fontWeight: get().fontWeight,
            letterSpacing: get().letterSpacing,
            textAlign: get().textAlign,
            textOpacity: get().textOpacity,
            bold: get().bold,
            italic: get().italic,
            bgEnabled: get().bgEnabled,
            bgColor: get().bgColor,
            bgOpacity: get().bgOpacity,
            boxBorderWidth: get().boxBorderWidth,
            borderWidth: get().borderWidth,
            borderColor: get().borderColor,
          })),
        })),
      }));
    }
    return { ok: true, name: data.name };
  },

  /* Fetch the list of available presets from the main process. Cached in
     state.presets and also returned. */
  loadPresets: async () => {
    const api = window.api;
    if (!api?.listPresets) return { ok: false, error: "API no disponible", presets: [] };
    const res = await api.listPresets();
    if (!res.success) {
      set({ presets: [] });
      return { ok: false, error: res.error, presets: [] };
    }
    set({ presets: res.presets, presetsUserDir: res.userDir || null });
    return { ok: true, presets: res.presets, userDir: res.userDir };
  },
}));

export default useEditorStore;
