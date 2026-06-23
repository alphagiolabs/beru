import { canStartDownload, reduceUpdaterEvent } from "../../utils/updateState.js";
import { swallow } from "../../utils/swallow.js";

function applyThemeToDom(theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

/** Theme, language, toasts, shortcuts, recents, and app updater. */
export function createUiSlice(set, get) {
  return {
    theme: "dark",
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

    loadSettings: async () => {
      const api = window.api;
      if (!api?.loadSettings) return { ok: false };
      try {
        const settings = await api.loadSettings();
        const theme = settings?.theme === "light" ? "light" : "dark";
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
        applyThemeToDom(theme);
        if (api?.setWindowTheme) {
          try {
            await api.setWindowTheme(theme);
          } catch (e) {
            swallow("setWindowTheme", e);
          }
        }
        set({
          theme,
          language,
          encodeProfile,
          batchWorkers,
          batchWorkersMode,
          batchRetryFailed,
        });
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
      if (api?.setWindowTheme) {
        try {
          await api.setWindowTheme(next);
        } catch (e) {
          swallow("setWindowTheme", e);
        }
      }
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ theme: next });
        } catch (e) {
          swallow("saveSettings(theme)", e);
        }
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
          // The path was just picked/added, so it exists. listRecent re-checks
          // server-side on next load via recent:list.
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
    setIsDragging: (val) => set({ isDragging: val }),
  };
}
