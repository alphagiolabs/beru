import { createWithEqualityFn } from "zustand/traditional";
import { createProcessingSlice } from "./slices/processingSlice.js";
import { createBatchSlice } from "./slices/batchSlice.js";
import { createQueueSlice } from "./slices/queueSlice.js";
import { createUiSlice } from "./slices/uiSlice.js";
import { createEditorStyleSlice } from "./slices/editorStyleSlice.js";
import { createProjectSlice } from "./slices/projectSlice.js";
import { createWatermarkSlice } from "./slices/watermarkSlice.js";

const QUEUE_PERSIST_KEY = "beru-queue-session";
const QUEUE_PERSIST_DELAY_MS = 800;
let _queuePersistTimer = null;

/**
 * Persist the video queue to sessionStorage so a crash or accidental close
 * doesn't lose the user's loaded videos and operations. Thumbnails and
 * imageDataCache are excluded (too large, regenerable). Only queue items
 * with a valid path are kept.
 */
function persistQueue(queue) {
  if (typeof window === "undefined") return;
  if (_queuePersistTimer) clearTimeout(_queuePersistTimer);
  _queuePersistTimer = setTimeout(() => {
    _queuePersistTimer = null;
    try {
      const minimal = queue
        .filter((item) => item && item.path)
        .map((item) => ({
          path: item.path,
          src: item.src,
          filename: item.filename,
          width: item.width || 0,
          height: item.height || 0,
          duration: item.duration || 0,
          operations: item.operations || [],
          customOutputName: item.customOutputName || "",
        }));
      sessionStorage.setItem(QUEUE_PERSIST_KEY, JSON.stringify(minimal));
    } catch {
      // sessionStorage may be full or unavailable — silently skip
    }
  }, QUEUE_PERSIST_DELAY_MS);
}

/**
 * Restore the queue from sessionStorage on startup. Returns the queue array
 * or null if nothing was saved or restoration failed.
 */
function restoreQueue() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(QUEUE_PERSIST_KEY);
    if (!raw) return null;
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return null;
    return items.map((item) => ({
      ...item,
      status: "idle",
      progress: 0,
      error: null,
      thumbnail: null,
    }));
  } catch {
    return null;
  }
}

const _restoredQueue = restoreQueue();

const useEditorStore = createWithEqualityFn(
  (set, get) => ({
    ...createProcessingSlice(set, get),
    ...createBatchSlice(set, get),
    ...createQueueSlice(set, get),
    ...createUiSlice(set, get),
    ...createEditorStyleSlice(set, get),
    ...createProjectSlice(set, get),
    ...createWatermarkSlice(set, get),
    // Restore queue from sessionStorage if available
    ...(_restoredQueue
      ? {
          queue: _restoredQueue,
          selectedIdx: _restoredQueue.length > 0 ? 0 : -1,
        }
      : {}),
  }),
  Object.is,
);

// Subscribe to queue changes for persistence (only persists the queue field).
// zustand's subscribe fires on every state change, so we compare the queue
// reference to avoid persisting on unrelated state updates.
if (typeof window !== "undefined") {
  let _lastQueue = useEditorStore.getState().queue;
  useEditorStore.subscribe((state) => {
    if (state.queue !== _lastQueue) {
      _lastQueue = state.queue;
      persistQueue(state.queue);
    }
  });
}

export default useEditorStore;
