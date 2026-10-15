import { afterEach, expect, it, vi } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { createExactPreview } from "../src/components/video-preview/exact-preview.js";

let preview;
afterEach(() => {
  preview?.dispose();
  vi.useRealTimers();
});
it("seeks the selected output cycle and discards the old artifact after a speed edit", async () => {
  vi.useFakeTimers();
  const video = new EventTarget();
  Object.assign(video, { currentTime: 6, paused: true });
  const item = createQueueItem({
    path: "C:/a.mp4",
    filename: "a.mp4",
    width: 320,
    height: 180,
    duration: 10,
    trimStart: 2,
    trimEnd: 8,
    timing: { rate: 2, repeatCount: 3 },
  });
  useEditorStore.setState({
    queue: [item],
    selectedIdx: 0,
    previewCycle: 2,
    sidebarMode: "batch",
    isProcessing: false,
    undoStack: [],
    redoStack: [],
  });
  const { timestamp: _timestamp, ...shape } = useEditorStore
    .getState()
    .buildPreviewFrameJob(0, video.currentTime);
  useEditorStore.setState({
    queue: [
      {
        ...item,
        exportSignature: JSON.stringify(shape),
        exportedOutputPath: "C:/out.mp4",
        exportedOutputStat: { size: 100, mtimeMs: 1 },
      },
    ],
  });
  let finish;
  window.api = {
    renderSourceFrame: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    renderPreviewFrame: vi.fn(async () => ({ ok: true, data_url: "CURRENT" })),
  };
  let visible;
  preview = createExactPreview({
    videoRef: { current: video },
    onChange: (state) => {
      visible = state;
    },
    t: (key) => key,
  });
  preview.toggle();
  expect(window.api.renderSourceFrame).toHaveBeenCalledWith(
    expect.objectContaining({ input_path: "C:/out.mp4", timestamp: 8 }),
  );
  useEditorStore.getState().setVideoTiming({ rate: 1 });
  finish({ ok: true, data_url: "OBSOLETE" });
  await Promise.resolve();
  await Promise.resolve();
  expect(visible.url).not.toBe("OBSOLETE");
  await vi.advanceTimersByTimeAsync(500);
  expect(window.api.renderPreviewFrame).toHaveBeenCalledWith(
    expect.objectContaining({ timestamp: 6, playback_rate: 1, repeat_count: 3 }),
  );
  expect(visible.url).toBe("CURRENT");
});
