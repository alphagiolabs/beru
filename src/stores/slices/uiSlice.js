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
    isDragging: false,
    appToast: null,

    showToast: (toast) => set({ appToast: toast }),
    clearAppToast: () => set({ appToast: null }),

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
          ? Math.max(0, Math.min(16, Math.floor(Number(settings.batchWorkers))))
          : 0;
        const batchWorkersMode =
          settings?.batchWorkersMode === "conservative" ? "conservative" : "balanced";
        const batchRetryFailed = settings?.batchRetryFailed !== false;
        applyThemeToDom(theme);
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
      if (api?.saveSettings) {
        try {
          await api.saveSettings({ theme: next });
        } catch {}
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
        } catch {}
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
          const decorated = res.recent.map((r) => {
            let exists = true;
            try {
              exists = api._statExists ? api._statExists(r.path) : true;
            } catch {}
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
      if (!payload || typeof payload !== "object") return;
      const type = payload.type;
      if (type === "checking") {
        set({
          update: {
            status: "checking",
            version: null,
            percent: 0,
            error: null,
            transferred: 0,
            total: 0,
            releaseNotes: "",
            releaseUrl: null,
          },
        });
      } else if (type === "available") {
        set({
          update: {
            status: "available",
            version: payload.version,
            percent: 0,
            error: null,
            transferred: 0,
            total: 0,
            releaseNotes: payload.releaseNotes || "",
            releaseUrl: payload.releaseUrl || null,
          },
        });
      } else if (type === "not-available") {
        set({
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
        });
      } else if (type === "downloading") {
        set((s) => ({
          update: {
            status: "downloading",
            version: payload.version || s.update?.version || null,
            percent: payload.percent || 0,
            error: null,
            transferred: payload.transferred || 0,
            total: payload.total || 0,
            releaseNotes: s.update?.releaseNotes || "",
            releaseUrl: payload.releaseUrl || s.update?.releaseUrl || null,
          },
        }));
      } else if (type === "ready") {
        set((s) => ({
          update: {
            status: "ready",
            version: payload.version || s.update?.version || null,
            percent: 100,
            error: null,
            transferred: s.update?.total || s.update?.transferred || 0,
            total: s.update?.total || 0,
            releaseNotes: s.update?.releaseNotes || "",
            releaseUrl: payload.releaseUrl || s.update?.releaseUrl || null,
          },
        }));
      } else if (type === "error") {
        set({
          update: {
            status: "error",
            version: null,
            percent: 0,
            error: payload.message || "Error desconocido",
            transferred: 0,
            total: 0,
            releaseNotes: "",
            releaseUrl: null,
          },
        });
      } else if (type === "disabled") {
        set({
          update: {
            status: "disabled",
            version: null,
            percent: 0,
            error: null,
            transferred: 0,
            total: 0,
            releaseNotes: "",
            releaseUrl: null,
          },
        });
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

    setShowShortcuts: (val) => set({ showShortcuts: val }),
    setIsDragging: (val) => set({ isDragging: val }),
  };
}
