import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";
import { hasUnexportedWork } from "../src/utils/session-persist.js";
import { applyJobDone, buildExportJob } from "../src/utils/export-pipeline.js";

const mockApi = installMockApi({ ...createMockApi(), setUnexportedWork: vi.fn(async () => true) });

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("operation editing (undo + addOperation)", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("live region drag can skip undo snapshots (recordHistory: false)", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      selectedIdx: 0,
      undoStack: [],
      queue: [
        makeQueueItem({
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

    useEditorStore.getState()._saveUndo();
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

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

    useEditorStore.getState().updateOperationRegion(0, { ...region, x: 0.5 });
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
  });

  it("addOperation rejects image and empty text ops in logo mode", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
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

  it("addOperation adds a Fechero only with a valid start, undoably", () => {
    const region = { x: 0.1, y: 0.05, w: 0.5, h: 0.08 };
    useEditorStore.setState({ queue: [makeQueueItem()], selectedIdx: 0, currentRegion: region });

    useEditorStore.getState().setTempClock({ clockStart: "2026-13-01T00:00" });
    useEditorStore.getState().addOperation("datetime");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);

    useEditorStore
      .getState()
      .setTempClock({ clockStart: "2026-10-06T12:04:13", clockFormat: "time" });
    useEditorStore.getState().addOperation("datetime");
    const [op] = useEditorStore.getState().queue[0].operations;
    expect(op).toMatchObject({
      mode: "datetime",
      region,
      clockStart: "2026-10-06T12:04:13",
      clockFormat: "time",
      clockLayout: "single",
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);
  });

  it("applyDvrStampStyle sets the reference style, size and region for the video", () => {
    useEditorStore.setState({
      queue: [makeQueueItem({ width: 1920, height: 1080 })],
      selectedIdx: 0,
    });
    useEditorStore.getState().applyDvrStampStyle();
    const s = useEditorStore.getState();
    expect(s).toMatchObject({
      fontFamily: "Segoe UI",
      textScaleX: 2.06,
      textFontSize: 64,
      bgOpacity: 0.43,
      boxBorderWidth: 0,
      safeMargin: 0,
    });
    expect(s.currentRegion).toMatchObject({ x: 0.103, y: 0.055, w: 0.621, h: 0.098 });
    expect(s.tempClock.clockLayout).toBe("single");
  });
});

describe("export currency after editing", () => {
  beforeEach(() => {
    resetEditorState(useEditorStore, mockApi, {
      queue: [makeQueueItem({ duration: 4, audioCodec: "aac" })],
      selectedIdx: 0,
      undoStack: [],
      redoStack: [],
      encodeProfile: "balanced",
      watermark: { enabled: false },
      outputDir: "C:/out",
    });
    const state = useEditorStore.getState();
    const job = buildExportJob(state.queue[0], 0, {
      outputPath: state.outputPathsForAll()[0],
      encodeProfile: state.encodeProfile,
      watermark: null,
    });
    useEditorStore.setState(
      applyJobDone({
        ...state,
        progressTotal: 1,
        exportSignatures: { 0: JSON.stringify(job) },
        msg: { index: 0, output: "C:/out/sample__2.mp4" },
      }),
    );
  });

  it("warns about edits after export and recognizes undo back to the exported state", () => {
    expect(hasUnexportedWork(useEditorStore.getState())).toBe(false);
    useEditorStore.getState().setVideoAudio({ gain: 0.5 });
    expect(hasUnexportedWork(useEditorStore.getState())).toBe(true);
    expect(useEditorStore.getState().queue[0].exportedOutputPath).toBe("C:/out/sample__2.mp4");
    useEditorStore.getState().undo();
    expect(hasUnexportedWork(useEditorStore.getState())).toBe(false);
  });

  it.each([
    { encodeProfile: "quality" },
    { outputDir: "C:/other" },
    { watermark: { enabled: true, type: "text", text: "New mark" } },
  ])("detects changes to export settings: %j", (patch) => {
    useEditorStore.setState(patch);
    expect(hasUnexportedWork(useEditorStore.getState())).toBe(true);
    expect(mockApi.setUnexportedWork).toHaveBeenLastCalledWith(true);
  });
});
