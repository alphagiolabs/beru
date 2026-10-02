import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildLogoPreviewJob } from "../src/utils/delogo-ops.js";
import { createJobSignatureCache, previewJobInputSnapshot } from "../src/utils/job-signature.js";
import { prepareRun } from "../src/utils/export-run.js";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("queueSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

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
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
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
    expect(state.imageDataCache).toEqual({});
    expect(state.batchSummary).toBeNull();
    expect(state.templateIdx).toBe(-1);
  });

  it("clearQueue is a no-op on an empty queue", () => {
    useEditorStore.setState({ queue: [], selectedIdx: -1 });

    const cleared = useEditorStore.getState().clearQueue();

    expect(cleared).toBe(false);
    expect(useEditorStore.getState().queue).toEqual([]);
  });

  it("prunes imageDataCache when a video is removed from the queue", () => {
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "img-1",
              mode: "image",
              imagePath: "C:\\img\\a.png",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
            },
          ],
        }),
        makeQueueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
    });

    useEditorStore.getState().removeVideo(0);

    expect(useEditorStore.getState().imageDataCache).toEqual({});
  });

  it("prunes imageDataCache when an image operation is removed", () => {
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "img-1",
              mode: "image",
              imagePath: "C:\\img\\a.png",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
            },
          ],
        }),
      ],
      imageDataCache: { "C:\\img\\a.png": "data:image/png;base64,abc" },
    });

    useEditorStore.getState().removeOperationAt(0, 0);

    expect(useEditorStore.getState().imageDataCache).toEqual({});
  });

  it("outputPathFor suffixes colliding basenames in the same batch", () => {
    useEditorStore.setState({
      outputDir: "C:\\out",
      exportFormat: "mp4",
      templateRegions: [],
      queue: [
        makeQueueItem({ path: "C:\\videos\\a\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\videos\\b\\clip.mp4", filename: "clip.mp4" }),
        makeQueueItem({ path: "C:\\videos\\c\\other.mp4", filename: "other.mp4" }),
      ],
    });
    const get = useEditorStore.getState();
    expect(get.outputPathFor(get.queue[0])).toBe("C:\\out\\clip_beru.mp4");
    expect(get.outputPathFor(get.queue[1])).toBe("C:\\out\\clip_beru__2.mp4");
    expect(get.outputPathFor(get.queue[2])).toBe("C:\\out\\other_beru.mp4");
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
