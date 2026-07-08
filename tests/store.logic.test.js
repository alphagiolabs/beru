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
      textShadowEnabled: false,
      textShadowColor: "black",
      textShadowOffsetX: 2,
      textShadowOffsetY: 2,
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
    const manifest = mockApi.startProcessing.mock.calls[0][0];
    expect(manifest.type).toBe("beru-job-manifest");
    expect(manifest.version).toBe(1);
    expect(manifest.jobs[0].id).toBe(1);
  });

  it("uses ID_TEXT as the output name for batch text jobs", () => {
    useEditorStore.setState({
      queue: [queueItem({ path: "C:\\videos\\promo.mp4", filename: "promo.mp4" })],
      outputDir: "C:\\output",
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "promo.mp4", TEXT_1: "Oferta: 50% / hoy" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore.getState()._reapplyExcel();
    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);

    expect(job.output_path).toBe("C:\\output\\promo_Oferta 50% hoy.mp4");
  });

  it("uses the first non-empty batch text when TEXT_1 is empty", () => {
    useEditorStore.setState({
      queue: [queueItem({ path: "C:\\videos\\promo.mp4", filename: "promo.mp4" })],
      outputDir: "C:\\output",
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
        { id: "region-2", label: "TEXT_2", region: { x: 0.1, y: 0.4, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "promo", TEXT_1: "", TEXT_2: "Subtitulo" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" } },
    });

    useEditorStore.getState()._reapplyExcel();
    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);

    expect(job.output_path).toBe("C:\\output\\promo_Subtitulo.mp4");
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
      textShadowEnabled: true,
      textShadowColor: "#111111",
      textShadowOffsetX: 3,
      textShadowOffsetY: 4,
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
        textShadowEnabled: true,
        textShadowColor: "#111111",
        textShadowOffsetX: 3,
        textShadowOffsetY: 4,
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
      textShadowEnabled: true,
      textShadowColor: "#222222",
      textShadowOffsetX: 8,
      textShadowOffsetY: 9,
    });

    const project = useEditorStore.getState().serializeProject();

    expect(project.textStyle).toEqual(
      expect.objectContaining({
        fontWeight: 900,
        letterSpacing: 6,
        textAlign: "right",
        textOpacity: 0.4,
        boxBorderWidth: 12,
        textShadowEnabled: true,
        textShadowColor: "#222222",
        textShadowOffsetX: 8,
        textShadowOffsetY: 9,
      }),
    );

    useEditorStore.setState({
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      boxBorderWidth: 4,
      textShadowEnabled: false,
      textShadowColor: "black",
      textShadowOffsetX: 2,
      textShadowOffsetY: 2,
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
        textShadowEnabled: true,
        textShadowColor: "#222222",
        textShadowOffsetX: 8,
        textShadowOffsetY: 9,
      }),
    );
  });

  it("loadPreset applies advanced text style fields", () => {
    useEditorStore.setState({
      sidebarMode: "logo",
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
    });

    useEditorStore.getState().loadPreset({
      fontSize: 42,
      fontColor: "#abcdef",
      fontFamily: "Arial Black",
      fontWeight: 900,
      letterSpacing: 3,
      textAlign: "center",
      textOpacity: 0.6,
    });

    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        textFontSize: 42,
        textFontColor: "#abcdef",
        fontFamily: "Arial Black",
        fontWeight: 900,
        letterSpacing: 3,
        textAlign: "center",
        textOpacity: 0.6,
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

    useEditorStore.getState().patchBatchTextStyle({
      fontSize: 64,
      fontColor: "#00ff00",
      textShadowEnabled: true,
      textShadowOffsetY: 6,
    });

    const state = useEditorStore.getState();
    expect(state.textFontSize).toBe(64);
    expect(state.textFontColor).toBe("#00ff00");
    expect(state.templateRegions[0].style.fontSize).toBe(64);
    expect(state.templateRegions[0].style.textShadowEnabled).toBe(true);
    expect(state.templateRegions[0].style.textShadowOffsetY).toBe(6);
    expect(state.queue[0].operations[0].fontSize).toBe(64);
    expect(state.queue[1].operations[0].fontColor).toBe("#00ff00");
    expect(state.queue[1].operations[0].textShadowEnabled).toBe(true);
    expect(state.queue[1].operations[0].textShadowOffsetY).toBe(6);
  });

  it("updateTemplateRegion resizes the selected batch region and matching queue text ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const resized = { x: 0.1, y: 0.2, w: 0.5, h: 0.16 };
    useEditorStore.setState({
      selectedTemplateRegionId: "region-1",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...region },
              text: "A",
              fontSize: 32,
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().updateTemplateRegion("region-1", {
      region: resized,
      fontSize: 48,
      textWrap: false,
      truncate: "ellipsis",
    });

    const state = useEditorStore.getState();
    expect(state.templateRegions[0].region).toEqual(resized);
    expect(state.templateRegions[0].style).toEqual(
      expect.objectContaining({ fontSize: 48, textWrap: false, truncate: "ellipsis" }),
    );
    expect(state.queue[0].operations[0]).toEqual(
      expect.objectContaining({
        region: resized,
        fontSize: 48,
        textWrap: false,
        truncate: "ellipsis",
      }),
    );
  });

  it("setSelectedTemplateRegion loads the template region into currentRegion", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      selectedTemplateRegionId: null,
      currentRegion: null,
    });

    useEditorStore.getState().setSelectedTemplateRegion("region-1");
    const state = useEditorStore.getState();

    expect(state.selectedTemplateRegionId).toBe("region-1");
    expect(state.currentRegion).toEqual(region);
  });

  it("setCurrentRegion in batch mode syncs resize to template region and queue ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const resized = { x: 0.12, y: 0.22, w: 0.5, h: 0.16 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { ...region },
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        queueItem({
          width: 1920,
          height: 1080,
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...region },
              text: "A",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().setCurrentRegion(resized);
    const state = useEditorStore.getState();

    expect(state.currentRegion).toEqual(resized);
    expect(state.templateRegions[0].region).toEqual(resized);
    expect(state.queue[0].operations[0].region).toEqual(resized);
  });

  it("setCurrentRegion(null) in batch mode keeps selectedTemplateRegionId", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().setCurrentRegion(null);
    const state = useEditorStore.getState();

    expect(state.currentRegion).toBeNull();
    expect(state.selectedTemplateRegionId).toBe("region-1");
  });

  it("cancelBatchRegionSelection clears currentRegion and selectedTemplateRegionId", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().cancelBatchRegionSelection();
    const state = useEditorStore.getState();

    expect(state.currentRegion).toBeNull();
    expect(state.selectedTemplateRegionId).toBeNull();
  });

  it("setSelectedTemplateRegion uses per-video moved region for canvas handles", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedIdx: 0,
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Hola",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().setSelectedTemplateRegion("region-1");
    expect(useEditorStore.getState().currentRegion).toEqual(movedRegion);
  });

  it("starting a fresh canvas draw in batch mode deselects the template region", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().setCurrentRegion({ x: 0.4, y: 0.5, w: 0, h: 0 });
    const state = useEditorStore.getState();

    expect(state.selectedTemplateRegionId).toBeNull();
    expect(state.currentRegion).toEqual(
      expect.objectContaining({ x: 0.4, y: 0.5, w: 0.01, h: 0.01 }),
    );
  });

  it("reapplying Excel preserves an individually moved batch text region", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Antes",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore.getState()._reapplyExcel();
    const op = useEditorStore.getState().queue[0].operations[0];
    const payload = useEditorStore.getState().getBatchPreviewPayload(0, "region-1");

    expect(op.batchRegionId).toBe("region-1");
    expect(op.text).toBe("Desde Excel");
    expect(op.region).toEqual(movedRegion);
    expect(payload.region).toEqual(movedRegion);
  });

  it("syncs edited moved batch text back to Excel through batchRegionId", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Antes",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      excelRows: [{ id: "sample", TEXT_1: "Antes" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore.getState().updateOperationText(0, 0, "Despues");

    expect(useEditorStore.getState().excelRows[0].TEXT_1).toBe("Despues");
  });

  it("updates only the specific video operation and currentRegion when dragging batch overlay (per-video positioning)", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const nextRegion = { x: 0.4, y: 0.4, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedIdx: 0,
      selectedTemplateRegionId: "region-1",
      currentRegion: { ...templateRegion },
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...templateRegion },
              text: "Video 1",
            },
          ],
        }),
        queueItem({
          operations: [
            {
              id: "op-2",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...templateRegion },
              text: "Video 2",
            },
          ],
        }),
      ],
    });

    // Simulate drag updating operation 0 on video 0
    useEditorStore.getState().updateOperation(0, 0, { region: nextRegion });
    useEditorStore.setState({ currentRegion: nextRegion });

    const state = useEditorStore.getState();
    // 1. Current region is updated in UI
    expect(state.currentRegion).toEqual(nextRegion);
    // 2. Video 0's operation has the new custom region
    expect(state.queue[0].operations[0].region).toEqual(nextRegion);
    // 3. Template region remains at original position
    expect(state.templateRegions[0].region).toEqual(templateRegion);
    // 4. Video 1's operation remains at original template position
    expect(state.queue[1].operations[0].region).toEqual(templateRegion);
  });

  it("live region drag can skip undo snapshots (recordHistory: false)", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      selectedIdx: 0,
      undoStack: [],
      queue: [
        queueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              region: { ...region },
              text: "A",
            },
          ],
        }),
      ],
    });

    // Pointerdown: one snapshot
    useEditorStore.getState()._saveUndo();
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    // Many mousemove updates must not flood the undo stack
    for (let i = 0; i < 20; i++) {
      useEditorStore
        .getState()
        .updateOperation(
          0,
          0,
          { region: { ...region, x: 0.1 + i * 0.01 } },
          { recordHistory: false },
        );
      useEditorStore
        .getState()
        .updateOperationRegion(0, { ...region, x: 0.1 + i * 0.01 }, { recordHistory: false });
    }

    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(0.29, 5);

    // Default path still records history
    useEditorStore.getState().updateOperationRegion(0, { ...region, x: 0.5 });
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
  });

  it("removes moved batch text operations when deleting their template region", () => {
    const removedTemplateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem({
          operations: [
            {
              id: "batch-op",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Se borra",
            },
            {
              id: "manual-op",
              mode: "text",
              region: { x: 0.7, y: 0.7, w: 0.2, h: 0.1 },
              text: "Se queda",
            },
            {
              id: "blur-op",
              mode: "blur",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
              blurStrength: 20,
            },
          ],
        }),
      ],
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: removedTemplateRegion },
        { id: "region-2", label: "TEXT_2", region: { x: 0.5, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      selectedTemplateRegionId: "region-1",
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" } },
    });

    useEditorStore.getState().removeTemplateRegion("region-1");
    const state = useEditorStore.getState();

    expect(state.templateRegions.map((r) => r.id)).toEqual(["region-2"]);
    expect(state.selectedTemplateRegionId).toBe("region-2");
    expect(state.excelMapping.columns).toEqual({ "region-2": "TEXT_2" });
    expect(state.queue[0].operations.map((op) => op.id)).toEqual(["manual-op", "blur-op"]);
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

  it("clearQueue empties the queue and resets selection state", () => {
    useEditorStore.setState({
      queue: [
        queueItem({ path: "C:\\videos\\a.mp4", filename: "a.mp4" }),
        queueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      selectedIdx: 1,
      selectedOperationIdx: 0,
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      undoStack: [[{ id: "op-1", mode: "blur", region: null }]],
      redoStack: [[{ id: "op-2", mode: "blur", region: null }]],
      excelMatchStatus: { 0: "matched", 1: "unmatched" },
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
      batchSummary: { total: 2, succeeded: 1, failed: 1 },
      templateIdx: 0,
    });

    const cleared = useEditorStore.getState().clearQueue();
    const state = useEditorStore.getState();

    expect(cleared).toBe(true);
    expect(state.queue).toEqual([]);
    expect(state.selectedIdx).toBe(-1);
    expect(state.selectedOperationIdx).toBeNull();
    expect(state.currentRegion).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.excelMatchStatus).toEqual({});
    expect(state.imageDataCache).toEqual({});
    expect(state.batchSummary).toBeNull();
    expect(state.templateIdx).toBe(-1);
  });

  it("clearQueue is a no-op on an empty queue", () => {
    useEditorStore.setState({ queue: [], selectedIdx: -1 });

    const cleared = useEditorStore.getState().clearQueue();

    expect(cleared).toBe(false);
    expect(useEditorStore.getState().queue).toEqual([]);
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

  it("keeps updater check failures silent instead of entering an error state", () => {
    useEditorStore.getState().applyUpdaterEvent({
      type: "error",
      message: "This operation was aborted",
    });

    expect(useEditorStore.getState().update).toEqual(
      expect.objectContaining({
        status: "idle",
        error: null,
      }),
    );
  });

  it("does not start duplicate downloads while one is already active", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "downloading",
        version: "1.6.0",
        percent: 40,
        error: null,
        transferred: 4000,
        total: 10000,
        releaseNotes: "",
        releaseUrl: null,
      },
    });

    const res = await useEditorStore.getState().downloadUpdate();

    expect(res).toEqual({ ok: true, reason: "already-in-progress" });
    expect(window.api.downloadUpdate).not.toHaveBeenCalled();
  });

  it("passes the pending update version to the native download IPC", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "1.6.99",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: null,
      },
    });

    await useEditorStore.getState().downloadUpdate();

    expect(window.api.downloadUpdate).toHaveBeenCalledWith({ version: "1.6.99" });
  });

  it("preserves download failure reason on the update slice", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: false, error: "no-update-available" })),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "1.6.99",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: null,
      },
    });

    await useEditorStore.getState().downloadUpdate();

    expect(useEditorStore.getState().update).toEqual(
      expect.objectContaining({
        status: "available",
        version: "1.6.99",
        error: "no-update-available",
      }),
    );
  });

  it("setUpdateModalOpen controls the shared update modal flag", () => {
    useEditorStore.getState().setUpdateModalOpen(true);
    expect(useEditorStore.getState().updateModalOpen).toBe(true);
    useEditorStore.getState().setUpdateModalOpen(false);
    expect(useEditorStore.getState().updateModalOpen).toBe(false);
  });

  it("addOperation rejects image and empty text ops in logo mode", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "   ",
      tempImagePath: "",
    });

    useEditorStore.getState().addOperation("image");
    useEditorStore.getState().addOperation("text");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);

    useEditorStore.setState({ textInput: "Hola", tempImagePath: "C:\\img\\logo.png" });
    useEditorStore.getState().addOperation("text");
    useEditorStore.setState({ currentRegion: region });
    useEditorStore.getState().addOperation("image");
    const ops = useEditorStore.getState().queue[0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[0].mode).toBe("text");
    expect(ops[0].text).toBe("Hola");
    expect(ops[1].mode).toBe("image");
    expect(ops[1].imagePath).toBe("C:\\img\\logo.png");
  });

  it("addTemplateRegion stores batch text regions from the current selection", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      activeTool: "text",
      currentRegion: region,
      templateRegions: [],
      nextRegionLabel: 1,
    });

    useEditorStore.getState().addTemplateRegion();
    const state = useEditorStore.getState();

    expect(state.templateRegions).toHaveLength(1);
    expect(state.templateRegions[0].label).toBe("TEXT_1");
    expect(state.templateRegions[0].region).toEqual(region);
    expect(state.currentRegion).toBeNull();
  });

  it("preserves prior execution runs when starting a new batch", () => {
    useEditorStore.setState({
      executionHistory: [],
      activeExecutionId: null,
      logLines: [],
    });

    useEditorStore.getState().startExecutionRun({ kind: "batch", jobCount: 2 });
    useEditorStore.getState().appendLog("first-run");
    useEditorStore.getState().setBatchSummary({ total: 2, succeeded: 2, failed: 0 });

    useEditorStore.getState().startExecutionRun({ kind: "batch", jobCount: 1 });
    useEditorStore.getState().appendLog("second-run");

    const { executionHistory } = useEditorStore.getState();
    expect(executionHistory).toHaveLength(2);
    expect(executionHistory[1].lines).toEqual(["first-run"]);
    expect(executionHistory[1].summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(executionHistory[0].lines).toEqual(["second-run"]);
  });

  it("abortActiveProcessing resets in-flight queue rows and clears jobProgress", () => {
    useEditorStore.setState({
      queue: [
        queueItem({ status: "done", progress: 100 }),
        queueItem({ status: "processing", progress: 42 }),
        queueItem({ status: "idle", progress: 0 }),
      ],
      isProcessing: true,
      jobProgress: { 1: 42 },
    });

    useEditorStore.getState().abortActiveProcessing();
    const state = useEditorStore.getState();
    expect(state.isProcessing).toBe(false);
    expect(state.queue[0].status).toBe("done");
    expect(state.queue[1].status).toBe("idle");
    expect(state.queue[1].progress).toBe(0);
    expect(state.queue[2].status).toBe("idle");
    expect(state.jobProgress).toEqual({});
  });

  it("markJobError removes the index from jobProgress instead of leaving undefined", () => {
    useEditorStore.setState({
      queue: [
        queueItem({ status: "done", progress: 100 }),
        queueItem({ status: "processing", progress: 42 }),
      ],
      isProcessing: true,
      progressTotal: 2,
      progressDone: 1,
      jobProgress: { 1: 42 },
    });

    useEditorStore.getState().markJobError({ index: 1, error: "boom" });
    const state = useEditorStore.getState();
    expect(state.queue[1].status).toBe("error");
    // The key MUST be absent (not present-with-undefined). A present undefined
    // key makes hasOwnProperty-based consumers (e.g. getBatchProgress) read
    // NaN and makes future applyJobProgressMap copies carry stale entries.
    expect(Object.prototype.hasOwnProperty.call(state.jobProgress, 1)).toBe(false);
    expect(state.jobProgress).toEqual({});
  });

  it("markJobDone sets jobProgress[idx] to 100 and keeps other indices intact", () => {
    useEditorStore.setState({
      queue: [
        queueItem({ status: "processing", progress: 0 }),
        queueItem({ status: "processing", progress: 0 }),
      ],
      isProcessing: true,
      progressTotal: 2,
      progressDone: 0,
      jobProgress: { 0: 50, 1: 30 },
    });

    useEditorStore.getState().markJobDone({ index: 0 });
    const state = useEditorStore.getState();
    expect(state.queue[0].status).toBe("done");
    expect(state.jobProgress[0]).toBe(100);
    expect(state.jobProgress[1]).toBe(30);
  });

  it("markJobDone is a no-op when not processing (late cancel events)", () => {
    useEditorStore.setState({
      queue: [queueItem({ status: "idle", progress: 0 })],
      isProcessing: false,
      progressTotal: 1,
      progressDone: 0,
    });
    useEditorStore.getState().markJobDone({ index: 0 });
    expect(useEditorStore.getState().queue[0].status).toBe("idle");
    expect(useEditorStore.getState().progressDone).toBe(0);
  });
});
