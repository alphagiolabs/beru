import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
  getVideoInfoBatch: vi.fn(async () => []),
};

globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

function queueItem(overrides = {}) {
  return {
    path: "C:\\videos\\sample.mp4",
    src: "",
    filename: "sample.mp4",
    width: 1920,
    height: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080,
    duration: 60,
    videoCodec: "h264",
    pixFmt: "yuv420p",
    frameRate: 30,
    audioCodec: "aac",
    operations: [],
    status: "idle",
    progress: 0,
    eta: null,
    speed: null,
    error: null,
    customOutputName: "",
    thumbnail: null,
    ...overrides,
  };
}

describe("undo / redo", () => {
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
      outputDir: "C:\\output",
      exportFormat: "mp4",
      isProcessing: false,
      progressTotal: 0,
      progressDone: 0,
      recent: [],
      undoStack: [],
      redoStack: [],
      imageDataCache: {},
      currentRegion: null,
      textInput: "",
      tempImagePath: "",
      tempImageOpacity: 1,
      tempStart: null,
      tempEnd: null,
      blurStrength: 20,
      delogoMethod: "temporal",
      delogoFillColor: "black",
      delogoFillOpacity: 1,
      delogoImagePath: "",
      temporalRadius: 2,
      mosaicSize: 16,
      mirrorSide: "right",
      edgeFeather: 0,
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

  it("adds operations then undo/redo them", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "Hola",
    });

    useEditorStore.getState().addOperation("text");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(1);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    useEditorStore.setState({ textInput: "Mundo", currentRegion: { ...region, x: 0.5 } });
    useEditorStore.getState().addOperation("text");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(2);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(1);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().redoStack).toHaveLength(1);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(2);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
    expect(useEditorStore.getState().redoStack).toHaveLength(0);
  });

  it("undoes a text update", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "Hola",
    });
    useEditorStore.getState().addOperation("text");
    const opIdx = 0;

    useEditorStore.getState().updateOperation(0, opIdx, { text: "Adios" });
    expect(useEditorStore.getState().queue[0].operations[opIdx].text).toBe("Adios");
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].operations[opIdx].text).toBe("Hola");
    expect(useEditorStore.getState().redoStack).toHaveLength(1);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().queue[0].operations[opIdx].text).toBe("Adios");
  });

  it("undoes a region update", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "Hola",
    });
    useEditorStore.getState().addOperation("text");
    const opIdx = 0;
    const original = { ...region };

    const moved = { x: 0.5, y: 0.6, w: 0.3, h: 0.1 };
    useEditorStore.getState().updateOperationRegion(opIdx, moved);
    expect(useEditorStore.getState().queue[0].operations[opIdx].region).toEqual(moved);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].operations[opIdx].region).toEqual(original);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().queue[0].operations[opIdx].region).toEqual(moved);
  });

  it("does not share references between undo stack and live queue", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "A",
    });
    useEditorStore.getState().addOperation("text");
    useEditorStore.getState().updateOperation(0, 0, { text: "B" });

    const history = useEditorStore.getState().undoStack;
    const live = useEditorStore.getState().queue[0].operations;

    expect(history[history.length - 1]).not.toBe(live);
    expect(history[history.length - 1][0].region).not.toBe(live[0].region);
  });

  it("clears undo and redo stacks when selecting a different video", () => {
    useEditorStore.setState({
      queue: [queueItem({ path: "a.mp4" }), queueItem({ path: "b.mp4" })],
      selectedIdx: 0,
      undoStack: [[{ id: "op-1", mode: "blur", region: null }]],
      redoStack: [[{ id: "op-2", mode: "text", region: null, text: "x" }]],
    });

    useEditorStore.getState().selectVideo(1);
    const state = useEditorStore.getState();
    expect(state.selectedIdx).toBe(1);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
  });

  it("undo stack stays bounded at MAX_UNDO_STACK (50)", () => {
    useEditorStore.setState({ queue: [queueItem()], selectedIdx: 0 });
    for (let i = 0; i < 80; i++) {
      useEditorStore.getState()._saveUndo();
    }
    expect(useEditorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });
});
