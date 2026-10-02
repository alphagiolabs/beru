import { reconcileBatchExport, removeLinkedTemplateText } from "../../utils/batch-export.js";
import { createOperation } from "../../utils/operation";
import {
  getGlobalTextStyleFromState,
  persistGlobalTextStyle,
  pickTextStyle,
  regionsMatch,
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

function templateState(data, state) {
  const templateRegions = sanitizeTemplateRegions(data.templateRegions);
  const watermark = restoreWatermark(data.watermark);
  return {
    templateRegions,
    selectedTemplateRegionId: templateRegions[0]?.id ?? null,
    currentRegion: null,
    templateIdx: -1,
    imageDataCache: {},
    ...sanitizeTextStyle(data.textStyle || {}),
    ...sanitizeDefaults(data.defaults || {}),
    ...(watermark ? { watermark: { ...state.watermark, ...watermark } } : {}),
  };
}

export function createProjectSlice(set, get) {
  return {
    presets: [],

    deletePreset: async (preset) => {
      const api = window.api;
      if (!api?.deletePreset)
        return { ok: false, code: "api_unavailable", error: "API no disponible" };
      const p = preset || {};
      const filename = p.filename;
      if (typeof filename !== "string" || !filename.trim()) {
        return { ok: false, code: "preset_no_filename", error: "Preset sin nombre de archivo" };
      }
      const res = await api.deletePreset(filename);
      if (!res.success) return { ok: false, error: res.error };
      if (api.listPresets) {
        try {
          const r = await api.listPresets();
          if (r?.success) set({ presets: r.presets });
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
      if (!api?.saveProject)
        return { ok: false, code: "api_unavailable", error: "API no disponible" };
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
      if (!api?.savePreset)
        return { ok: false, code: "api_unavailable", error: "API no disponible" };
      const cleanName = (name || "").trim();
      if (!cleanName) return { ok: false, code: "empty_preset_name", error: "Nombre vacío" };
      const payload = get().serializePreset();
      const jsonStr = JSON.stringify(payload, null, 2);
      const res = await api.savePreset(cleanName, jsonStr);
      if (!res.success) return { ok: false, error: res.error };
      if (api.listPresets) {
        try {
          const r = await api.listPresets();
          if (r?.success) {
            set({ presets: r.presets });
          }
        } catch (e) {
          swallow("listPresets-after-save", e);
        }
      }
      return { ok: true, fileName: res.fileName, filePath: res.filePath };
    },

    loadProject: async () => {
      const api = window.api;
      if (!api?.loadProject)
        return { ok: false, code: "api_unavailable", error: "API no disponible" };
      const res = await api.loadProject();
      if (res.canceled) return { ok: false, canceled: true };
      if (!res.success) return { ok: false, error: res.error };
      const r = get()._applyProject(res.data);
      if (r.ok) get().addRecent(res.filePath, res.data?.savedAt);
      return { ok: r.ok, error: r.error, filePath: res.filePath, warnings: r.warnings };
    },

    _applyProject: (data) => {
      if (!isProjectOrPreset(data)) {
        return { ok: false, code: "not_project", error: "Archivo no es un proyecto Beru" };
      }
      const warnings = [];
      const excel = data.excel || null;
      set(
        (state) =>
          reconcileBatchExport(
            state,
            {
              ...templateState(data, state),
              excelPath: excel?.path || null,
              excelHeaders: Array.isArray(excel?.headers)
                ? excel.headers.map((h) => String(h))
                : [],
              excelRows: Array.isArray(excel?.rows)
                ? excel.rows.filter((r) => r !== null && typeof r === "object")
                : [],
              excelMapping:
                excel?.mapping && typeof excel.mapping === "object"
                  ? {
                      idColumn: excel.mapping.idColumn ?? null,
                      columns: excel.mapping.columns || {},
                    }
                  : { idColumn: null, columns: {} },
            },
            { applyExcel: Boolean(excel) },
          ).patch,
      );
      if (data.version && !COMPATIBLE_PROJECT_VERSIONS.has(data.version)) {
        warnings.push({
          code: "project_version",
          version: data.version,
          expected: PROJECT_VERSION,
        });
      }
      return { ok: true, warnings };
    },

    applyPreset: (data) => {
      if (!isProjectOrPreset(data)) {
        return { ok: false, code: "invalid_preset", error: "Preset inválido" };
      }
      set((state) => {
        const oldColumns = state.excelMapping?.columns || {};
        const changes = templateState(data, state);
        const templateRegions = changes.templateRegions;
        let columns = oldColumns;
        if (
          templateRegions.some((tr) => !(tr.id in oldColumns)) &&
          Object.keys(oldColumns).length > 0
        ) {
          const remapped = {};
          for (const tr of templateRegions) {
            if (tr.id in oldColumns) {
              remapped[tr.id] = oldColumns[tr.id];
              continue;
            }
            const old = state.templateRegions.find(
              (previous) => previous.region && regionsMatch(previous.region, tr.region),
            );
            if (old && oldColumns[old.id] != null) remapped[tr.id] = oldColumns[old.id];
          }
          if (Object.keys(remapped).length > 0) columns = remapped;
        }
        const queue = state.queue.map((item) => ({
          ...item,
          operations: removeLinkedTemplateText(item.operations, state.templateRegions),
        }));
        const next = {
          ...state,
          ...changes,
          queue,
          excelMapping: { ...state.excelMapping, columns },
        };
        const applyExcel = next.excelRows.length > 0 && Object.keys(columns).length > 0;
        if (!applyExcel) {
          next.queue = queue.map((item) => ({
            ...item,
            operations: [
              ...removeLinkedTemplateText(item.operations, templateRegions),
              ...templateRegions.map((tr) =>
                createOperation({
                  mode: "text",
                  batchRegionId: tr.id,
                  region: { ...tr.region },
                  text: next.textInput || "",
                  ...pickTextStyle(getGlobalTextStyleFromState(next)),
                }),
              ),
            ],
          }));
        }
        return reconcileBatchExport(
          state,
          {
            ...changes,
            queue: next.queue,
            excelMapping: next.excelMapping,
          },
          { applyExcel, preserveManual: true },
        ).patch;
      });
      return { ok: true, name: data.name };
    },

    loadPresets: async () => {
      const api = window.api;
      if (!api?.listPresets)
        return { ok: false, code: "api_unavailable", error: "API no disponible", presets: [] };
      const res = await api.listPresets();
      if (!res.success) {
        set({ presets: [] });
        return { ok: false, error: res.error, presets: [] };
      }
      set({ presets: res.presets });
      return { ok: true, presets: res.presets, userDir: res.userDir };
    },
  };
}
