import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoPreview from "../src/components/VideoPreview.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("logo preview request flow", () => {
  let root;
  let requests;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      setLineDash() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    });
    document.body.innerHTML = '<div id="root"></div>';
    requests = [];
    window.api = {
      renderPreviewFrame: vi.fn((job) => {
        const pending = deferred();
        requests.push({ job, ...pending });
        return pending.promise;
      }),
    };
    useEditorStore.setState({
      language: "es",
      sidebarMode: "logo",
      activeTool: "delogo",
      delogoMethod: "blur",
      currentRegion: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
      queue: [
        {
          path: "C:/clip.mp4",
          src: "",
          filename: "clip.mp4",
          width: 320,
          height: 180,
          duration: 3,
          operations: [
            {
              id: "text-1",
              mode: "text",
              text: "Excel title",
              region: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
            },
          ],
        },
      ],
      selectedIdx: 0,
      selectedOperationIdx: null,
    });
    root = createRoot(document.getElementById("root"));
    act(() => root.render(<VideoPreview />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("includes text and draft, discards older methods, and updates on paused seek", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].job.operations.map((op) => op.mode)).toEqual(["text", "delogo"]);
    expect(requests[0].job.operations[1].delogo_method).toBe("blur");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(1);

    act(() => useEditorStore.setState({ delogoMethod: "mosaic" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations[1].delogo_method).toBe("mosaic");

    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,BBBB" }),
    );
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    act(() => document.querySelectorAll(".video-preview-compare-btn")[2].click());
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeTruthy();

    const video = document.querySelector("video");
    act(() => {
      video.currentTime = 1.2;
      video.dispatchEvent(new Event("seeked"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    expect(requests).toHaveLength(3);
    expect(requests[2].job.timestamp).toBe(1.2);
    await act(async () => requests[2].resolve({ ok: false, error: "FFmpeg failed" }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("FFmpeg failed");
  });

  it("clears logo comparison when opening batch text", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    act(() => document.querySelectorAll(".video-preview-compare-btn")[2].click());
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeTruthy();
    const video = document.querySelector("video");
    act(() => {
      video.currentTime = 1.2;
      video.dispatchEvent(new Event("seeked"));
    });
    expect(document.body.textContent).toContain("00:01.20");
    expect(document.body.textContent).toContain("00:03.00");
    act(() => useEditorStore.setState({ sidebarMode: "batch", activeTool: "text" }));
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    expect(document.body.textContent).toContain("0:01 / 0:03");
  });

  it("keeps a live blur visible after FFmpeg completes and returns to it while editing", async () => {
    act(() => useEditorStore.setState({ activeTool: "blur" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );

    expect(document.querySelector("canvas[data-region-blur-preview]")).toBeTruthy();
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    const buttons = [...document.querySelectorAll(".video-preview-compare-btn")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "En vivo",
      "Antes",
      "Después",
      "Lado a lado",
    ]);

    act(() => buttons[2].click());
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeTruthy();
    act(() => useEditorStore.setState({ currentRegion: { x: 0.3, y: 0.2, w: 0.1, h: 0.1 } }));
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    expect(document.querySelector("canvas[data-region-blur-preview]")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(460);
    });
    expect(requests).toHaveLength(2);
    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,BBBB" }),
    );
    expect(document.querySelector('img[alt="Preview FFmpeg renderizado"]')).toBeNull();
    expect(document.querySelector("canvas[data-region-blur-preview]")).toBeTruthy();
  });

  it("defers expensive FFmpeg frames until a logo drag ends", async () => {
    act(() => useEditorStore.setState({ activeTool: "blur" }));
    act(() =>
      document
        .querySelector("canvas[data-region-blur-preview]")
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(requests).toHaveLength(0);

    act(() => useEditorStore.setState({ currentRegion: { x: 0.3, y: 0.2, w: 0.1, h: 0.1 } }));

    act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 })));
    await act(async () => vi.advanceTimersByTimeAsync(149));
    expect(requests).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requests).toHaveLength(1);
  });

  it("keeps a timed applied blur mounted so it can switch on at the exact video frame", () => {
    const video = document.querySelector("video");
    for (const [key, value] of Object.entries({
      videoWidth: 320,
      videoHeight: 180,
      offsetWidth: 320,
      offsetHeight: 180,
    })) {
      Object.defineProperty(video, key, { configurable: true, value });
    }
    act(() =>
      useEditorStore.setState({
        activeTool: "blur",
        currentRegion: null,
        queue: [
          {
            ...useEditorStore.getState().queue[0],
            operations: [
              {
                id: "timed-blur",
                mode: "blur",
                blurStrength: 30,
                startTime: 0.7,
                endTime: 1.7,
                region: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
              },
            ],
          },
        ],
      }),
    );
    expect(document.querySelector("canvas[data-region-blur-preview]")).toBeTruthy();
  });

  it("keeps a dismissed frame closed until its content changes", async () => {
    await act(async () => vi.advanceTimersByTimeAsync(450));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => document.querySelector(".video-preview-compare-close").click());
    act(() => window.dispatchEvent(new Event("blur")));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(requests).toHaveLength(1);
    expect(document.querySelector(".video-preview-compare-close")).toBeNull();
    act(() => useEditorStore.setState({ delogoMethod: "mosaic" }));
    await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations.at(-1).delogo_method).toBe("mosaic");
  });

  it("playback invalidates an outstanding frame and paused playback renders the current time", async () => {
    await act(async () => vi.advanceTimersByTimeAsync(450));
    const video = document.querySelector("video");
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    act(() => video.dispatchEvent(new Event("play")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,OBSOLETE" }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(document.querySelector(".video-preview-compare-close")).toBeNull();
    expect(requests).toHaveLength(1);
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    act(() => {
      video.currentTime = 1.5;
      video.dispatchEvent(new Event("pause"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(requests).toHaveLength(2);
    expect(requests[1].job.timestamp).toBe(1.5);
  });

  it("debounces edits that undo back to the dismissed frame", async () => {
    await act(async () => vi.advanceTimersByTimeAsync(450));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => document.querySelector(".video-preview-compare-close").click());
    act(() => useEditorStore.setState({ delogoMethod: "mosaic" }));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    act(() => useEditorStore.setState({ delogoMethod: "blur" }));
    await act(async () => vi.advanceTimersByTimeAsync(449));
    expect(requests).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations.at(-1).delogo_method).toBe("blur");
  });
});
