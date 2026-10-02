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

      const res = await api.downloadUpdate({ version: targetVersion });
      if (res?.ok === false) {
        const current = get().update;
        if (current?.status === "downloading" && (current.percent || 0) === 0) {
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
      return await api.installUpdate();
    },
  };
}
