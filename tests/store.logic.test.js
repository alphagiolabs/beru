import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
  getVideoInfoBatch: vi.fn(async () => []),
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
    mockApi.getVideoInfoBatch.mockClear();
    mockApi.startProcessing.mockResolvedValue({ success: true });
    mockApi.removeRecent.mockResolvedValue({ success: true, recent: [] });
    mockApi.getVideoInfoBatch.mockResolvedValue([]);

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

  it("addVideos populates the queue and selects the first item", async () => {
    mockApi.getVideoInfoBatch.mockResolvedValueOnce([
      {
        width: 1920,
        height: 1080,
        duration: 42,
        videoCodec: "h264",
        pixFmt: "yuv420p",
        frameRate: 30,
        audioCodec: "aac",
      },
    ]);

    await useEditorStore.getState().addVideos(["C:\\videos\\clip.mp4"], mockApi);

    expect(useEditorStore.getState().queue).toHaveLength(1);
    await vi.waitFor(() => {
      expect(useEditorStore.getState().queue[0].width).toBe(1920);
    });
    const state = useEditorStore.getState();

    expect(state.queue[0]).toEqual(
      expect.objectContaining({
        path: "C:\\videos\\clip.mp4",
        filename: "clip.mp4",
        width: 1920,
        height: 1080,
        duration: 42,
      }),
    );
    expect(state.selectedIdx).toBe(0);
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

  it("refreshes missing video dimensions before building jobs", async () => {
    mockApi.getVideoInfoBatch.mockResolvedValueOnce([
      {
        width: 1280,
        height: 720,
        duration: 12.5,
        videoCodec: "h264",
        pixFmt: "yuv420p",
        frameRate: 30,
        audioCodec: "aac",
      },
    ]);
    useEditorStore.setState({
      queue: [
        queueItem({
          path: "C:\\videos\\missing.mp4",
          filename: "missing.mp4",
          width: 0,
          height: 0,
        }),
        queueItem({
          path: "C:\\videos\\ready.mp4",
          filename: "ready.mp4",
          width: 1920,
          height: 1080,
        }),
      ],
    });

    const refreshed = await useEditorStore.getState().refreshMissingVideoInfo(mockApi);
    const job = useEditorStore.getState()._buildJobFor(refreshed[0], 0);

    expect(mockApi.getVideoInfoBatch).toHaveBeenCalledWith(["C:\\videos\\missing.mp4"]);
    expect(refreshed[0]).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        duration: 12.5,
        videoCodec: "h264",
        frameRate: 30,
        audioCodec: "aac",
      }),
    );
    expect(refreshed[1].width).toBe(1920);
    expect(job).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        source_width: 1280,
        source_height: 720,
      }),
    );
    expect(refreshed[0].sourceWidth).toBe(1280);
    expect(refreshed[0].sourceHeight).toBe(720);
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
    expect(op).toEqual(
      expect.objectContaining({
        text: "Hola",
        fontWeight: 700,
        letterSpacing: 4,
        textAlign: "center",
        textOpacity: 0.75,
        boxBorderWidth: 9,
      }),
    );
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

    expect(project.textStyle).toEqual(
      expect.objectContaining({
        fontWeight: 900,
        letterSpacing: 6,
        textAlign: "right",
        textOpacity: 0.4,
        boxBorderWidth: 12,
      }),
    );

    useEditorStore.setState({
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      boxBorderWidth: 4,
    });

    const result = useEditorStore.getState()._applyProject({ ...project, excel: null });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        fontWeight: 900,
        letterSpacing: 6,
        textAlign: "right",
        textOpacity: 0.4,
        boxBorderWidth: 12,
      }),
    );
  });

  it("getBatchPreviewPayload returns Excel text without a text operation", () => {
    useEditorStore.setState({
      queue: [queueItem()],
      templateRegions: [
        {
          id: "region-1",
          label: "TEXT_1",
          region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          style: { fontSize: 48, fontColor: "#ff0000" },
        },
      ],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
      sidebarMode: "batch",
    });

    const payload = useEditorStore.getState().getBatchPreviewPayload(0, "region-1");

    expect(payload.text).toBe("Desde Excel");
    expect(payload.style.fontSize).toBe(48);
    expect(payload.style.fontColor).toBe("#ff0000");
  });

  it("patchBatchTextStyle updates template region style and matching ops in the queue", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              region: { ...region },
              text: "A",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
        queueItem({
          path: "C:\\videos\\b.mp4",
          filename: "b.mp4",
          operations: [
            {
              id: "op-2",
              mode: "text",
              region: { ...region },
              text: "B",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().patchBatchTextStyle({ fontSize: 64, fontColor: "#00ff00" });

    const state = useEditorStore.getState();
    expect(state.textFontSize).toBe(64);
    expect(state.textFontColor).toBe("#00ff00");
    expect(state.templateRegions[0].style.fontSize).toBe(64);
    expect(state.queue[0].operations[0].fontSize).toBe(64);
    expect(state.queue[1].operations[0].fontColor).toBe("#00ff00");
  });

  it("persists per-region style in serialized projects", () => {
    useEditorStore.setState({
      templateRegions: [
        {
          id: 1,
          label: "TEXT_1",
          region: { x: 0, y: 0, w: 0.2, h: 0.1 },
          style: { fontSize: 44, fontColor: "#abcdef" },
        },
      ],
    });

    const project = useEditorStore.getState().serializeProject();
    expect(project.templateRegions[0].style).toEqual(
      expect.objectContaining({ fontSize: 44, fontColor: "#abcdef" }),
    );
  });

  it("prunes imageDataCache when a video is removed from the queue", () => {
    useEditorStore.setState({
      queue: [
        queueItem({
          operations: [
            {
              id: "img-1",
              mode: "image",
              imagePath: "C:\\img\\a.png",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
            },
          ],
        }),
        queueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
    });

    useEditorStore.getState().removeVideo(0);

    expect(useEditorStore.getState().imageDataCache).toEqual({});
  });

  it("prunes imageDataCache when an image operation is removed", () => {
    useEditorStore.setState({
      queue: [
        queueItem({
          operations: [
            {
              id: "img-1",
              mode: "image",
              imagePath: "C:\\img\\a.png",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
            },
          ],
        }),
      ],
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
    });

    useEditorStore.getState().removeOperationAt(0, 0);

    expect(useEditorStore.getState().imageDataCache).toEqual({});
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

  it("keeps updater release metadata while download progress arrives", () => {
    useEditorStore.getState().applyUpdaterEvent({
      type: "available",
      version: "1.6.0",
      releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
      releaseNotes: "Cambios de prueba",
    });

    useEditorStore.getState().applyUpdaterEvent({
      type: "downloading",
      percent: 42.4,
      transferred: 4200,
      total: 10000,
    });

    expect(useEditorStore.getState().update).toEqual(
      expect.objectContaining({
        status: "downloading",
        version: "1.6.0",
        percent: 42.4,
        transferred: 4200,
        total: 10000,
        releaseNotes: "Cambios de prueba",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
      }),
    );
  });
});
