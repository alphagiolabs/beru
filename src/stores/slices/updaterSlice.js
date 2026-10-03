import { canStartDownload, reduceUpdaterEvent, IDLE_UPDATE } from "../../utils/updateState.js";

export function createUpdaterSlice(set, get) {
  return {
    update: { ...IDLE_UPDATE },

    applyUpdaterEvent: (payload) => {
      set((s) => ({
        update: reduceUpdaterEvent(s.update, payload),
      }));
    },

    checkForUpdates: async () => {
      const api = window.api;
      if (!api?.checkForUpdates) return { ok: false, reason: "no-api" };
      let res;
      try {
        res = await api.checkForUpdates();
      } catch (error) {
        res = { ok: false, error: error?.message || "no-api" };
      }
      if (
        res?.ok === false &&
        ![
          "check-in-progress",
          "download-in-progress",
          "already-ready",
          "install-in-progress",
        ].includes(res.reason)
      )
        get().applyUpdaterEvent({ type: "error", message: res.error || res.reason });
      return res;
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

      const targetVersion = update.version;

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

      let res;
      try {
        res = await api.downloadUpdate({ version: targetVersion });
      } catch (error) {
        res = { ok: false, error: error?.message || "download-failed" };
      }
      if (res?.ok === false) {
        const current = get().update;
        if (current?.status === "downloading") {
          const failureReason = res.reason || res.error || "unknown";
          set((s) => ({
            update: {
              ...reduceUpdaterEvent(s.update, {
                type: "available",
                version: s.update.version,
                releaseNotes: s.update.releaseNotes,
                releaseUrl: s.update.releaseUrl,
              }),
              error: failureReason,
            },
          }));
        }
      }
      return res;
    },

    installUpdate: async () => {
      const api = window.api;
      if (!api?.installUpdate) return { ok: false, reason: "no-api" };
      let res;
      try {
        res = await api.installUpdate();
      } catch (error) {
        res = { ok: false, error: error?.message || "download-failed" };
      }
      if (res?.ok === false)
        get().applyUpdaterEvent({ type: "error", message: res.error || res.reason });
      return res;
    },
  };
}
