import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
  getVideoInfoBatch: vi.fn(async () => []),
};
globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

function queueItem(i) {
  return {
    path: `C:\\videos\\video_${i}.mp4`,
    src: `beru://local/C%3A%5Cvideos%5Cvideo_${i}.mp4`,
    filename: `video_${i}.mp4`,
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
  };
}

describe("Stability under heavy load", () => {
  beforeEach(() => {
    mockApi.startProcessing.mockClear();
    mockApi.getVideoInfoBatch.mockClear();
    mockApi.startProcessing.mockResolvedValue({ success: true });
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
      logLines: [],
      imageDataCache: {},
      undoStack: [],
      redoStack: [],
      batchSummary: null,
    });
  });

  it("handles 500-video queue without crash", () => {
    const items = Array.from({ length: 500 }, (_, i) => queueItem(i));
    useEditorStore.setState({ queue: items });
    expect(useEditorStore.getState().queue).toHaveLength(500);
    expect(useEditorStore.getState().queue[499].filename).toBe("video_499.mp4");
  });

  it("survives rapid progress updates on a 500-video queue", () => {
    const items = Array.from({ length: 500 }, (_, i) => queueItem(i));
    useEditorStore.setState({
      queue: items,
      isProcessing: true,
      progressTotal: 500,
      progressDone: 0,
    });

    // Simulate rapid job_progress messages (1 per video, every few ms)
    for (let i = 0; i < 500; i++) {
      useEditorStore.getState().updateJobProgressBatch([{ index: i, percent: 50 }]);
    }
    // Simulate all completing
    for (let i = 0; i < 500; i++) {
      useEditorStore.getState().markJobDone({ index: i });
    }

    const state = useEditorStore.getState();
    expect(state.queue.every((q) => q.status === "done")).toBe(true);
    expect(state.queue.every((q) => q.progress === 100)).toBe(true);
    expect(state.progressDone).toBe(500);
  });

  it("applies batched job progress with one store update", () => {
    const items = Array.from({ length: 500 }, (_, i) => queueItem(i));
    useEditorStore.setState({
      queue: items,
      isProcessing: true,
      progressTotal: 500,
      progressDone: 0,
    });

    let updates = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      updates++;
    });
    try {
      const messages = Array.from({ length: 500 }, (_, i) => ({ index: i, percent: 42 }));
      useEditorStore.getState().updateJobProgressBatch(messages);
    } finally {
      unsubscribe();
    }

    const state = useEditorStore.getState();
    expect(updates).toBe(1);
    expect(state.queue.every((q) => q.status === "processing")).toBe(true);
    expect(state.queue.every((q) => q.progress === 42)).toBe(true);
  });

  it("handles rapid error/done alternation without state corruption", () => {
    const items = Array.from({ length: 100 }, (_, i) => queueItem(i));
    useEditorStore.setState({
      queue: items,
      isProcessing: true,
      progressTotal: 100,
      progressDone: 0,
    });

    for (let i = 0; i < 100; i++) {
      if (i % 3 === 0) {
        useEditorStore.getState().markJobError({ index: i, error: "fail" });
      } else {
        useEditorStore.getState().markJobDone({ index: i });
      }
    }

    const state = useEditorStore.getState();
    const done = state.queue.filter((q) => q.status === "done").length;
    const errored = state.queue.filter((q) => q.status === "error").length;
    expect(done + errored).toBe(100);
    expect(state.progressDone).toBe(100);
  });

  it("log buffer stays bounded under heavy logging", () => {
    for (let i = 0; i < 500; i++) {
      useEditorStore.getState().appendLog(`Log line ${i}`);
    }
    expect(useEditorStore.getState().logLines.length).toBeLessThanOrEqual(200);
  });

  it("addVideos with 500 paths creates queue items correctly", async () => {
    const paths = Array.from({ length: 500 }, (_, i) => `C:\\videos\\v${i}.mp4`);
    await useEditorStore.getState().addVideos(paths, mockApi);
    expect(useEditorStore.getState().queue).toHaveLength(500);
  });

  it("_reapplyExcel with 200 videos and 5 template regions completes without error", () => {
    const items = Array.from({ length: 200 }, (_, i) => queueItem(i));
    const regions = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      label: `TEXT_${i + 1}`,
      region: { x: 0.1 * (i + 1), y: 0.2, w: 0.15, h: 0.08 },
    }));
    const rows = items.map((item, i) => {
      const row = { id: `video_${i}` };
      for (let r = 0; r < 5; r++) row[`TEXT_${r + 1}`] = `Text ${i}-${r}`;
      return row;
    });

    useEditorStore.setState({
      queue: items,
      templateRegions: regions,
      excelRows: rows,
      excelMapping: {
        idColumn: "id",
        columns: Object.fromEntries(regions.map((r, i) => [r.id, `TEXT_${i + 1}`])),
      },
    });

    const report = useEditorStore.getState()._reapplyExcel();
    expect(report.matched).toBe(200);
    expect(report.unmatched).toBe(0);
    const state = useEditorStore.getState();
    // Each video should have 5 text operations
    expect(state.queue[0].operations.length).toBe(5);
    expect(state.queue[199].operations[4].text).toBe("Text 199-4");
  });

  it("undo stack stays bounded at MAX_UNDO_STACK (50)", () => {
    const items = [queueItem(0)];
    useEditorStore.setState({ queue: items, selectedIdx: 0 });

    for (let i = 0; i < 80; i++) {
      useEditorStore.getState()._saveUndo();
    }
    expect(useEditorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });

  it("imageDataCache is pruned correctly when removing videos from a 100-video queue", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      ...queueItem(i),
      operations: [
        {
          id: `img-${i}`,
          mode: "image",
          imagePath: `C:\\img\\${i}.png`,
          region: { x: 0, y: 0, w: 0.1, h: 0.1 },
        },
      ],
    }));
    const cache = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`C:\\img\\${i}.png`, `data:image/png;base64,${i}`]),
    );
    useEditorStore.setState({ queue: items, imageDataCache: cache });

    // Remove 50 videos
    for (let i = 0; i < 50; i++) {
      useEditorStore.getState().removeVideo(0);
    }

    const state = useEditorStore.getState();
    expect(state.queue).toHaveLength(50);
    expect(Object.keys(state.imageDataCache).length).toBe(50);
  });

  it("buildJobFor produces valid job payloads for 200 videos", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      ...queueItem(i),
      operations: [
        {
          id: `op-${i}`,
          mode: "blur",
          region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          blurStrength: 20,
        },
      ],
    }));
    useEditorStore.setState({ queue: items });

    const jobs = items
      .map((item, i) => useEditorStore.getState()._buildJobFor(item, i))
      .filter(Boolean);
    expect(jobs).toHaveLength(200);
    expect(jobs[0].operations).toHaveLength(1);
    expect(jobs[199].id).toBe(199);
  });
});
