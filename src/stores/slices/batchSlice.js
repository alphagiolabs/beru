import { uid, ID_COLUMN_ALIASES } from "../../utils/types";
import {
  reconcileBatchExport,
  batchExcelRowIndex,
  syncBatchTextToExcel,
  syncBatchOperationsToExcel,
} from "../../utils/batch-export.js";
import { stripExt, rowGet, isRegionUsable, formatMatchIdRaw } from "../../utils/video-utils";
import { sanitizeOperation } from "../../utils/delogo-ops";
import {
  getGlobalTextStyleFromState,
  mergeTextStyles,
  patchToGlobalState,
  pickTextStyle,
  regionsMatch,
  findTextOpForRegion,
  textOpMatchesRegion,
} from "../../utils/text-style";
import { applyBatchTextOperations } from "../../utils/batch-text-ops";

function materializedQueue(state) {
  const { queue, templateRegions } = state;
  if (!templateRegions.length || !queue.length) return queue;
  const globalStyle = getGlobalTextStyleFromState(state);
  return queue.map((item, videoIdx) => ({
    ...item,
    operations: applyBatchTextOperations(
      item,
      templateRegions,
      globalStyle,
      (idx, regionId) => state.getCellTextForRegion(idx, regionId),
      videoIdx,
    ),
  }));
}

