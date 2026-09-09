import { createOperation } from "../../utils/operation";
import {
  getGlobalTextStyleFromState,
  persistGlobalTextStyle,
  pickTextStyle,
  regionsMatch,
  textOpMatchesRegion,
} from "../../utils/text-style";
import {
  sanitizeTemplateRegions,
  sanitizeTextStyle,
  sanitizeDefaults,
  persistWatermark,
  restoreWatermark,
} from "../../utils/sanitize-preset";
import {
  COMPATIBLE_PROJECT_VERSIONS,
  PRESET_TYPE,
  PROJECT_TYPE,
  PROJECT_VERSION,
  isProjectOrPreset,
} from "../../../shared/project-document.js";
import { swallow } from "../../utils/swallow.js";

export function createProjectSlice(set, get) {
  return {
    presets: [],
    presetsUserDir: null,

    deletePreset: async (preset) => {
      const api = window.api;
      if (!api?.deletePreset) return { ok: false, error: "API no disponible" };
      const p = preset || {};
      if (p.source === "bundled") {
        return { ok: false, error: "Los presets incluidos no se pueden eliminar" };
      }
      const filename = p.filename;
      if (typeof filename !== "string" || !filename.trim()) {
        return { ok: false, error: "Preset sin nombre de archivo" };
      }
      const res = await api.deletePreset(filename);
      if (!res.success) return { ok: false, error: res.error };
      if (api.listPresets) {
        try {
          const r = await api.listPresets();
          if (r?.success) set({ presets: r.presets, presetsUserDir: r.userDir });
        } catch (e) {
          swallow("listPresets-after-delete", e);
        }
      } else {
        set((s) => ({ presets: s.presets.filter((x) => x.filename !== filename) }));
      }
      return { ok: true, fileName: res.fileName };
    },

    loadPresetsFromStorage: () => {
      try {
        const raw = localStorage.getItem("beru-presets");
        if (!raw) return;
        localStorage.removeItem("beru-presets");
        if ((get().presets || []).length > 0) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) set({ presets: parsed });
      } catch (e) {
        swallow("beru-presets-migrate", e);
        try {
          localStorage.removeItem("beru-presets");
        } catch (err) {
          swallow("localStorage.removeItem", err);
        }
      }
    },

    serializeProject: () => {
      const s = get();
      const wm = s.watermark || {};
      return {
        type: PROJECT_TYPE,
        version: PROJECT_VERSION,
        savedAt: new Date().toISOString(),
        templateRegions: sanitizeTemplateRegions(s.templateRegions),
        textStyle: persistGlobalTextStyle(s),
        defaults: sanitizeDefaults(s),
        excel: s.excelPath
          ? {
              path: s.excelPath,
              headers: s.excelHeaders,
              rows: s.excelRows,
              mapping: s.excelMapping,
            }
          : null,
        watermark: persistWatermark(wm),
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
      const project = get().serializeProject();
      return {
        ...project,
        type: PRESET_TYPE,
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
      if (api.listPresets) {
        try {
          const r = await api.listPresets();
          if (r?.success) {
            set({ presets: r.presets, presetsUserDir: r.userDir });
          }
        } catch (e) {
          swallow("listPresets-after-save", e);
        }
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

    _applyTemplateState: (data) => {
      const textStyle = sanitizeTextStyle(data.textStyle || {});
      const defaults = sanitizeDefaults(data.defaults || {});
      const templateRegions = sanitizeTemplateRegions(data.templateRegions);
      set({
        templateRegions,
        selectedTemplateRegionId: templateRegions[0]?.id ?? null,
        currentRegion: null,
        templateIdx: -1,
        imageDataCache: {},
        ...textStyle,
        ...defaults,
      });
    },

    _applyProject: (data) => {
      if (!isProjectOrPreset(data)) {
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
          excelMapping:
            excel.mapping && typeof excel.mapping === "object"
              ? { idColumn: excel.mapping.idColumn ?? null, columns: excel.mapping.columns || {} }
              : { idColumn: null, columns: {} },
        });
        get()._buildExcelRowIndex();
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
      const watermark = restoreWatermark(data.watermark);
      if (watermark) get().setWatermark(watermark);
      if (data.version && !COMPATIBLE_PROJECT_VERSIONS.has(data.version)) {
        warnings.push(`Versión del proyecto: ${data.version} (actual ${PROJECT_VERSION})`);
      }
      return { ok: true, warnings };
    },

    applyPreset: (data) => {
      if (!isProjectOrPreset(data)) {
        return { ok: false, error: "Preset inválido" };
      }
      const oldTemplateRegions = get().templateRegions;
      const oldColumns = get().excelMapping?.columns || {};

      get()._applyTemplateState(data);

      const newTemplateRegions = get().templateRegions;
      const needsRemap = newTemplateRegions.some((tr) => !(tr.id in oldColumns));
      if (needsRemap && Object.keys(oldColumns).length > 0) {
        const newColumns = {};
        for (const newTr of newTemplateRegions) {
          if (newTr.id in oldColumns) {
            newColumns[newTr.id] = oldColumns[newTr.id];
            continue;
          }
          const oldMatch = oldTemplateRegions.find(
            (oldTr) => oldTr.region && regionsMatch(oldTr.region, newTr.region),
          );
          if (oldMatch && oldColumns[oldMatch.id] != null) {
            newColumns[newTr.id] = oldColumns[oldMatch.id];
          }
        }
        if (Object.keys(newColumns).length > 0) {
          set((s) => ({
            excelMapping: { ...s.excelMapping, columns: newColumns },
          }));
        }
      }

      const { excelRows, excelMapping } = get();
      if (excelRows.length > 0 && Object.keys(excelMapping.columns || {}).length > 0) {
        get()._reapplyExcel();
      } else {
        const tr = get().templateRegions;
        set((s) => ({
          queue: s.queue.map((item) => {
            const preservedOps = item.operations.filter((op) => {
              if (op.mode !== "text") return true;
              return !tr.some((r) => r.region && textOpMatchesRegion(op, r.region, r.id));
            });
            const newTextOps = tr.map((r) =>
              createOperation({
                mode: "text",
                batchRegionId: r.id,
                region: { ...r.region },
                text: get().textInput || "",
                ...pickTextStyle(getGlobalTextStyleFromState(get())),
              }),
            );
            return {
              ...item,
              operations: [...preservedOps, ...newTextOps],
            };
          }),
        }));
      }
      return { ok: true, name: data.name };
    },

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
  };
}
