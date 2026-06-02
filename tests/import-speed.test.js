import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  getVideoInfoBatch: vi.fn(),
  getThumbnailBatch: vi.fn(async () => []),
};

globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("optimistic video import", () => {
  beforeEach(() => {
    mockApi.getVideoInfoBatch.mockReset();
    mockApi.getThumbnailBatch.mockReset();
    mockApi.getThumbnailBatch.mockResolvedValue([]);
    useEditorStore.setState({ queue: [], selectedIdx: -1 });
  });

  it("adds videos to the queue before metadata probing finishes", async () => {
    let resolver;
    mockApi.getVideoInfoBatch.mockImplementation(
      () => new Promise((r) => { resolver = r; }),
    );

    const addPromise = useEditorStore.getState().addVideos(["C:\\videos\\a.mp4"], mockApi);

    expect(useEditorStore.getState().queue).toHaveLength(1);
    expect(useEditorStore.getState().queue[0].filename).toBe("a.mp4");
    expect(useEditorStore.getState().queue[0].width).toBe(0);

    resolver([{
      width: 1280,
      height: 720,
      duration: 42,
      videoCodec: "h264",
      pixFmt: "yuv420p",
      frameRate: 30,
      audioCodec: "aac",
    }]);
    await addPromise;
    await vi.waitFor(() => {
      expect(useEditorStore.getState().queue[0].width).toBe(1280);
    });
    expect(useEditorStore.getState().queue[0].duration).toBe(42);
  });
});