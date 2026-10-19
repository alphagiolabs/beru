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
});
