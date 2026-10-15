import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, insertClip, setCanvas } from "../shared/editor-timeline.js";
import useExactFrame from "../src/features/editor/playback/useExactFrame.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function projectWithClip(filename = "source.mp4") {
  const added = addAsset(createEmptyEditorProject(), {
    path: `C:/Videos/${filename}`,
    filename,
    sizeBytes: 10,
    mtimeMs: 5,
    metadata: { durationUs: 4_000_000, width: 1280, height: 720 },
  });
  return insertClip(added.project, { assetId: added.assetId }).project;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function View({ api, timeUs }) {
  const { frame, request, close } = useExactFrame(api);
  return (
    <>
      <button onClick={() => request(timeUs)}>Request</button>
      <button onClick={close}>Close</button>
      <output>{JSON.stringify(frame)}</output>
    </>
  );
}

let root, container, api;
const ready = (requestId, path = "C:/Frames/exact.png") => ({ success: true, requestId, path });
const state = () => JSON.parse(container.querySelector("output").textContent);
const click = (text) =>
  act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text).click(),
  );

function mount(timeUs = 1_000_000) {
  act(() => root.render(<View api={api} timeUs={timeUs} />));
}

beforeEach(() => {
  useTimelineStore.getState().open(projectWithClip());
  api = {
    renderEditorExactFrame: vi.fn(async ({ requestId }) => ready(requestId)),
    cancelEditorExport: vi.fn(async () => ({ success: true })),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("exact-frame view", () => {
  it("renders the final available frame when the playhead rests at the montage end", async () => {
    mount(4_000_000);
    await click("Request");
    const { manifest, requestId } = api.renderEditorExactFrame.mock.calls[0][0];
    expect(manifest.jobs[0]).toMatchObject({
      frame: { atUs: 3_999_999 },
      encode_profile: "fast",
      clips: [{ input_path: "C:/Videos/source.mp4" }],
    });
    expect(state()).toEqual({ status: "ready", requestId, path: "C:/Frames/exact.png" });
  });

  it("marks a frame stale when its document is edited during rendering", async () => {
    const render = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(render.promise);
    mount();
    await click("Request");
    const { requestId } = api.renderEditorExactFrame.mock.calls[0][0];
    useTimelineStore.getState().apply((project) => setCanvas(project, { width: 800 }));
    await act(async () => render.resolve(ready(requestId)));
    expect(state()).toEqual({ status: "stale", requestId });
  });

  it("recognizes another document even when its revision matches the requested document", async () => {
    const render = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(render.promise);
    mount();
    await click("Request");
    const { requestId } = api.renderEditorExactFrame.mock.calls[0][0];
    useTimelineStore.getState().open(projectWithClip("other.mp4"));
    await act(async () => render.resolve(ready(requestId)));
    expect(state()).toEqual({ status: "stale", requestId });
  });

  it("cancels a closed view and ignores its late result", async () => {
    const render = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(render.promise);
    mount();
    await click("Request");
    const { requestId } = api.renderEditorExactFrame.mock.calls[0][0];
    await click("Close");
    expect(api.cancelEditorExport).toHaveBeenCalledWith({ kind: "frame" });
    await act(async () => render.resolve(ready(requestId)));
    expect(state()).toBe(null);
  });

  it("waits for cancellation before starting the next render and keeps only its result", async () => {
    const first = deferred(),
      cancellation = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(first.promise);
    api.cancelEditorExport.mockReturnValueOnce(cancellation.promise);
    mount();
    await click("Request");
    const firstId = api.renderEditorExactFrame.mock.calls[0][0].requestId;
    await click("Close");
    mount(2_000_000);
    await click("Request");
    expect(api.renderEditorExactFrame).toHaveBeenCalledTimes(1);
    expect(state().status).toBe("busy");
    await act(async () => cancellation.resolve({ success: true }));
    expect(api.renderEditorExactFrame).toHaveBeenCalledTimes(2);
    const { requestId, manifest } = api.renderEditorExactFrame.mock.calls[1][0];
    expect(requestId).not.toBe(firstId);
    expect(manifest.jobs[0].frame.atUs).toBe(2_000_000);
    await act(async () => first.resolve(ready(firstId, "C:/Frames/old.png")));
    expect(state()).toEqual({ status: "ready", requestId, path: "C:/Frames/exact.png" });
  });

  it("does not start a queued request that was closed before cancellation settled", async () => {
    const first = deferred(),
      cancellation = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(first.promise);
    api.cancelEditorExport.mockReturnValueOnce(cancellation.promise);
    mount();
    await click("Request");
    await click("Close");
    await click("Request");
    await click("Close");
    await act(async () => cancellation.resolve({ success: true }));
    expect(api.renderEditorExactFrame).toHaveBeenCalledTimes(1);
    expect(state()).toBe(null);
  });

  it("supersedes a pending render when a newer request arrives", async () => {
    const first = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(first.promise);
    mount();
    await click("Request");
    const firstId = api.renderEditorExactFrame.mock.calls[0][0].requestId;
    await click("Request");
    const requestId = api.renderEditorExactFrame.mock.calls[1][0].requestId;
    expect(api.cancelEditorExport).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(ready(firstId, "C:/Frames/old.png")));
    expect(state()).toEqual({ status: "ready", requestId, path: "C:/Frames/exact.png" });
  });

  it.each(["returned", "rejected"])(
    "shows a %s render failure through the view state",
    async (kind) => {
      if (kind === "returned")
        api.renderEditorExactFrame.mockResolvedValueOnce({
          success: false,
          error: "Render failed",
        });
      else api.renderEditorExactFrame.mockRejectedValueOnce(new Error("Render failed"));
      mount();
      await click("Request");
      expect(state()).toEqual({ status: "error", error: "Render failed" });
      await click("Request");
      expect(state().status).toBe("ready");
    },
  );

  it("cancels a pending render when the view unmounts", async () => {
    const render = deferred();
    api.renderEditorExactFrame.mockReturnValueOnce(render.promise);
    mount();
    await click("Request");
    const { requestId } = api.renderEditorExactFrame.mock.calls[0][0];
    act(() => root.render(null));
    expect(api.cancelEditorExport).toHaveBeenCalledWith({ kind: "frame" });
    await act(async () => render.resolve(ready(requestId)));
    expect(container.textContent).toBe("");
  });

  it("works after StrictMode replays the mount lifecycle", async () => {
    act(() =>
      root.render(
        <React.StrictMode>
          <View api={api} timeUs={1_000_000} />
        </React.StrictMode>,
      ),
    );
    await click("Request");
    expect(state().status).toBe("ready");
    expect(api.renderEditorExactFrame).toHaveBeenCalledTimes(1);
  });
});
