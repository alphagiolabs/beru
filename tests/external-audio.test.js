import { describe, it, expect } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { buildSessionSnapshot, parseSessionSnapshot } from "../src/utils/session-persist.js";
import { buildExportJob } from "../src/utils/export-pipeline.js";

describe("external audio editing contract", () => {
  it("preserves an asset through undo, Session and the Job without changing source or Excel", () => {
    const item = createQueueItem({
      path: "C:\\media\\a.mp4",
      filename: "a.mp4",
      width: 320,
      height: 180,
      duration: 4,
    });
    const asset = {
      path: "C:\\media\\music.wav",
      name: "music.wav",
      duration: 3,
      mode: "mix",
      offset: 1,
      trimStart: 0.5,
      trimEnd: 2.5,
      gain: 0.75,
      version: "",
    };
    useEditorStore.setState({
      queue: [item],
      selectedIdx: 0,
      isProcessing: false,
      undoStack: [],
      redoStack: [],
      excelRows: [{ ID: "a" }],
    });
    useEditorStore.getState().setExternalAudio(asset);
    useEditorStore.getState().setExternalAudio({ mode: "replace" });
    useEditorStore.getState().undo();
    let state = useEditorStore.getState();
    expect(state.queue[0].externalAudio).toEqual(asset);
    const restored = parseSessionSnapshot(buildSessionSnapshot(state));
    const job = buildExportJob(restored.queue[0], 0, { outputPath: "C:\\out\\a.mp4" });
    expect(job.external_audio).toEqual({
      path: asset.path,
      mode: "mix",
      offset: 1,
      trim_start: 0.5,
      trim_end: 2.5,
      gain: 0.75,
    });
    expect(restored.queue[0].path).toBe(item.path);
    expect(state.excelRows).toEqual([{ ID: "a" }]);
    useEditorStore.getState().setExternalAudio(null);
    expect(useEditorStore.getState().queue[0].externalAudio).toBeNull();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].externalAudio).toEqual(asset);
  });

  it("rejects invalid ranges and edits during a run; legacy sessions have no asset", () => {
    const item = createQueueItem({
      path: "C:\\media\\a.mp4",
      filename: "a.mp4",
      width: 320,
      height: 180,
      duration: 4,
    });
    useEditorStore.setState({
      queue: [item],
      selectedIdx: 0,
      isProcessing: false,
      undoStack: [],
      redoStack: [],
    });
    useEditorStore
      .getState()
      .setExternalAudio({ path: "C:\\media\\a.wav", trimStart: 2, trimEnd: 1 });
    expect(useEditorStore.getState().queue[0].externalAudio).toBeNull();
    useEditorStore.setState({ isProcessing: true });
    useEditorStore.getState().setExternalAudio({ path: "C:\\media\\a.wav" });
    expect(useEditorStore.getState().queue[0].externalAudio).toBeNull();
    expect(
      parseSessionSnapshot({ version: 1, queue: [{ ...item, externalAudio: undefined }] }).queue[0]
        .externalAudio,
    ).toBeNull();
  });
});
