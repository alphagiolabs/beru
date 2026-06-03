import { createOperation } from "../../utils/types";
import { pickTextStyle } from "../../utils/text-style";
import {
  sanitizeTemplateRegions,
  sanitizeTextStyle,
  sanitizeDefaults,
} from "../../utils/sanitize-preset";

/** Project/preset serialization, persistence, and apply/load helpers. */
export function createProjectSlice(set, get) {
  return {
    presets: [],
    presetsUserDir: null,

    deletePreset: (id) => {
      set((s) => {
        const next = s.presets.filter((p) => p.id !== id);
        try {
          localStorage.setItem("beru-presets", JSON.stringify(next));
        } catch (e) {
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
        try {
          localStorage.removeItem("beru-presets");
        } catch {}
      }
    },

    serializeProject: () => {
      const s = get();
      return {
        type: "beru-project",
        version: "1.2.0",
        savedAt: new Date().toISOString(),
        templateRegions: sanitizeTemplateRegions(s.templateRegions),
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
          ? {
              path: s.excelPath,
              headers: s.excelHeaders,
              rows: s.excelRows,
              mapping: s.excelMapping,
            }
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
      const project = get().serializeProject();
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

    _applyTemplateState: (data) => {
      const textStyle = sanitizeTextStyle(data.textStyle || {});
      const defaults = sanitizeDefaults(data.defaults || {});
      const templateRegions = sanitizeTemplateRegions(data.templateRegions);
      set({
        templateRegions,
        selectedTemplateRegionId: templateRegions[0]?.id ?? null,
        currentRegion: null,
        templateIdx: -1,
        textInput: textStyle.textInput,
        textFontSize: textStyle.textFontSize,
        textFontColor: textStyle.textFontColor,
        fontFamily: textStyle.fontFamily,
        fontWeight: textStyle.fontWeight,
        letterSpacing: textStyle.letterSpacing,
        textAlign: textStyle.textAlign,
        textOpacity: textStyle.textOpacity,
        bold: textStyle.bold,
        italic: textStyle.italic,
        bgEnabled: textStyle.bgEnabled,
        bgColor: textStyle.bgColor,
        bgOpacity: textStyle.bgOpacity,
        boxBorderWidth: textStyle.boxBorderWidth,
        borderWidth: textStyle.borderWidth,
        borderColor: textStyle.borderColor,
        blurStrength: defaults.blurStrength,
        delogoMethod: defaults.delogoMethod,
        delogoFillColor: defaults.delogoFillColor,
        delogoFillOpacity: defaults.delogoFillOpacity,
        temporalRadius: defaults.temporalRadius,
        mosaicSize: defaults.mosaicSize,
        mirrorSide: defaults.mirrorSide,
        edgeFeather: defaults.edgeFeather,
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
          excelMapping:
            excel.mapping && typeof excel.mapping === "object"
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

    applyPreset: (data) => {
      if (!data || (data.type !== "beru-preset" && data.type !== "beru-project")) {
        return { ok: false, error: "Preset inválido" };
      }
      get()._applyTemplateState(data);
      const { excelRows, excelMapping } = get();
      if (excelRows.length > 0 && Object.keys(excelMapping.columns || {}).length > 0) {
        get()._reapplyExcel();
      } else {
        const tr = get().templateRegions;
        set((s) => ({
          queue: s.queue.map((item) => ({
            ...item,
            operations: tr.map((r) =>
              createOperation({
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
              }),
            ),
          })),
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
