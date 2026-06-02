import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
};

globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

const queueItem = (overrides = {}) => ({
  path: "C:\\videos\\sample.mp4",
  src: "",
  filename: "sample.mp4",
  width: 1920,
  height: 1080,
  duration: 0,
  videoCodec: "",
  pixFmt: "yuv420p",
  frameRate: 0,
  audioCodec: "",
  operations: [],
  status: "idle",
  progress: 0,
  eta: null,
  speed: null,
  error: null,
  customOutputName: "",
  thumbnail: null,
  ...overrides,
});

describe("useEditorStore logic regressions", () => {
  beforeEach(() => {
    mockApi.startProcessing.mockClear();
    mockApi.removeRecent.mockClear();
    mockApi.startProcessing.mockResolvedValue({ success: true });
    mockApi.removeRecent.mockResolvedValue({ success: true, recent: [] });

    useEditorStore.setState({
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
    });
  });

  it("uses the queue index as the job id when processing a single video", async () => {
    useEditorStore.setState({
      queue: [
        queueItem({ path: "C:\\videos\\a.mp4", filename: "a.mp4" }),
        queueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      selectedIdx: 1,
    });

    const res = await useEditorStore.getState().processSingle(1);

    expect(res.ok).toBe(true);
    expect(mockApi.startProcessing).toHaveBeenCalledTimes(1);
    expect(mockApi.startProcessing.mock.calls[0][0][0].id).toBe(1);
  });

  it("reapplies Excel rows using advanced text style defaults", () => {
    useEditorStore.setState({
      queue: [queueItem()],
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "sample", TEXT_1: "Hola" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      boxBorderWidth: 9,
    });

    const report = useEditorStore.getState()._reapplyExcel();
    const op = useEditorStore.getState().queue[0].operations[0];

    expect(report).toEqual({ matched: 1, unmatched: 0, duplicate: 0, total: 1 });
    expect(op).toEqual(expect.objectContaining({
      text: "Hola",
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      boxBorderWidth: 9,
    }));
  });

  it("round-trips advanced text style fields in project and preset data", () => {
    useEditorStore.setState({
      fontWeight: 900,
      letterSpacing: 6,
      textAlign: "right",
      textOpacity: 0.4,
      boxBorderWidth: 12,
    });

    const project = useEditorStore.getState().serializeProject();

    expect(project.textStyle).toEqual(expect.objectContaining({
      fontWeight: 900,
      letterSpacing: 6,
      textAlign: "right",
      textOpacity: 0.4,
      boxBorderWidth: 12,
    }));

    useEditorStore.setState({
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      boxBorderWidth: 4,
    });

    const result = useEditorStore.getState()._applyProject({ ...project, excel: null });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState()).toEqual(expect.objectContaining({
      fontWeight: 900,
      letterSpacing: 6,
      textAlign: "right",
      textOpacity: 0.4,
      boxBorderWidth: 12,
    }));
  });

  it("does not duplicate recent projects after removing one through IPC", async () => {
    mockApi.removeRecent.mockResolvedValue({
      success: true,
      recent: [{ path: "C:\\projects\\b.beru.json", name: "b.beru.json" }],
    });
    useEditorStore.setState({
      recent: [
        { path: "C:\\projects\\a.beru.json", name: "a.beru.json", exists: true },
        { path: "C:\\projects\\b.beru.json", name: "b.beru.json", exists: true },
      ],
    });

    await useEditorStore.getState().removeRecent("C:\\projects\\a.beru.json");

    expect(useEditorStore.getState().recent).toEqual([
      { path: "C:\\projects\\b.beru.json", name: "b.beru.json", exists: true },
    ]);
  });
});
