import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = { getThumbnail: vi.fn(), getThumbnailBatch: vi.fn(), getVideoInfoBatch: vi.fn() };
window.api = api;
const { default: QueueSidebar } = await import("../src/components/QueueSidebar.jsx");
const item = (name) =>
  createQueueItem({
    path: `C:\\videos\\${name}.mp4`,
    filename: `${name}.mp4`,
    width: 1920,
    height: 1080,
    duration: 12,
  });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("visible queue thumbnails", () => {
  let root;
  let container;
  let callback;
  beforeEach(() => {
    useEditorStore.getState().clearQueue();
    vi.clearAllMocks();
    api.getThumbnail.mockResolvedValue(null);
    api.getThumbnailBatch.mockResolvedValue([]);
    api.getVideoInfoBatch.mockResolvedValue([]);
    useEditorStore.setState({
      queue: [],
      selectedIdx: -1,
      thumbnailsByPath: {},
      excelPath: null,
      excelMatchStatus: {},
      isProcessing: false,
      language: "es",
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    useEditorStore.getState().clearQueue();
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads a row that enters the viewport without waiting for the background batch", async () => {
    const videos = Array.from({ length: 8 }, (_, i) => item(String(i)));
    api.getThumbnailBatch.mockImplementation(() => new Promise(() => {}));
    let reply;
    api.getThumbnail.mockImplementation((path) =>
      path === videos[6].path
        ? new Promise((resolve) => {
            reply = resolve;
          })
        : Promise.resolve(null),
    );
    await useEditorStore.getState().addVideos(
      videos.map((video) => video.path),
      api,
    );
    act(() => root.render(createElement(QueueSidebar)));
    const rows = container.querySelectorAll(".queue-row");
    act(() =>
      callback([
        { target: rows[6], isIntersecting: true },
        { target: rows[7], isIntersecting: false },
      ]),
    );
    expect(api.getThumbnailBatch).toHaveBeenCalledOnce();
    expect(api.getThumbnail.mock.calls.filter(([path]) => path === videos[6].path)).toHaveLength(1);
    await act(async () => {
      reply({ dataUrl: "data:image/jpeg;base64,visible" });
      await flush();
    });
    expect(rows[6].querySelector("img").src).toBe("data:image/jpeg;base64,visible");
    expect(rows[7].querySelector("img")).toBeNull();
  });

  it("keeps a thumbnail attached to its path after removing an earlier row", async () => {
    const videos = [item("remove"), item("keep")];
    useEditorStore.setState({ queue: videos, selectedIdx: 1 });
    let reply;
    api.getThumbnail.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const request = useEditorStore.getState().prioritizeThumbnails([videos[1].path]);
    useEditorStore.getState().removeVideo(0);
    reply({ dataUrl: "data:image/jpeg;base64,kept" });
    await request;
    expect(useEditorStore.getState().thumbnailsByPath).toEqual({
      [videos[1].path]: "data:image/jpeg;base64,kept",
    });
  });

  it("rejects stale results after clear and reimport of the same path", async () => {
    const video = item("reimport");
    useEditorStore.setState({ queue: [video], selectedIdx: 0 });
    const replies = [];
    api.getThumbnail.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    const old = useEditorStore.getState().prioritizeThumbnails([video.path]);
    useEditorStore.getState().clearQueue();
    useEditorStore.setState({ queue: [video], selectedIdx: 0 });
    const fresh = useEditorStore.getState().prioritizeThumbnails([video.path]);
    replies[0]({ dataUrl: "data:image/jpeg;base64,stale" });
    await old;
    expect(useEditorStore.getState().thumbnailsByPath).toEqual({});
    replies[1]({ dataUrl: "data:image/jpeg;base64,fresh" });
    await fresh;
    expect(useEditorStore.getState().thumbnailsByPath[video.path]).toBe(
      "data:image/jpeg;base64,fresh",
    );
    expect(useEditorStore.getState()._thumbnailAbortControllers.size).toBe(0);
  });
});
