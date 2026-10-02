import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("processingSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("uses the queue index as the job id when processing a single video", async () => {
    useEditorStore.setState({
      queue: [
        makeQueueItem({ path: "C:\\videos\\a.mp4", filename: "a.mp4" }),
        makeQueueItem({ path: "C:\\videos\\b.mp4", filename: "b.mp4" }),
      ],
      selectedIdx: 1,
    });

    const res = await useEditorStore.getState().processSingle(1);

    expect(res.ok).toBe(true);
    expect(mockApi.startProcessing).toHaveBeenCalledTimes(1);
    const manifest = mockApi.startProcessing.mock.calls[0][0];
    expect(manifest.type).toBe("beru-job-manifest");
    expect(manifest.version).toBe(1);
    expect(manifest.jobs[0].id).toBe(1);
  });

  it("aborts processSingle when processing starts during video-info refresh", async () => {
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          path: "C:\\videos\\missing.mp4",
          filename: "missing.mp4",
          width: 0,
          height: 0,
        }),
      ],
    });

    const updatedQueue = [
      makeQueueItem({
        path: "C:\\videos\\missing.mp4",
        filename: "missing.mp4",
        width: 1280,
        height: 720,
      }),
    ];

    const refreshSpy = vi
      .spyOn(useEditorStore.getState(), "refreshMissingVideoInfo")
      .mockImplementation(async () => {
        useEditorStore.setState({ isProcessing: true });
        return updatedQueue;
      });

    const res = await useEditorStore.getState().processSingle(0);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Ya hay un proceso en ejecución");
    expect(mockApi.startProcessing).not.toHaveBeenCalled();

    refreshSpy.mockRestore();
  });

  it("processAll starts a job manifest on the happy path", async () => {
    useEditorStore.setState({
      queue: [makeQueueItem({ path: "C:\\videos\\demo.mp4", filename: "demo.mp4" })],
      outputDir: "C:\\output",
      sidebarMode: "logo",
    });

    const res = await useEditorStore.getState().processAll();

    expect(res).toEqual({ ok: true });
    expect(mockApi.startProcessing).toHaveBeenCalledTimes(1);
    const manifest = mockApi.startProcessing.mock.calls[0][0];
    expect(manifest).toMatchObject({ type: "beru-job-manifest", version: 1 });
    expect(manifest.jobs[0]).toMatchObject({
      id: 0,
      input_path: "C:\\videos\\demo.mp4",
    });
  });

  it("processAll materializes excel text into export jobs", async () => {
    useEditorStore.setState({
      queue: [makeQueueItem({ path: "C:\\videos\\clip.mp4", filename: "clip.mp4" })],
      outputDir: "C:\\output",
      sidebarMode: "logo",
      templateRegions: [{ id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }],
      excelRows: [{ id: "clip", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    const res = await useEditorStore.getState().processAll();

    expect(res.ok).toBe(true);
    const job = mockApi.startProcessing.mock.calls[0][0].jobs[0];
    expect(job.operations.some((op) => op.mode === "text" && op.text === "Desde Excel")).toBe(true);
  });

  it("processAll returns missing_dimensions when probe cannot fill size", async () => {
    mockApi.getVideoInfoBatch.mockResolvedValue([{ width: 0, height: 0 }]);
    useEditorStore.setState({
      queue: [makeQueueItem({ width: 0, height: 0, filename: "nodims.mp4" })],
    });

    const res = await useEditorStore.getState().processAll();

    expect(res.ok).toBe(false);
    expect(res.code).toBe("missing_dimensions");
    expect(mockApi.startProcessing).not.toHaveBeenCalled();
  });

  it("processAll returns busy when a run is already active", async () => {
    useEditorStore.setState({
      queue: [makeQueueItem()],
      isProcessing: true,
    });

    const res = await useEditorStore.getState().processAll();

    expect(res).toEqual({ ok: false, code: "busy" });
    expect(mockApi.startProcessing).not.toHaveBeenCalled();
  });
});
