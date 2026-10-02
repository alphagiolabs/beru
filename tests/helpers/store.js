import { vi } from "vitest";
import { createQueueItem } from "../../src/utils/types.js";

export const makeQueueItem = (overrides = {}) =>
  createQueueItem({
    path: "C:\\videos\\sample.mp4",
    filename: "sample.mp4",
    width: 1920,
    height: 1080,
    pixFmt: "yuv420p",
    ...overrides,
  });

export const createMockApi = () => ({
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
  getVideoInfoBatch: vi.fn(async () => []),
});

// The store reads window.api; install before importing useEditorStore.
export const installMockApi = (api = createMockApi()) => {
  globalThis.window = { api };
  return api;
};

const INITIAL_UPDATE = {
  status: "idle",
  version: null,
  percent: 0,
  error: null,
  transferred: 0,
  total: 0,
  releaseNotes: "",
  releaseUrl: null,
};

export function resetEditorState(store, api, extra = {}) {
  if (api) {
    for (const fn of Object.values(api)) {
      if (typeof fn?.mockClear === "function") fn.mockClear();
    }
    api.startProcessing?.mockResolvedValue({ success: true });
    api.removeRecent?.mockResolvedValue({ success: true, recent: [] });
    api.getVideoInfoBatch?.mockResolvedValue([]);
  }

  store.setState({
    queue: [],
    selectedIdx: -1,
    templateRegions: [],
    excelRows: [],
    excelMapping: { idColumn: null, columns: {} },
    excelMatchStatus: {},
    outputDir: null,
    exportFormat: "mp4",
    isProcessing: false,
    progressTotal: 0,
    progressDone: 0,
    recent: [],
    update: { ...INITIAL_UPDATE },
    textFontSize: 32,
    textFontColor: "white",
    fontFamily: "Arial",
    fontWeight: 400,
    letterSpacing: 0,
    textAlign: "left",
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: true,
    bgColor: "black",
    bgOpacity: 0.65,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
    ...extra,
  });
}
