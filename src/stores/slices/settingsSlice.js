import { swallow } from "../../utils/swallow.js";
import { migrateThemeSettings } from "../../theme/engine.js";
import { persistThemeSettings } from "./themeSlice.js";

export function createSettingsSlice(set, get) {
  return {
    language: "es",
    recent: [],

    setLanguage: async (language) => {
      const next = language === "en" ? "en" : "es";
      set({ language: next });
      const api = window.api;
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ language: next });
        } catch (e) {
          swallow("saveSettings(language)", e);
        }
      }
    },

    loadSettings: async () => {
      const api = window.api;
      if (!api?.loadSettings) return { ok: false };
      try {
        const settings = await api.loadSettings();
        const migrated = migrateThemeSettings(settings);
        const language = settings?.language === "en" ? "en" : "es";
        const encodeProfile =
          settings?.encodeProfile === "fast" ||
          settings?.encodeProfile === "quality" ||
          settings?.encodeProfile === "uquality"
            ? settings.encodeProfile
            : "balanced";
        const batchWorkers = Number.isFinite(Number(settings?.batchWorkers))
          ? Math.max(0, Math.min(16, Math.floor(Number(settings.batchWorkers))))
          : 0;
        const batchWorkersMode =
          settings?.batchWorkersMode === "conservative" ? "conservative" : "balanced";
        const batchRetryFailed = settings?.batchRetryFailed !== false;

        set({
          themeActiveSlot: migrated.themeActiveSlot,
          themeSlot1: migrated.themeSlot1,
          themeSlot2: migrated.themeSlot2,
          customThemes: migrated.customThemes,
          language,
          encodeProfile,
          batchWorkers,
          batchWorkersMode,
          batchRetryFailed,
        });

        await get().applyActiveTheme();

        get().hydratePetSettings?.(settings);

        if (migrated.needsMigrationSave) {
          await persistThemeSettings({
            theme: migrated.theme,
            themeActiveSlot: migrated.themeActiveSlot,
            themeSlot1: migrated.themeSlot1,
            themeSlot2: migrated.themeSlot2,
            customThemes: migrated.customThemes,
          });
        }

        return { ok: true, settings };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

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
          set({ recent: res.recent.map((r) => ({ ...r, exists: true })) });
        }
      } catch (e) {
        swallow("addRecent", e);
      }
    },

    removeRecent: async (filePath) => {
      const api = window.api;
      if (!api?.removeRecent || !filePath) return;
      try {
        const res = await api.removeRecent(filePath);
        if (res?.success && Array.isArray(res.recent)) {
          set({ recent: res.recent.map((r) => ({ ...r, exists: true })) });
        } else {
          set((s) => ({ recent: s.recent.filter((r) => r.path !== filePath) }));
        }
      } catch (e) {
        swallow("removeRecent", e);
        set((s) => ({ recent: s.recent.filter((r) => r.path !== filePath) }));
      }
    },

    loadProjectFromPath: async (filePath) => {
      const api = window.api;
      if (!api?.loadProjectFromPath)
        return { ok: false, code: "api_unavailable", error: "API no disponible" };
      const res = await api.loadProjectFromPath(filePath);
      if (res.canceled) return { ok: false, canceled: true };
      if (!res.success) {
        if (res.missing) {
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
  };
}
