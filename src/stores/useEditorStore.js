import { createWithEqualityFn } from "zustand/traditional";
import { createProcessingSlice } from "./slices/processingSlice.js";
import { createBatchSlice } from "./slices/batchSlice.js";
import { createQueueSlice } from "./slices/queueSlice.js";
import { createUiSlice } from "./slices/uiSlice.js";
import { createEditorStyleSlice } from "./slices/editorStyleSlice.js";
import { createProjectSlice } from "./slices/projectSlice.js";

const useEditorStore = createWithEqualityFn(
  (set, get) => ({
    ...createProcessingSlice(set, get),
    ...createBatchSlice(set, get),
    ...createQueueSlice(set, get),
    ...createUiSlice(set, get),
    ...createEditorStyleSlice(set, get),
    ...createProjectSlice(set, get),
  }),
  Object.is,
);

export default useEditorStore;
