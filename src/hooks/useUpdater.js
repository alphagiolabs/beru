import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";

const UPDATE_CHECK_DELAY_MS = 2500;
const UPDATE_CHECK_THROTTLE_MS = 30 * 60 * 1000;
const LAST_CHECK_KEY = "beru.updater.lastCheck";

const safeStorage = {
  get(key) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {}
  },
};

function shouldHydrateSnapshot(update) {
  const status = update?.status || "idle";
  return status === "idle" || status === "disabled";
}

export default function useUpdater(api) {
  useEffect(() => {
    if (!api?.onUpdaterEvent) return undefined;

    const { applyUpdaterEvent, checkForUpdates } = useEditorStore.getState();
    let cancelled = false;

    const unsub = api.onUpdaterEvent((payload) => {
      applyUpdaterEvent(payload);
    });

    const hydrate = async () => {
      if (!api.getUpdaterSnapshot) return;
      try {
        const snapshot = await api.getUpdaterSnapshot();
        if (cancelled || !snapshot) return;
        const { update } = useEditorStore.getState();
        if (shouldHydrateSnapshot(update)) {
          applyUpdaterEvent(snapshot);
        }
      } catch {}
    };

    void hydrate();

    const lastCheck = Number(safeStorage.get(LAST_CHECK_KEY) || 0);
    const recentlyChecked = lastCheck > 0 && Date.now() - lastCheck < UPDATE_CHECK_THROTTLE_MS;
    let timerId = null;

    if (!recentlyChecked && api.checkForUpdates) {
      timerId = setTimeout(async () => {
        if (cancelled) return;
        await checkForUpdates();
        if (!cancelled) safeStorage.set(LAST_CHECK_KEY, String(Date.now()));
      }, UPDATE_CHECK_DELAY_MS);
    }

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (typeof unsub === "function") unsub();
    };
  }, [api]);
}
