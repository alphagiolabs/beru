import { createWithEqualityFn } from "zustand/traditional";
import { createProcessingSlice } from "./slices/processingSlice.js";
import { createBatchSlice } from "./slices/batchSlice.js";
import { createQueueSlice } from "./slices/queueSlice.js";
import { createUiSlice } from "./slices/uiSlice.js";
import { createEditorStyleSlice } from "./slices/editorStyleSlice.js";
import { createProjectSlice } from "./slices/projectSlice.js";
import { createWatermarkSlice } from "./slices/watermarkSlice.js";
import { createAuthSlice } from "./slices/authSlice.js";
import { createPetSlice } from "./slices/petSlice.js";
import {
  SESSION_PERSIST_KEY,
  readSessionSnapshotFromStorage,
  writeSessionSnapshotToStorage,
} from "../utils/session-persist.js";

const QUEUE_PERSIST_DELAY_MS = 800;
let _queuePersistTimer = null;

function persistSession(getState) {
  if (typeof window === "undefined") return;
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
    ...createUiSlice(set, get),
    ...createEditorStyleSlice(set, get),
    ...createProjectSlice(set, get),
    ...createWatermarkSlice(set, get),
    ...createAuthSlice(set, get),
    ...createPetSlice(set, get),
    ...(_restoredSession || {}),
  }),
  Object.is,
);

// Persist queue + batch/Excel/output context across crash/relaunch.
if (typeof window !== "undefined") {
  let prev = useEditorStore.getState();
  useEditorStore.subscribe((state) => {
    const changed =
      state.queue !== prev.queue ||
      state.outputDir !== prev.outputDir ||
      state.templateRegions !== prev.templateRegions ||
      state.selectedTemplateRegionId !== prev.selectedTemplateRegionId ||
      state.nextRegionLabel !== prev.nextRegionLabel ||
      state.excelPath !== prev.excelPath ||
      state.excelHeaders !== prev.excelHeaders ||
      state.excelRows !== prev.excelRows ||
      state.excelMapping !== prev.excelMapping ||
      state.excelMatchStatus !== prev.excelMatchStatus ||
      state.excelRowIndexByFilename !== prev.excelRowIndexByFilename;
    prev = state;
    if (changed) persistSession(() => useEditorStore.getState());
  });
}

export { SESSION_PERSIST_KEY };
export default useEditorStore;
