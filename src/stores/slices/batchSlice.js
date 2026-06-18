import { createOperation, uid } from "../../utils/types";
import { stripExt, rowGet, isRegionUsable, normalizeMatchId } from "../../utils/video-utils";
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

/** Template regions, Excel import/mapping, and batch table editor state. */
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
      set({
        selectedTemplateRegionId: id,
        ...(style ? patchToGlobalState(style) : {}),
      });
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
      set({ queue: updated });
    },

    importExcel: async (excelPath) => {
      try {
        const api = window.api;
        if (!api?.readExcel) {
          return { success: false, error: "Excel API not available" };
        }

        const result = await api.readExcel(excelPath);
        if (!result || !result.success || result.error) {
          return { success: false, error: result?.error || "Failed to read Excel file" };
        }
        const base64Data = result.data;
        if (!base64Data) {
          return { success: false, error: "Empty Excel file data" };
        }

        // Dynamic import keeps xlsx out of the main bundle — it's only needed
        // when the user actually imports an Excel file.
        const XLSX = await import("xlsx");
        const wb = XLSX.read(base64Data, { type: "base64" });
        const sheetName = wb.SheetNames && wb.SheetNames[0];
        if (!sheetName) return { success: false, error: "Excel file has no sheets" };
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
        if (rows.length === 0) return { success: false, error: "Empty sheet" };

        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

        const idAliases = [
          "id",
          "code",
          "codigo",
          "video",
          "archivo",
          "filename",
          "name",
          "nombre",
          "identificador",
        ];
        const idColumn =
          headers.find((h) => idAliases.includes(h.toLowerCase().trim())) || headers[0] || null;

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

        get()._buildExcelRowIndex();
        const report = get()._reapplyExcel();
        return {
          success: true,
          rowCount: rows.length,
          headers,
          ...report,
          message:
            report.matched === report.total
              ? `Vinculados ${report.matched}/${report.total} videos correctamente`
              : `Vinculados ${report.matched}/${report.total} videos. ${report.unmatched} sin coincidencia, ${report.duplicate} con ID duplicado.`,
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

    _buildExcelRowIndex: () => {
      const { excelRows, excelMapping } = get();
      const { idColumn } = excelMapping;
      if (!idColumn || excelRows.length === 0) {
        set({ excelRowIndexByFilename: {} });
        return;
      }
      const map = {};
      for (let i = 0; i < excelRows.length; i++) {
        const val = rowGet(excelRows[i], idColumn);
        if (val === undefined || val === null) continue;
        const key = normalizeMatchId(val);
        if (key && !(key in map)) map[key] = i;
      }
      set({ excelRowIndexByFilename: map });
    },

    getExcelRowIndexForVideo: (videoIdx) => {
      const { queue, excelMapping, excelRowIndexByFilename } = get();
      const idColumn = excelMapping.idColumn;
      if (!idColumn || videoIdx < 0 || videoIdx >= queue.length) return -1;
      const id = normalizeMatchId(queue[videoIdx].filename);
      if (id in excelRowIndexByFilename) return excelRowIndexByFilename[id];
      // Fallback: linear scan if map stale or missing
      const { excelRows } = get();
      return excelRows.findIndex((row) => {
        const v = rowGet(row, idColumn);
        return v !== undefined && v !== null && normalizeMatchId(v) === id;
      });
    },

    syncTextToExcel: (videoIdx, regionId, text) => {
      const { excelMapping, excelRows } = get();
      if (!excelMapping.idColumn || excelRows.length === 0) return;
      const colName = excelMapping.columns?.[regionId];
      if (!colName) return;
      const rowIdx = get().getExcelRowIndexForVideo(videoIdx);
      if (rowIdx < 0) return;
      const updatedRows = excelRows.map((row, i) =>
        i === rowIdx ? { ...row, [colName]: text } : row,
      );
      set({ excelRows: updatedRows });
      get()._buildExcelRowIndex();
    },

    syncAllOperationsToExcel: () => {
      const { queue, templateRegions, excelMapping, excelRows } = get();
      if (!excelMapping.idColumn || excelRows.length === 0 || templateRegions.length === 0) return;

      const idToRowIdx = new Map();
      excelRows.forEach((row, idx) => {
        const raw = rowGet(row, excelMapping.idColumn);
        if (raw === undefined || raw === null || raw === "") return;
        const key = normalizeMatchId(raw);
        if (!idToRowIdx.has(key)) idToRowIdx.set(key, idx);
      });

      let changed = false;
      const rows = excelRows.map((row) => ({ ...row }));

      queue.forEach((item) => {
        const id = normalizeMatchId(item.filename);
        const rowIdx = idToRowIdx.get(id);
        if (rowIdx === undefined) return;

        templateRegions.forEach((tr) => {
          const colName = excelMapping.columns[tr.id];
          if (!colName) return;
          const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
          const nextText = op?.text ?? "";
          if (String(rows[rowIdx][colName] ?? "") !== nextText) {
            rows[rowIdx] = { ...rows[rowIdx], [colName]: nextText };
            changed = true;
          }
        });
      });

      if (changed) {
        set({ excelRows: rows });
        get()._buildExcelRowIndex();
      }
    },

    getCellTextForRegion: (videoIdx, regionId) => {
      const { queue, templateRegions, excelRows, excelMapping } = get();
      if (videoIdx < 0 || videoIdx >= queue.length) return "";
      const tr = templateRegions.find((r) => r.id === regionId);
      if (!tr) return "";
      const item = queue[videoIdx];
      const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
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

    _reapplyExcel: () => {
      const { queue, excelRows, excelMapping, templateRegions } = get();
      const { idColumn, columns } = excelMapping;

      if (!idColumn || excelRows.length === 0) {
        const status = {};
        queue.forEach((_, i) => {
          status[i] = "unmatched";
        });
        set({ excelMatchStatus: status });
        return { matched: 0, unmatched: queue.length, duplicate: 0, total: queue.length };
      }

      const idToRowIdx = new Map();
      const duplicateIds = new Set();
      excelRows.forEach((row, idx) => {
        const raw = rowGet(row, idColumn);
        if (raw === undefined || raw === null || raw === "") return;
        const key = normalizeMatchId(raw);
        if (idToRowIdx.has(key)) duplicateIds.add(key);
        else idToRowIdx.set(key, idx);
      });

      const status = {};
      let matched = 0;
      let unmatched = 0;
      let duplicate = 0;
      const updated = queue.map((item, i) => {
        const id = normalizeMatchId(item.filename);
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
        const preservedOps = item.operations.filter((op) => {
          if (op.mode !== "text") return true;
          return !templateRegions.some(
            (tr) => tr.region && textOpMatchesRegion(op, tr.region, tr.id),
          );
        });
        const newTextOps = templateRegions.map((tr) => {
          const { op: existingOp } = findTextOpForRegion(item.operations, tr.region, tr.id);
          const colName = columns[tr.id];
          const textVal = colName ? rowGet(row, colName) : undefined;
          const baseStyle =
            existingOp || mergeTextStyles(getGlobalTextStyleFromState(get()), tr.style);
          return createOperation({
            mode: "text",
            batchRegionId: tr.id,
            region: { ...(existingOp?.region || tr.region) },
            text: textVal !== undefined && textVal !== null ? String(textVal) : "",
            ...pickTextStyle(baseStyle),
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
      set({ excelMapping: mapping });
      get()._buildExcelRowIndex();
      get()._reapplyExcel();
    },

    getMatchReport: () => {
      const { excelMatchStatus, queue } = get();
      const matched = Object.values(excelMatchStatus).filter((s) => s === "matched").length;
      const unmatched = Object.values(excelMatchStatus).filter((s) => s === "unmatched").length;
      const duplicate = Object.values(excelMatchStatus).filter((s) => s === "duplicate").length;
      return { matched, unmatched, duplicate, total: queue.length };
    },

    setShowTableEditor: (val) => {
      if (!val && get().showTableEditor) {
        get().materializeBatchTextOps();
        get().syncAllOperationsToExcel();
      }
      set({ showTableEditor: val });
    },

    /**
     * Ensure each template column has a queue text op with the same value shown
     * in the table editor (including Excel-only cells). Removes empty text ops.
     */
    materializeBatchTextOps: () => {
      const { queue, templateRegions } = get();
      if (!templateRegions.length || !queue.length) return;

      const globalStyle = getGlobalTextStyleFromState(get());
      const updated = queue.map((item, videoIdx) => {
        let ops = item.operations.map((op) => ({
          ...op,
          region: op.region ? { ...op.region } : null,
        }));

        for (const tr of templateRegions) {
          const text = String(get().getCellTextForRegion(videoIdx, tr.id) ?? "").trim();
          const { op, opIdx } = findTextOpForRegion(ops, tr.region, tr.id);

          if (text) {
            const baseStyle = mergeTextStyles(globalStyle, tr.style, op || {});
            if (opIdx >= 0) {
              ops[opIdx] = {
                ...ops[opIdx],
                batchRegionId: tr.id,
                text,
                ...pickTextStyle(baseStyle),
              };
            } else {
              ops.push(
                createOperation({
                  mode: "text",
                  batchRegionId: tr.id,
                  region: { ...tr.region },
                  text,
                  ...pickTextStyle(baseStyle),
                }),
              );
            }
          } else if (opIdx >= 0) {
            ops = ops.filter((_, i) => i !== opIdx);
          }
        }

        return { ...item, operations: ops };
      });

      set({ queue: updated });
    },
  };
}
