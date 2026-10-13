import { beforeEach, expect, it } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { buildSessionSnapshot, parseSessionSnapshot } from "../src/utils/session-persist.js";
import { buildExportJob } from "../src/utils/export-pipeline.js";
import { clipTimeline } from "../shared/clip-timeline.js";

beforeEach(() =>
  useEditorStore.setState({
    queue: [
      createQueueItem({
        path: "C:\\media\\a.mp4",
        filename: "a.mp4",
        width: 320,
        height: 180,
        duration: 10,
        trimStart: 2,
        trimEnd: 8,
      }),
    ],
    selectedIdx: 0,
    undoStack: [],
    redoStack: [],
    isProcessing: false,
  }),
);

it("retimes a source window without changing the trim or processor telemetry", () => {
  const store = useEditorStore.getState();
  expect(store.setVideoTiming({ rate: 2 })).toBe(true);
  const state = useEditorStore.getState(),
    item = state.queue[0];
  expect(item.speed).toBeNull();
  expect(item.trimStart).toBe(2);
  const timeline = clipTimeline(item);
  expect(timeline.cycleDuration).toBe(3);
  expect(timeline.sourceToOutput(4)).toBe(1);
  expect(timeline.sourceToOutput(6)).toBe(2);
  expect(timeline.sourceToOutput(1)).toBeNull();
  const job = buildExportJob(item, 0, { outputPath: "C:\\out\\a.mp4" });
  expect(job.playback_rate).toBe(2);
  const restored = parseSessionSnapshot(buildSessionSnapshot(state));
  expect(restored.queue[0].timing.rate).toBe(2);
  store.undo();
  expect(useEditorStore.getState().queue[0].timing.rate).toBe(1);
  store.redo();
  expect(useEditorStore.getState().queue[0].timing.rate).toBe(2);
  store.setVideoTiming({ repeatCount: 3 });
  const repeated = clipTimeline(useEditorStore.getState().queue[0]);
  expect(repeated.totalDuration).toBe(9);
  expect(
    [0, 1, 2].map((cycle) => [
      repeated.sourceToOutput(4, cycle),
      repeated.sourceToOutput(6, cycle),
    ]),
  ).toEqual([
    [1, 2],
    [4, 5],
    [7, 8],
  ]);
  expect(
    buildExportJob(useEditorStore.getState().queue[0], 0, { outputPath: "C:\\out\\a.mp4" })
      .repeat_count,
  ).toBe(3);
  expect(useEditorStore.getState().queue).toHaveLength(1);
});

it("rejects an invalid edit without removing a valid timing or adding undo", () => {
  const store = useEditorStore.getState();
  store.setVideoTiming({ rate: 0.5 });
  for (const rate of [0, -1, Infinity, 5]) expect(store.setVideoTiming({ rate })).toBe(false);
  expect(useEditorStore.getState().queue[0].timing.rate).toBe(0.5);
  expect(useEditorStore.getState().undoStack).toHaveLength(1);
  useEditorStore.setState({ isProcessing: true });
  expect(store.setVideoTiming({ rate: 2 })).toBe(false);
});

it.each([
  [{ rate: 0.25 }, 2000, 1000, 1800],
  [{ repeatCount: 8 }, 1000, 500, 900],
])(
  "keeps a valid trim when timing %j would exceed the output limit",
  (timing, duration, end, limit) => {
    useEditorStore.setState({
      queue: [createQueueItem({ path: "C:/a.mp4", duration, trimEnd: end })],
    });
    const store = useEditorStore.getState();
    expect(store.setVideoTiming(timing)).toBe(true);
    const before = useEditorStore.getState();
    expect(clipTimeline(before.queue[0]).totalDuration).toBe(4000);
    store.setVideoTrim(0, 0, duration);
    expect(useEditorStore.getState().queue).toBe(before.queue);
    expect(useEditorStore.getState().undoStack).toBe(before.undoStack);
    store.setVideoTrim(0, 0, limit);
    expect(clipTimeline(useEditorStore.getState().queue[0]).totalDuration).toBe(7200);
  },
);

it.each(["undo", "redo"])(
  "rejects %s that would restore overlong timing after a trim change",
  (action) => {
    useEditorStore.setState({
      queue: [createQueueItem({ path: "C:/a.mp4", duration: 2000, trimEnd: 1000 })],
    });
    const store = useEditorStore.getState();
    store.setVideoTiming({ rate: 0.25 });
    if (action === "undo") store.setVideoTiming({ rate: 1 });
    else store.undo();
    store.setVideoTrim(0, 0, 2000);
    const before = useEditorStore.getState();
    store[action]();
    const after = useEditorStore.getState();
    expect(after.queue).toBe(before.queue);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    store.setVideoTrim(0, 0, 1000);
    store[action]();
    expect(useEditorStore.getState().queue[0].timing.rate).toBe(0.25);
  },
);
