import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildLogoPreviewJob } from "../src/utils/delogo-ops.js";
import { createJobSignatureCache, previewJobInputSnapshot } from "../src/utils/job-signature.js";
import { prepareRun } from "../src/utils/export-run.js";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("queueSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("applies pending metadata to the surviving video after an earlier item is removed", async () => {
    let resolveProbe;
    mockApi.getVideoInfoBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const importing = useEditorStore
      .getState()
      .addVideos(["C:\\v\\a.mp4", "C:\\v\\b.mp4"], mockApi);
    useEditorStore.getState().removeVideo(0);
    resolveProbe([
      { width: 640, height: 360 },
      { width: 1280, height: 720, duration: 12 },
    ]);
    await importing;
    expect(useEditorStore.getState().queue).toHaveLength(1);
    expect(useEditorStore.getState().queue[0]).toMatchObject({
      path: "C:\\v\\b.mp4",
      width: 1280,
      height: 720,
      duration: 12,
    });
  });

  it("ignores metadata from a cleared import when the same path is imported again", async () => {
    let resolveOldProbe;
    mockApi.getVideoInfoBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldProbe = resolve;
        }),
    );
    const oldImport = useEditorStore.getState().addVideos(["C:\\v\\a.mp4"], mockApi);
    useEditorStore.getState().clearQueue();
    mockApi.getVideoInfoBatch.mockResolvedValueOnce([{ width: 1280, height: 720, duration: 20 }]);
    await useEditorStore.getState().addVideos(["C:\\v\\a.mp4"], mockApi);
    resolveOldProbe([{ width: 640, height: 360, duration: 10 }]);
    await oldImport;
    expect(useEditorStore.getState().queue[0]).toMatchObject({
      width: 1280,
      height: 720,
      duration: 20,
    });
  });

  it("reuses output names during progress updates and invalidates them after a rename", () => {
    const { getCellTextForRegion, getExcelDisplayId } = useEditorStore.getState();
    try {
      const cellText = vi.fn(() => "Title");
      useEditorStore.setState({
        queue: [makeQueueItem({ path: "C:\\v\\a.mp4" })],
        templateRegions: [{ id: 1, label: "TEXT_1" }],
        getCellTextForRegion: cellText,
        getExcelDisplayId: () => "a",
      });
      const original = useEditorStore.getState().outputPathsForAll();
      cellText.mockClear();
      useEditorStore.setState((s) => ({
        queue: s.queue.map((item) => ({ ...item, status: "processing", progress: 50 })),
      }));
      expect(useEditorStore.getState().outputPathsForAll()).toEqual(original);
      expect(cellText).not.toHaveBeenCalled();
      useEditorStore.setState((s) => ({
        queue: s.queue.map((item) => ({ ...item, customOutputName: "renamed.mp4" })),
      }));
      expect(useEditorStore.getState().outputPathsForAll()).toEqual(["C:\\v\\renamed.mp4"]);
    } finally {
      useEditorStore.setState({ getCellTextForRegion, getExcelDisplayId });
    }
  });

  it("releases removed videos and chunks the remaining grants when clearing a large queue", () => {
    const releaseVideoPaths = vi.fn(async () => true);
    mockApi.releaseVideoPaths = releaseVideoPaths;
    const paths = Array.from({ length: 1002 }, (_, i) => `C:\\v\\${i}.mp4`);
    try {
      useEditorStore.setState({ queue: paths.map((path) => makeQueueItem({ path })) });
      useEditorStore.getState().removeVideo(0);
      expect(releaseVideoPaths.mock.calls).toEqual([[paths.slice(0, 1)]]);
      useEditorStore.getState().clearQueue();
      expect(releaseVideoPaths.mock.calls.map(([batch]) => batch.length)).toEqual([1, 500, 500, 1]);
      expect(releaseVideoPaths.mock.calls.flatMap(([batch]) => batch)).toEqual(paths);
    } finally {
      delete mockApi.releaseVideoPaths;
    }
  });

  it("invalidates cached names when the text operation changes", () => {
    const region = { x: 0, y: 0, w: 0.2, h: 0.2 };
    useEditorStore.setState({
      templateRegions: [{ id: 1, label: "TEXT_1", region }],
      queue: [
        makeQueueItem({
          path: "C:\\v\\a.mp4",
          filename: "a.mp4",
          operations: [{ mode: "text", batchRegionId: 1, region, text: "Old" }],
        }),
      ],
    });
    expect(useEditorStore.getState().outputPathsForAll()).toEqual(["C:\\v\\a_Old.mp4"]);
    useEditorStore.setState((s) => ({
      queue: s.queue.map((item) => ({
        ...item,
        operations: [{ ...item.operations[0], text: "New" }],
      })),
    }));
    expect(useEditorStore.getState().outputPathsForAll()).toEqual(["C:\\v\\a_New.mp4"]);
  });

  it("addVideos populates the queue and selects the first item", async () => {
    mockApi.getVideoInfoBatch.mockResolvedValueOnce([
      {
        width: 1920,
        height: 1080,
        duration: 42,
        videoCodec: "h264",
        pixFmt: "yuv420p",
        frameRate: 30,
        audioCodec: "aac",
      },
    ]);

    await useEditorStore.getState().addVideos(["C:\\videos\\clip.mp4"], mockApi);

    expect(useEditorStore.getState().queue).toHaveLength(1);
    await vi.waitFor(() => {
      expect(useEditorStore.getState().queue[0].width).toBe(1920);
    });
    const state = useEditorStore.getState();

    expect(state.queue[0]).toEqual(
      expect.objectContaining({
        path: "C:\\videos\\clip.mp4",
        filename: "clip.mp4",
        width: 1920,
        height: 1080,
        duration: 42,
      }),
    );
    expect(state.selectedIdx).toBe(0);
  });

  it("addVideos keeps items and warns when video info probe fails", async () => {
    const showToast = vi.fn();
    useEditorStore.setState({ showToast });
    mockApi.getVideoInfoBatch.mockRejectedValueOnce(new Error("ffprobe failed"));

    await useEditorStore.getState().addVideos(["C:\\videos\\clip.mp4"], mockApi);

    expect(useEditorStore.getState().queue).toHaveLength(1);
    expect(useEditorStore.getState().queue[0]).toEqual(
      expect.objectContaining({
        path: "C:\\videos\\clip.mp4",
        filename: "clip.mp4",
        width: 0,
        height: 0,
        duration: 0,
      }),
    );
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast.mock.calls[0][0]).toEqual({
      kind: "warn",
      text: "No se pudo leer la información de 1 video(s). Comprueba ffprobe/ffmpeg e inténtalo de nuevo.",
    });
  });

  it("imports more than 500 videos without exceeding the IPC batch limit", async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `C:\\videos\\${i}.mp4`);
    mockApi.getVideoInfoBatch.mockImplementation(async (batch) => {
      if (batch.length > 500) throw new Error("Demasiados videos");
      return batch.map((path) => ({
        width: 640,
        height: 360,
        duration: Number(path.match(/(\d+)\.mp4$/)[1]) + 1,
      }));
    });
    await useEditorStore.getState().addVideos(paths, mockApi);
    expect(
      useEditorStore.getState().queue.every((item) => item.width === 640 && item.height === 360),
    ).toBe(true);
    expect(useEditorStore.getState().queue[500].duration).toBe(501);
  });

  it("refreshes large batches and retries individual probes when a chunk fails", async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `C:\\videos\\${i}.mp4`);
    useEditorStore.setState({
      queue: paths.map((path) => makeQueueItem({ path, width: 0, height: 0 })),
    });
    const api = {
      getVideoInfoBatch: async (batch) => {
        if (batch.length > 500 || batch.includes(paths[500])) throw new Error("probe failed");
        return batch.map(() => ({ width: 640, height: 360 }));
      },
      getVideoInfo: async () => ({ width: 1280, height: 720 }),
    };
    const refreshed = await useEditorStore.getState().refreshMissingVideoInfo(api);
    expect(refreshed[0].width).toBe(640);
    expect(refreshed[500].width).toBe(1280);
  });

  it("refreshes missing video dimensions before building jobs", async () => {
    mockApi.getVideoInfoBatch.mockResolvedValueOnce([
      {
        width: 1280,
        height: 720,
        duration: 12.5,
        videoCodec: "h264",
        pixFmt: "yuv420p",
        frameRate: 30,
        audioCodec: "aac",
      },
    ]);
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          path: "C:\\videos\\missing.mp4",
          filename: "missing.mp4",
          width: 0,
          height: 0,
        }),
        makeQueueItem({
          path: "C:\\videos\\ready.mp4",
          filename: "ready.mp4",
          width: 1920,
          height: 1080,
        }),
      ],
    });

    const refreshed = await useEditorStore.getState().refreshMissingVideoInfo(mockApi);
    const job = prepareRun({ queue: refreshed, videoIdx: 0 }).jobs[0];

    expect(mockApi.getVideoInfoBatch).toHaveBeenCalledWith(["C:\\videos\\missing.mp4"]);
    expect(refreshed[0]).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        duration: 12.5,
        videoCodec: "h264",
        frameRate: 30,
        audioCodec: "aac",
      }),
    );
    expect(refreshed[1].width).toBe(1920);
    expect(job).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        source_width: 1280,
        source_height: 720,
      }),
    );
    expect(refreshed[0].sourceWidth).toBe(1280);
    expect(refreshed[0].sourceHeight).toBe(720);
  });

  it("clearQueue empties the queue and resets selection state", () => {
    useEditorStore.setState({
      queue: [
        makeQueueItem({ path: "C:\\videos\\a.mp4", filename: "a.mp4" }),
        makeQueueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      selectedIdx: 1,
      selectedOperationIdx: 0,
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      undoStack: [[{ id: "op-1", mode: "blur", region: null }]],
      redoStack: [[{ id: "op-2", mode: "blur", region: null }]],
      excelMatchStatus: { 0: "matched", 1: "unmatched" },
      batchSummary: { total: 2, succeeded: 1, failed: 1 },
      templateIdx: 0,
    });

    const cleared = useEditorStore.getState().clearQueue();
    const state = useEditorStore.getState();

    expect(cleared).toBe(true);
    expect(state.queue).toEqual([]);
    expect(state.selectedIdx).toBe(-1);
    expect(state.selectedOperationIdx).toBeNull();
    expect(state.currentRegion).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.excelMatchStatus).toEqual({});
    expect(state.batchSummary).toBeNull();
    expect(state.templateIdx).toBe(-1);
  });

  it("clearQueue is a no-op on an empty queue", () => {
    useEditorStore.setState({ queue: [], selectedIdx: -1 });

    const cleared = useEditorStore.getState().clearQueue();

    expect(cleared).toBe(false);
    expect(useEditorStore.getState().queue).toEqual([]);
  });

  it("outputPathFor agrees with outputPathsForAll under deliberate collisions", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      templateRegions: [],
      queue: [
        makeQueueItem({ path: "C:\\v\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\b\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\c\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\d\\other.mp4", filename: "other.mp4" }),
        makeQueueItem({ path: "C:\\v\\e\\promo.final.mov", filename: "promo.final.mov" }),
        makeQueueItem({ path: "C:\\v\\f\\promo.final.mov", filename: "promo.final.mov" }),
        makeQueueItem({ path: "C:\\v\\g\\solo.webm", filename: "solo.webm" }),
      ],
    });
    const get = useEditorStore.getState();
    const all = get.outputPathsForAll();
    expect(all).toHaveLength(get.queue.length);
    expect(all).toEqual([
      "C:\\out\\clip_beru.mp4",
      "C:\\out\\clip_beru__2.mp4",
      "C:\\out\\clip_beru__3.mp4",
      "C:\\out\\other_beru.mp4",
      "C:\\out\\promo.final_beru.mp4",
      "C:\\out\\promo.final_beru__2.mp4",
      "C:\\out\\solo_beru.mp4",
    ]);
    expect(get.queue.map((q) => get.outputPathFor(q))).toEqual(all);
  });

  it("outputPathFor stays correct after the output folder and format change", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      templateRegions: [],
      queue: [
        makeQueueItem({ path: "C:\\v\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\b\\clip.mp4", filename: "clip.mp4" }),
      ],
    });
    expect(useEditorStore.getState().outputPathFor(useEditorStore.getState().queue[1])).toBe(
      "C:\\out\\clip_beru__2.mp4",
    );

    useEditorStore.setState({ exportFormat: "webm" });
    const afterFormat = useEditorStore.getState();
    expect(afterFormat.outputPathFor(afterFormat.queue[0])).toBe("C:\\out\\clip_beru.webm");
    expect(afterFormat.outputPathFor(afterFormat.queue[1])).toBe("C:\\out\\clip_beru__2.webm");

    useEditorStore.setState({ outputDir: "D:\\exports\\" });
    const afterDir = useEditorStore.getState();
    expect(afterDir.outputPathFor(afterDir.queue[0])).toBe("D:\\exports\\clip_beru.webm");
    expect(afterDir.outputPathFor(afterDir.queue[1])).toBe("D:\\exports\\clip_beru__2.webm");
  });

  it("outputPathFor resolves a detached item without disturbing the queue cache", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      templateRegions: [],
      queue: [
        makeQueueItem({ path: "C:\\v\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\b\\clip.mp4", filename: "clip.mp4" }),
      ],
    });
    const get = useEditorStore.getState();
    const clone = { ...get.queue[0], operations: [{ mode: "blur", blurStrength: 42 }] };
    expect(get.outputPathFor(clone)).toBe("C:\\out\\clip_beru.mp4");
    expect(get.outputPathsForAll()).toEqual([
      "C:\\out\\clip_beru.mp4",
      "C:\\out\\clip_beru__2.mp4",
    ]);
    expect(get.outputPathFor(get.queue[1])).toBe("C:\\out\\clip_beru__2.mp4");
  });

  it("buildPreviewFrameJob uses the ranked output path outputPathsForAll resolves", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      templateRegions: [
        { id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, style: {} },
      ],
      queue: [
        makeQueueItem({ path: "C:\\v\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\b\\clip.mp4", filename: "clip.mp4" }),
      ],
    });
    const get = useEditorStore.getState();
    const all = get.outputPathsForAll();
    expect(all[0]).not.toBe(all[1]);
    expect(get.buildPreviewFrameJob(0, 1.5)?.output_path).toBe(all[0]);
    expect(get.buildPreviewFrameJob(1, 1.5)?.output_path).toBe(all[1]);
    const clone = { ...get.queue[1], operations: [] };
    expect(get.outputPathFor(clone)).toBe(all[1]);
    const job = get.buildPreviewFrameJob(0, 1.5);
    expect(job.timestamp).toBe(1.5);
    expect(Object.keys(job).at(-1)).toBe("timestamp");
  });

  it("preview output paths rank duplicate queue paths with each item's own name", () => {
    const textOp = (text) => ({
      id: text,
      mode: "text",
      batchRegionId: "r1",
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
      text,
    });
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      templateRegions: [
        { id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, style: {} },
      ],
      queue: [
        makeQueueItem({ path: "C:\\v\\a.mp4", filename: "a.mp4", operations: [textOp("Uno")] }),
        makeQueueItem({ path: "C:\\v\\a.mp4", filename: "a.mp4", operations: [textOp("Dos")] }),
      ],
    });
    const get = useEditorStore.getState();
    const all = get.outputPathsForAll();
    expect(all).toEqual(["C:\\out\\a_Uno.mp4", "C:\\out\\a_Dos.mp4"]);
    expect(get.buildPreviewFrameJob(0, 1)?.output_path).toBe(all[0]);
    expect(get.buildPreviewFrameJob(1, 1)?.output_path).toBe(all[1]);
  });

  it("cached preview signatures are byte-identical to a fresh stringify", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      templateRegions: [
        { id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, style: {} },
      ],
      excelRows: [{ id: "clip", TEXT_1: "Hola" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      queue: [
        makeQueueItem({ path: "C:\\v\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\v\\b\\clip.mp4", filename: "clip.mp4" }),
      ],
    });
    const draft = {
      mode: "blur",
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      blurStrength: 30,
    };
    const cache = createJobSignatureCache();
    for (const ts of [0, 1.5, 2.5, 0.033]) {
      const get = useEditorStore.getState();
      const fresh = () => buildLogoPreviewJob(get.buildPreviewFrameJob(1, ts), draft);
      expect(cache(previewJobInputSnapshot(get, 1, draft), ts, fresh)).toBe(
        JSON.stringify(fresh()),
      );
    }
  });
});