export function createBatchSlice(set, get) {
  return {
    templateIdx: -1,
    templateRegions: [],
    selectedTemplateRegionId: null,
    nextRegionLabel: 1,

    excelPath: null,
    excelHeaders: [],
    excelRows: [],
    excelMapping: { idColumn: null, columns: {} },
    excelMatchStatus: {},
    excelRowIndexByFilename: {},

    showMappingModal: false,
    showTableEditor: false,

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

    getBatchPreviewText: (videoIdx, regionId) => {
      const { queue, templateRegions } = get();
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return "Texto de ejemplo";

      if (videoIdx >= 0 && videoIdx < queue.length) {
        const { op } = findTextOpForRegion(queue[videoIdx].operations, tr.region, tr.id);
        if (op) return op.text != null ? String(op.text) : "";
      }

      const text = get().getCellTextForRegion(videoIdx, regionId);
      if (String(text ?? "").trim()) return String(text);
      return tr.label || "Texto de ejemplo";
    },

    getBatchPreviewPayload: (videoIdx, regionId) => {
      const { queue, templateRegions } = get();
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return null;
      const globalStyle = getGlobalTextStyleFromState(get());
      const templateStyle = tr.style || {};
      let opStyle = {};
      let region = tr.region;
      if (videoIdx >= 0 && videoIdx < queue.length) {
        const { op } = findTextOpForRegion(queue[videoIdx].operations, tr.region, tr.id);
        if (op) {
          opStyle = pickTextStyle(op);
          region = op.region || tr.region;
        }
      }
      return {
        region,
        text: get().getBatchPreviewText(videoIdx, regionId),
        style: mergeTextStyles(globalStyle, templateStyle, opStyle),
      };
    },

    setSelectedTemplateRegion: (id) => {
      const tr = get().templateRegions.find((r) => r.id === id);
      const style = tr?.style
        ? mergeTextStyles(getGlobalTextStyleFromState(get()), tr.style)
        : null;
      let region = tr?.region ? { ...tr.region } : null;
      const { queue, selectedIdx } = get();
      if (region && selectedIdx >= 0 && selectedIdx < queue.length) {
        const { op } = findTextOpForRegion(queue[selectedIdx].operations, tr.region, tr.id);
        if (op?.region) region = { ...op.region };
      }
      set({
        selectedTemplateRegionId: id,
        currentRegion: region,
        ...(style ? patchToGlobalState(style) : {}),
      });
    },

    cancelBatchRegionSelection: () => {
      set({ currentRegion: null, selectedTemplateRegionId: null });
    },

    updateTemplateRegion: (id, patch) => {
      const target = get().templateRegions.find((r) => r.id === id);
      if (!target) return;
      const nextRegion = patch.region || target.region;
      const stylePatch = pickTextStyle(patch);
      const hasStylePatch = Object.keys(stylePatch).length > 0;

      set((s) => ({
        templateRegions: s.templateRegions.map((tr) =>
          tr.id === id
            ? {
                ...tr,
                region: nextRegion,
                style: hasStylePatch ? mergeTextStyles(tr.style, stylePatch) : tr.style,
              }
            : tr,
        ),
        queue: patch.region
          ? s.queue.map((item) => ({
              ...item,
              operations: item.operations.map((op) =>
                textOpMatchesRegion(op, target.region, target.id)
                  ? { ...op, region: { ...nextRegion } }
                  : op,
              ),
            }))
          : s.queue,
      }));

      if (hasStylePatch) get().patchBatchTextStyle(stylePatch);
    },

    patchBatchTextStyle: (patch) => {
      const opPatch = pickTextStyle(patch);
      if (Object.keys(opPatch).length === 0) return;

      const globalPatch = patchToGlobalState(opPatch);
      const { sidebarMode, selectedTemplateRegionId, templateRegions, queue } = get();

      const nextTemplateRegions =
        sidebarMode === "batch"
          ? templateRegions.map((tr) =>
              selectedTemplateRegionId == null || tr.id === selectedTemplateRegionId
                ? { ...tr, style: mergeTextStyles(tr.style, opPatch) }
                : tr,
            )
          : templateRegions;

      let nextQueue = queue;
      if (sidebarMode === "batch") {
        const targets =
          selectedTemplateRegionId != null
            ? templateRegions.filter((r) => r.id === selectedTemplateRegionId)
            : templateRegions;
        if (targets.length > 0) {
          nextQueue = queue.map((item) => ({
            ...item,
            operations: item.operations.map((op) => {
              if (op.mode !== "text") return op;
              const tr = targets.find((t) => textOpMatchesRegion(op, t.region, t.id));
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
          operations: sourceOps.map((op) =>
            sanitizeOperation({
              ...op,
              id: uid(),
              region: op.region ? { ...op.region } : null,
            }),
          ),
          status: item.status === "done" || item.status === "error" ? "idle" : item.status,
          progress: 0,
          error: null,
        };
      });
      set((state) => reconcileBatchExport(state, { queue: updated }, { applyExcel: true }).patch);
    },

    exportExcel: async () => {
      try {
        const api = window.api;
        if (!api?.saveExcelDialog || !api?.writeExcel) {
          return { ok: false, code: "excel_api_unavailable", error: "Excel API not available" };
        }
        const { excelHeaders, excelRows, excelPath } = get();
        if (!Array.isArray(excelRows) || excelRows.length === 0) {
          return { ok: false, code: "excel_no_rows", error: "No Excel rows to export" };
        }
        const defaultName = excelPath
          ? String(excelPath)
              .split(/[\\/]/)
              .pop()
              .replace(/\.(xlsx|xls)$/i, "") + "-export.xlsx"
          : "beru-export.xlsx";
        const pick = await api.saveExcelDialog(defaultName);
        if (pick?.canceled || !pick?.filePath) return { ok: false, canceled: true };

        const XLSX = await import("xlsx");
        const headers =
          Array.isArray(excelHeaders) && excelHeaders.length > 0
            ? excelHeaders
            : Object.keys(excelRows[0] || {});
        const sheetRows = excelRows.map((row) => {
          const out = {};
          for (const h of headers) {
            out[h] = row?.[h] ?? "";
          }
          for (const k of Object.keys(row || {})) {
            if (!(k in out)) out[k] = row[k];
          }
          return out;
        });
        const ws = XLSX.utils.json_to_sheet(sheetRows, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
        const res = await api.writeExcel(pick.filePath, base64);
        if (!res?.success)
          return { ok: false, code: "excel_write_failed", error: res?.error || "Write failed" };
        return { ok: true, filePath: res.filePath || pick.filePath };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },

    importExcel: async (excelPath) => {
      try {
        const api = window.api;
        if (!api?.readExcel) {
          return {
            success: false,
            code: "excel_api_unavailable",
            error: "Excel API not available",
          };
        }

        const result = await api.readExcel(excelPath);
        if (!result || !result.success || result.error) {
          return {
            success: false,
            code: "excel_read_failed",
            error: result?.error || "Failed to read Excel file",
          };
        }
        const { rows, headers } = result;

        const idColumn =
          headers.find((h) => ID_COLUMN_ALIASES.includes(h.toLowerCase().trim())) ||
          headers[0] ||
          null;

        const { templateRegions } = get();
        const columns = {};
        for (const tr of templateRegions) {
          const labelKey = tr.label.toLowerCase().trim();
          const match = headers.find((h) => h.toLowerCase().trim() === labelKey);
          if (match) columns[tr.id] = match;
        }

        const { patch, report } = reconcileBatchExport(
          get(),
          {
            excelPath,
            excelHeaders: headers,
            excelRows: rows,
            excelMapping: { idColumn, columns },
          },
          { applyExcel: true },
        );
        set(patch);
        return {
          success: true,
          rowCount: rows.length,
          headers,
          ...report,
          messageKey:
            report.matched === report.total ? "batch.excelLinkedOk" : "batch.excelLinkedPartial",
          messageVars: {
            matched: report.matched,
            total: report.total,
            unmatched: report.unmatched,
            duplicate: report.duplicate,
          },
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    findTemplateRegionIdForOp: (op) => {
      if (!op || op.mode !== "text") return null;
      const { templateRegions } = get();
      const linked =
        op.batchRegionId != null
          ? templateRegions.find((r) => String(r.id) === String(op.batchRegionId))
          : null;
      const tr =
        linked || templateRegions.find((r) => r.region && regionsMatch(r.region, op.region));
      return tr?.id ?? null;
    },

    getExcelRowIndexForVideo: (videoIdx) => batchExcelRowIndex(get(), videoIdx),

    syncTextToExcel: (videoIdx, regionId, text, changes = {}) => {
      const patch = syncBatchTextToExcel(get(), videoIdx, regionId, text, changes);
      if (Object.keys(patch).length > 0) set(patch);
    },

    getCellTextForRegion: (videoIdx, regionId) => {
      const { queue, templateRegions, excelRows, excelMapping } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return "";
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return "";
      const item = queue[videoIdx];
      const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
      if (op) return op.text != null ? String(op.text) : "";
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
      return val !== undefined && val !== null ? formatMatchIdRaw(val) : fallback;
    },

    removeTemplateRegion: (id) => {
      set((s) => {
        const removed = s.templateRegions.find((r) => r.id === id);
        const cols = { ...s.excelMapping.columns };
        delete cols[id];
        const remaining = s.templateRegions.filter((r) => r.id !== id);
        return {
          templateRegions: remaining,
          queue: removed
            ? s.queue.map((item) => ({
                ...item,
                operations: item.operations.filter(
                  (op) => !textOpMatchesRegion(op, removed.region, removed.id),
                ),
              }))
            : s.queue,
          excelMapping: { ...s.excelMapping, columns: cols },
          selectedTemplateRegionId:
            s.selectedTemplateRegionId === id
              ? (remaining[0]?.id ?? null)
              : s.selectedTemplateRegionId,
        };
      });
    },

    setTemplate: (videoIdx) => set({ templateIdx: videoIdx }),

    setShowMappingModal: (val) => set({ showMappingModal: val }),

    updateExcelMapping: (mapping) => {
      set(
        (state) =>
          reconcileBatchExport(state, { excelMapping: mapping }, { applyExcel: true }).patch,
      );
    },

    setShowTableEditor: (val) => {
      const state = get();
      if (!val && state.showTableEditor) {
        const queue = materializedQueue(state);
        set({ queue, ...syncBatchOperationsToExcel({ ...state, queue }), showTableEditor: val });
      } else set({ showTableEditor: val });
    },

    materializeBatchTextOps: () => {
      const state = get();
      const queue = materializedQueue(state);
      if (queue !== state.queue) set({ queue });
    },
  };
}
