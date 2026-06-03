import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
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
  error: null,
  ...overrides,
});

describe("processing error handling", () => {
  beforeEach(() => {
    useEditorStore.setState({
      queue: [queueItem(), queueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" })],
      progressDone: 0,
      progressTotal: 2,
    });
  });

  it("markJobError updates the queue item when index is valid", () => {
    useEditorStore.getState().markJobError({ index: 1, error: "FFmpeg failed" });

    const item = useEditorStore.getState().queue[1];
    expect(item.status).toBe("error");
    expect(item.error).toBe("FFmpeg failed");
    expect(useEditorStore.getState().progressDone).toBe(1);
  });

  it("markJobError ignores global errors without a queue index", () => {
    const before = useEditorStore.getState().queue;
    useEditorStore.getState().markJobError({ error: "ffmpeg not found" });

    expect(useEditorStore.getState().queue).toEqual(before);
    expect(useEditorStore.getState().progressDone).toBe(0);
  });

  it("markJobError ignores out-of-range indices", () => {
    useEditorStore.getState().markJobError({ index: 99, error: "bad index" });

    expect(useEditorStore.getState().queue.every((q) => q.status === "idle")).toBe(true);
  });
});
