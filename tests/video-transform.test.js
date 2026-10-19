import { describe, it, expect, beforeEach } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { parseSessionSnapshot } from "../src/utils/session-persist.js";

const item = (overrides = {}) =>
  createQueueItem({
    path: "C:\\media\\a.mp4",
    filename: "a.mp4",
    width: 1280,
    height: 720,
    duration: 6,
    ...overrides,
  });

const blur = {
  id: "b1",
  mode: "blur",
  region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  blurStrength: 20,
  startTime: null,
  endTime: null,
};

describe("video transform — store", () => {
  beforeEach(() => {
    useEditorStore.setState({
      queue: [item({ operations: [] })],
      selectedIdx: 0,
      selectedOperationIdx: null,
      undoStack: [],
      redoStack: [],
      isProcessing: false,
    });
  });

  it("a rotation is one undoable step and redo brings it back", () => {
    const { setVideoTransform, undo, redo } = useEditorStore.getState();
    setVideoTransform({ rotation: 90 });
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(90);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    undo();
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(0);
    redo();
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(90);
  });

  it("undo restores operations and transform together", () => {
    useEditorStore.setState({ queue: [item({ operations: [blur] })] });
    useEditorStore.getState().setVideoTransform({ flipH: true });
    useEditorStore.getState().updateOperation(0, 0, { blurStrength: 40 });

    useEditorStore.getState().undo();
    let state = useEditorStore.getState();
    expect(state.queue[0].operations[0].blurStrength).toBe(20);
    expect(state.queue[0].transform.flipH).toBe(true);

    useEditorStore.getState().undo();
    state = useEditorStore.getState();
    expect(state.queue[0].transform.flipH).toBe(false);
    expect(state.queue[0].operations[0].blurStrength).toBe(20);
  });

  it("a change to the same value records nothing", () => {
    useEditorStore.getState().setVideoTransform({ rotation: 0, flipV: false });
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it("is ignored while a run is processing", () => {
    useEditorStore.setState({ isProcessing: true });
    useEditorStore.getState().setVideoTransform({ rotation: 180 });
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(0);
  });

  it("sets an output height and clears it back to the original size", () => {
    useEditorStore.getState().setVideoTransform({ outputHeight: 480 });
    expect(useEditorStore.getState().queue[0].transform.outputHeight).toBe(480);
    useEditorStore.getState().setVideoTransform({ outputHeight: null });
    expect(useEditorStore.getState().queue[0].transform.outputHeight).toBeNull();
  });
});

describe("video transform — session", () => {
  const session = (queueItem) => ({ version: 1, queue: [queueItem], outputDir: null });
  const base = {
    path: "C:\\media\\a.mp4",
    filename: "a.mp4",
    width: 1280,
    height: 720,
    operations: [],
  };

  it("restores a stored transform", () => {
    const restored = parseSessionSnapshot(
      session({ ...base, transform: { rotation: 270, flipV: true, outputHeight: 480 } }),
    );
    expect(restored.queue[0].transform).toEqual({
      rotation: 270,
      flipH: false,
      flipV: true,
      outputHeight: 480,
      outputWidth: null,
      fitMode: "pad",
    });
  });

  it("sessions saved before the transform existed restore as identity", () => {
    const restored = parseSessionSnapshot(session(base));
    expect(restored.queue[0].transform).toEqual({
      rotation: 0,
      flipH: false,
      flipV: false,
      outputHeight: null,
      outputWidth: null,
      fitMode: "pad",
    });
  });
});
