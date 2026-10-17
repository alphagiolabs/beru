import { createWithEqualityFn } from "zustand/traditional";
import { createProcessingSlice } from "./slices/processingSlice.js";
import { createBatchSlice } from "./slices/batchSlice.js";
import { createQueueSlice } from "./slices/queueSlice.js";
import { createThemeSlice } from "./slices/themeSlice.js";
import { createUpdaterSlice } from "./slices/updaterSlice.js";
import { createSettingsSlice } from "./slices/settingsSlice.js";
import { createUiSlice } from "./slices/uiSlice.js";
import { createEditorStyleSlice } from "./slices/editorStyleSlice.js";
import { createProjectSlice } from "./slices/projectSlice.js";
import { createWatermarkSlice } from "./slices/watermarkSlice.js";
import { createAuthSlice } from "./slices/authSlice.js";
import { createPetSlice } from "./slices/petSlice.js";
import { createCompositionSlice } from "./slices/compositionSlice.js";
import { namingInputs } from "../utils/export-pipeline.js";
import { setVideoPathOwners } from "../utils/video-path-ownership.js";
import { selectIsDirty, useTimelineStore } from "../features/editor/store/useTimelineStore.js";
import {
  hasPersistedFieldChanged,
  hasUnexportedWork,
  readSessionSnapshotFromStorage,
  writeSessionSnapshotToStorage,
} from "../utils/session-persist.js";

const QUEUE_PERSIST_DELAY_MS = 400;
let _queuePersistTimer = null;

function persistSession(getState, { immediate = false } = {}) {
  if (typeof window === "undefined") return;
  if (immediate) {
    if (_queuePersistTimer) {
      clearTimeout(_queuePersistTimer);
      _queuePersistTimer = null;
    }
    writeSessionSnapshotToStorage(getState());
    return;
  }
  if (_queuePersistTimer) clearTimeout(_queuePersistTimer);
  _queuePersistTimer = setTimeout(() => {
    _queuePersistTimer = null;
    writeSessionSnapshotToStorage(getState());
  }, QUEUE_PERSIST_DELAY_MS);
}

const _restoredSession = typeof window !== "undefined" ? readSessionSnapshotFromStorage() : null;

const useEditorStore = createWithEqualityFn(
  (set, get) => ({
    ...createProcessingSlice(set, get),
    ...createBatchSlice(set, get),
    ...createQueueSlice(set, get),
    ...createThemeSlice(set, get),
    ...createUpdaterSlice(set, get),
    ...createSettingsSlice(set, get),
    ...createUiSlice(set, get),
    ...createEditorStyleSlice(set, get),
    ...createProjectSlice(set, get),
    ...createWatermarkSlice(set, get),
    ...createAuthSlice(set, get),
    ...createPetSlice(set, get),
    ...createCompositionSlice(set, get),
    ...(_restoredSession || {}),
  }),
  Object.is,
);

if (typeof window !== "undefined") {
  const syncVideoPaths = (state) =>
    setVideoPathOwners({
      queue: state.queue.map((item) => item.path),
      composition: state.composition?.entries.map((entry) => entry.item.path) ?? [],
    });
  syncVideoPaths(useEditorStore.getState());
  let unexportedWork = null;
  const syncUnexportedWork = (state) => {
    const next = hasUnexportedWork(state) || selectIsDirty(useTimelineStore.getState());
    if (next === unexportedWork) return;
    unexportedWork = next;
    void Promise.resolve(window.api?.setUnexportedWork?.(next)).catch(() => {});
  };
  syncUnexportedWork(useEditorStore.getState());
  useTimelineStore.subscribe(() => syncUnexportedWork(useEditorStore.getState()));

  useEditorStore.subscribe((state, prev) => {
    if (state.queue !== prev.queue || state.composition !== prev.composition) syncVideoPaths(state);
    const previousInputs = namingInputs(prev);
    if (
      state.encodeProfile !== prev.encodeProfile ||
      state.watermark !== prev.watermark ||
      namingInputs(state).some((value, index) => value !== previousInputs[index])
    )
      syncUnexportedWork(state);
    if (hasPersistedFieldChanged(state, prev)) {
      persistSession(() => useEditorStore.getState());
    }
  });

  if (typeof window.addEventListener === "function") {
    const flushSession = () => persistSession(() => useEditorStore.getState(), { immediate: true });
    window.addEventListener("beforeunload", flushSession);
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushSession();
      });
    }
  }
}

export default useEditorStore;
