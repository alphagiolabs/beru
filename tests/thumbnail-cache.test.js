import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  getThumbnail: vi.fn(async () => null),
  getThumbnailBatch: vi.fn(async () => []),
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
  operations: [],
  status: "idle",
  thumbnail: null,
  ...overrides,
});

describe("thumbnailsByPath cache", () => {
  beforeEach(() => {
    mockApi.getThumbnail.mockReset().mockResolvedValue(null);
    mockApi.getThumbnailBatch.mockReset().mockResolvedValue([]);
    mockApi.getVideoInfoBatch.mockReset().mockResolvedValue([]);
    useEditorStore.setState({
      queue: [],
      selectedIdx: -1,
      thumbnailsByPath: {},
      excelMatchStatus: {},
    });
  });

  it("coalesces concurrent thumbnail results into a single store update", async () => {
    const items = ["a", "b", "c"].map((n) =>
      queueItem({ path: `C:\\videos\\${n}.mp4`, filename: `${n}.mp4` }),
    );
    useEditorStore.setState({ queue: items, selectedIdx: 0 });
    mockApi.getThumbnail.mockImplementation(async (path) => ({ dataUrl: `data:${path}` }));

    let thumbUpdates = 0;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.thumbnailsByPath !== prev.thumbnailsByPath) thumbUpdates++;
    });

    await useEditorStore.getState().prioritizeThumbnails(
      items.map((i) => i.path),
      {},
      mockApi,
    );
    await vi.waitFor(() => {
      expect(Object.keys(useEditorStore.getState().thumbnailsByPath)).toHaveLength(3);
    });

    expect(thumbUpdates).toBe(1);
    expect(useEditorStore.getState().thumbnailsByPath["C:\\videos\\b.mp4"]).toBe(
      "data:C:\\videos\\b.mp4",
    );
    unsub();
  });

  it("stores batch thumbnail results for queued videos", async () => {
    mockApi.getThumbnailBatch.mockResolvedValue([
      { dataUrl: "data:a" },
      { dataUrl: "data:b" },
      { dataUrl: "data:c" },
    ]);

    await useEditorStore
      .getState()
      .addVideos(["C:\\videos\\a.mp4", "C:\\videos\\b.mp4", "C:\\videos\\c.mp4"], mockApi);

    await vi.waitFor(() => {
      expect(useEditorStore.getState().thumbnailsByPath).toEqual({
        "C:\\videos\\a.mp4": "data:a",
        "C:\\videos\\b.mp4": "data:b",
        "C:\\videos\\c.mp4": "data:c",
      });
    });
  });

  it("drops results for videos removed before the thumbnail resolves", async () => {
    useEditorStore.setState({
      queue: [queueItem({ path: "C:\\videos\\a.mp4", filename: "a.mp4" })],
    });
    let resolveThumb;
    mockApi.getThumbnail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveThumb = resolve;
        }),
    );

    const pending = useEditorStore
      .getState()
      .prioritizeThumbnails(["C:\\videos\\a.mp4"], {}, mockApi);
    useEditorStore.getState().removeVideo(0);
    resolveThumb({ dataUrl: "data:a" });
    await pending;
    await Promise.resolve();

    expect(useEditorStore.getState().thumbnailsByPath["C:\\videos\\a.mp4"]).toBeUndefined();
  });

  it("evicts oldest entries beyond the cache cap", async () => {
    const items = Array.from({ length: 2050 }, (_, i) =>
      queueItem({ path: `C:\\videos\\${i}.mp4`, filename: `${i}.mp4` }),
    );
    useEditorStore.setState({ queue: items });
    mockApi.getThumbnail.mockImplementation(async (path) => ({ dataUrl: `data:${path}` }));

    await useEditorStore.getState().prioritizeThumbnails(
      items.map((i) => i.path),
      {},
      mockApi,
    );
    await vi.waitFor(() => {
      expect(Object.keys(useEditorStore.getState().thumbnailsByPath)).toHaveLength(2000);
    });

    const map = useEditorStore.getState().thumbnailsByPath;
    expect(map["C:\\videos\\0.mp4"]).toBeUndefined();
    expect(map["C:\\videos\\49.mp4"]).toBeUndefined();
    expect(map["C:\\videos\\50.mp4"]).toBe("data:C:\\videos\\50.mp4");
    expect(map["C:\\videos\\2049.mp4"]).toBe("data:C:\\videos\\2049.mp4");
  });
});
