import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

globalThis.window = { api: {} };

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
  let handlers;
  let disconnect;
  afterEach(() => {
    disconnect?.();
    vi.useRealTimers();
  });
  function connect() {
    const api = Object.fromEntries(
      ["onJobProgress", "onComplete", "onJobError"].map((name) => [
        name,
        (cb) => {
          handlers[name] = cb;
          return () => {};
        },
      ]),
    );
    disconnect = useEditorStore.getState().connectProcessing(api);
  }
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {};
    useEditorStore.setState({
      queue: [],
      isProcessing: false,
      progressTotal: 0,
      progressDone: 0,
      jobProgress: {},
      batchSummary: null,
    });
  });

  it("applies batched job progress with one store update", () => {
    const items = Array.from({ length: 500 }, (_, i) => queueItem(i));
    useEditorStore.setState({
      queue: items,
      isProcessing: true,
      progressTotal: 500,
      progressDone: 0,
    });

    connect();
    let updates = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      updates++;
    });
    try {
      const messages = Array.from({ length: 500 }, (_, i) => ({ index: i, percent: 42 }));
      for (const msg of messages) handlers.onJobProgress(msg);
      vi.advanceTimersByTime(50);
    } finally {
      unsubscribe();
    }

    const state = useEditorStore.getState();
    expect(updates).toBe(1);
    expect(state.queue.every((q) => q.status === "processing")).toBe(true);
    expect(Object.keys(state.jobProgress)).toHaveLength(500);
    expect(Object.values(state.jobProgress).every((p) => p === 42)).toBe(true);
  });
});
