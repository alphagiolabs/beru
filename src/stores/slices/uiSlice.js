import { canStartDownload, reduceUpdaterEvent } from "../../utils/updateState.js";
import { swallow } from "../../utils/swallow.js";
import {
  applyThemeTokens,
  createCustomTheme,
  deriveWindowChrome,
  duplicateCustomTheme,
  migrateThemeSettings,
  resolveTheme,
  slotToLegacyTheme,
  toCustomThemeRef,
  validateThemeTokens,
} from "../../theme/engine.js";
import { DEFAULT_SLOT1_PRESET, DEFAULT_SLOT2_PRESET } from "../../theme/tokens.js";
import { getPresetById } from "../../theme/presets.js";

async function syncWindowChrome(tokens) {
  const api = window.api;
  if (!api?.setWindowTheme) return;
  try {
    await api.setWindowTheme(deriveWindowChrome(tokens));
  } catch (e) {
    swallow("setWindowTheme", e);
  }
}

async function persistThemeSettings(partial) {
  const api = window.api;
  if (!api?.saveSettings) return;
  try {
    await api.saveSettings(partial);
  } catch (e) {
    swallow("saveSettings(theme)", e);
  }
}

/** Theme, language, toasts, shortcuts, recents, and app updater. */
export function createUiSlice(set, get) {
  return {
    theme: "dark",
    themeActiveSlot: 2,
    themeSlot1: DEFAULT_SLOT1_PRESET,
    themeSlot2: DEFAULT_SLOT2_PRESET,
    customThemes: [],
    activeThemeRef: DEFAULT_SLOT2_PRESET,
    language: "es",
    recent: [],
    update: {
      status: "idle",
      version: null,
      percent: 0,
      error: null,
      transferred: 0,
      total: 0,
      releaseNotes: "",
      releaseUrl: null,
    },

    showShortcuts: false,
    showSettings: false,
    settingsTab: "appearance",
    isDragging: false,
    appToast: null,
    confirmDialog: null,

    showToast: (toast) => set({ appToast: toast }),
    clearAppToast: () => set({ appToast: null }),

    requestConfirm: ({
      title = "",
      message = "",
      confirmLabel,
      cancelLabel,
      variant = "default",
    } = {}) =>
      new Promise((resolve) => {
        const { confirmDialog } = get();
        if (confirmDialog?.resolve) confirmDialog.resolve(false);
        set({
          confirmDialog: {
            title,
            message,
            confirmLabel,
            cancelLabel,
            variant,
            resolve,
          },
        });
      }),

    resolveConfirm: (confirmed) => {
      const { confirmDialog } = get();
      confirmDialog?.resolve?.(!!confirmed);
      set({ confirmDialog: null });
    },

    applyActiveTheme: async () => {
      const { themeActiveSlot, themeSlot1, themeSlot2, customThemes } = get();
      const ref = themeActiveSlot === 1 ? themeSlot1 : themeSlot2;
      const resolved = resolveTheme(ref, customThemes);
      const fallback =
        themeActiveSlot === 1
          ? getPresetById(DEFAULT_SLOT1_PRESET)
          : getPresetById(DEFAULT_SLOT2_PRESET);
      const tokens = resolved?.tokens || fallback?.tokens;
      if (!tokens) return;

      applyThemeTokens(tokens, themeActiveSlot);
      await syncWindowChrome(tokens);

      set({
        activeThemeRef: ref,
        theme: slotToLegacyTheme(themeActiveSlot),
      });
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
          activeThemeRef: migrated.activeThemeRef,
          theme: migrated.theme,
          language,
          encodeProfile,
          batchWorkers,
          batchWorkersMode,
          batchRetryFailed,
        });

        await get().applyActiveTheme();

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

    setThemeActiveSlot: async (slot) => {
      const next = slot === 1 ? 1 : 2;
      set({ themeActiveSlot: next });
      await get().applyActiveTheme();
      await persistThemeSettings({
        themeActiveSlot: next,
        theme: slotToLegacyTheme(next),
      });
    },

    setTheme: async (theme) => {
      const slot = theme === "light" ? 1 : 2;
      return get().setThemeActiveSlot(slot);
    },

    toggleTheme: () => {
      const { themeActiveSlot } = get();
      return get().setThemeActiveSlot(themeActiveSlot === 1 ? 2 : 1);
    },

    assignThemeToSlot: async (slot, themeRef) => {
      const key = slot === 1 ? "themeSlot1" : "themeSlot2";
      const fallback = slot === 1 ? DEFAULT_SLOT1_PRESET : DEFAULT_SLOT2_PRESET;
      const { customThemes } = get();
      const resolved = resolveTheme(themeRef, customThemes);
      const ref = resolved ? themeRef : fallback;

      set({ [key]: ref });
      const { themeActiveSlot } = get();
      if ((slot === 1 && themeActiveSlot === 1) || (slot === 2 && themeActiveSlot === 2)) {
        await get().applyActiveTheme();
      }
      await persistThemeSettings({ [key]: ref });
    },

    saveCustomTheme: async (theme) => {
      const validation = validateThemeTokens(theme?.tokens);
      if (!validation.ok) return { ok: false, error: validation.error };

      const now = new Date().toISOString();
      const entry = {
        id: theme.id || createCustomTheme(theme.name).id,
        name: theme.name?.trim() || "Custom theme",
        tokens: { ...theme.tokens },
        createdAt: theme.createdAt || now,
        updatedAt: now,
      };

      const { customThemes } = get();
      const idx = customThemes.findIndex((c) => c.id === entry.id);
      const nextThemes =
        idx >= 0 ? customThemes.map((c, i) => (i === idx ? entry : c)) : [...customThemes, entry];

      set({ customThemes: nextThemes });
      await persistThemeSettings({ customThemes: nextThemes });

      const ref = toCustomThemeRef(entry.id);
      const { themeSlot1, themeSlot2, themeActiveSlot } = get();
      const activeRef = themeActiveSlot === 1 ? themeSlot1 : themeSlot2;
      if (activeRef === ref) {
        await get().applyActiveTheme();
      }

      return { ok: true, theme: entry, ref };
    },

    deleteCustomTheme: async (id) => {
      const ref = toCustomThemeRef(id);
      let { customThemes, themeSlot1, themeSlot2 } = get();
      customThemes = customThemes.filter((c) => c.id !== id);

      const patch = { customThemes };
      if (themeSlot1 === ref) {
        themeSlot1 = DEFAULT_SLOT1_PRESET;
        patch.themeSlot1 = themeSlot1;
        set({ themeSlot1 });
      }
      if (themeSlot2 === ref) {
        themeSlot2 = DEFAULT_SLOT2_PRESET;
        patch.themeSlot2 = themeSlot2;
        set({ themeSlot2 });
      }

      set({ customThemes });
      await persistThemeSettings(patch);
      await get().applyActiveTheme();
      return { ok: true };
    },

    createCustomThemeFromPreset: async (name, basePresetId) => {
      const theme = createCustomTheme(name, basePresetId);
      const res = await get().saveCustomTheme(theme);
      if (!res.ok) return res;
      return { ok: true, theme: res.theme, ref: toCustomThemeRef(res.theme.id) };
    },

    duplicateThemeAsCustom: async (themeRef) => {
      const { customThemes } = get();
      const dup = duplicateCustomTheme(themeRef, customThemes);
      if (!dup) return { ok: false, error: "Theme not found" };
      const res = await get().saveCustomTheme(dup);
      if (!res.ok) return res;
      return { ok: true, theme: res.theme, ref: toCustomThemeRef(res.theme.id) };
    },

    getResolvedTheme: (themeRef) => {
      const { customThemes } = get();
      return resolveTheme(themeRef, customThemes);
    },

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
      if (!api?.loadProjectFromPath) return { ok: false, error: "API no disponible" };
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

    applyUpdaterEvent: (payload) => {
      set((s) => ({
        update: reduceUpdaterEvent(s.update, payload),
      }));
    },

    checkForUpdates: async () => {
      const api = window.api;
      if (!api?.checkForUpdates) return { ok: false, reason: "no-api" };
      return await api.checkForUpdates();
    },

    downloadUpdate: async () => {
      const api = window.api;
      if (!api?.downloadUpdate) return { ok: false, reason: "no-api" };

      const { update } = get();
      if (update?.status === "downloading" || update?.status === "ready") {
        return { ok: true, reason: "already-in-progress" };
      }
      if (!canStartDownload(update)) {
        return { ok: false, reason: "not-available" };
      }

      set((s) => ({
        update: {
          ...reduceUpdaterEvent(s.update, {
            type: "downloading",
            version: s.update.version,
            percent: 0,
            transferred: 0,
            total: 0,
          }),
          error: null,
        },
      }));

      const res = await api.downloadUpdate();
      if (res?.ok === false) {
        const current = get().update;
        if (current?.status === "downloading" && (current.percent || 0) === 0) {
          set((s) => ({
            update: reduceUpdaterEvent(s.update, {
              type: "available",
              version: s.update.version,
              releaseNotes: s.update.releaseNotes,
              releaseUrl: s.update.releaseUrl,
            }),
          }));
        }
      }
      return res;
    },

    installUpdate: async () => {
      const api = window.api;
      if (!api?.installUpdate) return { ok: false, reason: "no-api" };
      return await api.installUpdate();
    },

    setShowShortcuts: (val) => set({ showShortcuts: val }),
    setShowSettings: (val) => set({ showSettings: val }),
    setSettingsTab: (tab) => set({ settingsTab: tab }),
    setIsDragging: (val) => set({ isDragging: val }),
  };
}
