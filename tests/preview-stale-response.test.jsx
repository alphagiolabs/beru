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

const STRICT_IMG = 'img[alt="Preview FFmpeg renderizado"]';

function queueWithOps(operations) {
  return [
    {
      path: "C:/clip.mp4",
      src: "",
      filename: "clip.mp4",
      width: 320,
      height: 180,
      duration: 3,
      operations,
    },
  ];
}

const blurOp = (strength) => ({
  id: `blur-${strength}`,
  mode: "blur",
  blurStrength: strength,
  region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
});

describe("ffmpeg strict preview staleness", () => {
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
      sidebarMode: "layers",
      activeTool: "select",
      currentRegion: null,
      templateRegions: [],
      queue: queueWithOps([blurOp(20)]),
      selectedIdx: 0,
      selectedOperationIdx: null,
      watermark: { enabled: false },
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

  it("invalidates on op changes and an obsolete response never wins", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(requests).toHaveLength(1);
    expect(requests[0].job.operations[0].blur_strength).toBe(20);

    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    const img = () => document.querySelector(STRICT_IMG);
    expect(img()?.getAttribute("src")).toContain("AAAA");

    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    expect(img()).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations[0].blur_strength).toBe(60);

    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(90)]) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(3);
    expect(requests[2].job.operations[0].blur_strength).toBe(90);

    await act(async () =>
      requests[2].resolve({ ok: true, data_url: "data:image/jpeg;base64,CCCC" }),
    );
    expect(img()?.getAttribute("src")).toContain("CCCC");

    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,BBBB" }),
    );
    expect(img()?.getAttribute("src")).toContain("CCCC");
  });

  it("timestamp changes invalidate the strict frame", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );

    const video = document.querySelector("video");
    act(() => {
      video.currentTime = 1.5;
      video.dispatchEvent(new Event("seeked"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].job.timestamp).toBe(1.5);
  });

  it("rejects the first frame if edits arrive before the debounce starts its replacement", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,OLD" }),
    );
    expect(document.querySelector(STRICT_IMG)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations[0].blur_strength).toBe(60);
    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,CURRENT" }),
    );
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("CURRENT");
  });

  it.each(["scheduled", "running"])("closing cancels a %s refresh", async (phase) => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    if (phase === "running") await act(async () => vi.advanceTimersByTimeAsync(450));
    act(() => document.querySelector(".video-preview-compare-close").click());
    if (phase === "running") {
      await act(async () =>
        requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,LATE" }),
      );
    }
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(document.querySelector(STRICT_IMG)).toBeNull();
    expect(document.querySelector(".video-preview-compare-close")).toBeNull();
    expect(requests).toHaveLength(phase === "running" ? 2 : 1);
  });

  it("unmount discards late errors without notifying the editor", async () => {
    const toast = useEditorStore.getState().showToast;
    const notify = vi.fn();
    act(() => useEditorStore.setState({ showToast: notify }));
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    act(() => root.unmount());
    root = { unmount() {} };
    await act(async () => requests[0].resolve({ ok: false, error: "Obsolete failure" }));
    expect(notify).not.toHaveBeenCalled();
    act(() => useEditorStore.setState({ showToast: toast }));
  });

  it("restoring the displayed job cancels a queued refresh and clears stale status", async () => {
    const original = useEditorStore.getState().queue;
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    act(() => useEditorStore.setState({ queue: original }));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(requests).toHaveLength(1);
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("FIRST");
    expect(document.querySelector(STRICT_IMG)?.style.opacity).toBe("1");
  });

  it("a manual render consumes the pending debounce and displays the rendered result", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => document.querySelectorAll(".video-preview-compare-btn")[2].click());
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,SECOND" }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(requests).toHaveLength(2);
    expect(
      document.querySelectorAll(".video-preview-compare-btn")[1].getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("SECOND");
  });

  it("changing videos cancels a scheduled refresh until the new video is requested", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FIRST" }),
    );
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    act(() =>
      useEditorStore.setState({ queue: [{ ...queueWithOps([])[0], path: "C:/next.mp4" }] }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(requests).toHaveLength(1);
    expect(document.querySelector(STRICT_IMG)).toBeNull();
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(requests[1].job.input_path).toBe("C:/next.mp4");
    await act(async () =>
      requests[1].resolve({ ok: true, data_url: "data:image/jpeg;base64,NEXT" }),
    );
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("NEXT");
  });

  it("debounces every edit while the first frame is being replaced", async () => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(60)]) }));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    act(() => useEditorStore.setState({ queue: queueWithOps([blurOp(90)]) }));
    await act(async () => vi.advanceTimersByTimeAsync(449));
    expect(requests).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requests).toHaveLength(2);
    expect(requests[1].job.operations[0].blur_strength).toBe(90);
  });

  it("probes missing dimensions and renders the latest edits with the resulting metadata", async () => {
    const probe = deferred();
    window.api.getVideoInfo = vi.fn(() => probe.promise);
    act(() =>
      useEditorStore.setState({
        queue: [{ ...queueWithOps([blurOp(20)])[0], width: 0, height: 0 }],
      }),
    );
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(requests).toHaveLength(0);
    act(() =>
      useEditorStore.setState({
        queue: [{ ...useEditorStore.getState().queue[0], operations: [blurOp(60)] }],
      }),
    );
    await act(async () => probe.resolve({ width: 640, height: 360, duration: 3 }));
    expect(requests).toHaveLength(1);
    expect(requests[0].job).toMatchObject({ width: 640, height: 360 });
    expect(requests[0].job.operations[0].blur_strength).toBe(60);
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,PROBED" }),
    );
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("PROBED");
  });

  it("does not render a new selection when an old metadata probe completes", async () => {
    const probe = deferred();
    window.api.getVideoInfo = vi.fn(() => probe.promise);
    act(() =>
      useEditorStore.setState({
        queue: [{ ...queueWithOps([blurOp(20)])[0], width: 0, height: 0 }],
      }),
    );
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    act(() =>
      useEditorStore.setState({ queue: [{ ...queueWithOps([])[0], path: "C:/next.mp4" }] }),
    );
    await act(async () => probe.resolve({ width: 640, height: 360, duration: 3 }));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(requests).toHaveLength(0);
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(requests[0].job.input_path).toBe("C:/next.mp4");
  });

  it("falls back to a rendered job when a matching exported artifact cannot be read", async () => {
    const { timestamp: _timestamp, ...exportShape } = useEditorStore
      .getState()
      .buildPreviewFrameJob(0, 0);
    act(() =>
      useEditorStore.setState((s) => ({
        queue: [
          {
            ...s.queue[0],
            exportSignature: JSON.stringify(exportShape),
            exportedOutputPath: "C:/out/clip.mp4",
            exportedOutputStat: { size: 8, mtimeMs: 1, ctimeMs: 2 },
          },
        ],
      })),
    );
    window.api.renderSourceFrame = vi.fn(async () => ({ ok: false, error: "Missing artifact" }));
    await act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(window.api.renderSourceFrame).toHaveBeenCalledOnce();
    expect(window.api.renderSourceFrame).toHaveBeenCalledWith({
      input_path: "C:/out/clip.mp4",
      timestamp: 0,
      expected_stat: { size: 8, mtimeMs: 1, ctimeMs: 2 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].job.operations[0].blur_strength).toBe(20);
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,FALLBACK" }),
    );
    expect(document.querySelector(STRICT_IMG)?.getAttribute("src")).toContain("FALLBACK");
    expect(document.querySelector(STRICT_IMG)?.parentElement.textContent).toBe("FFmpeg");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("skips an exported artifact that has no recorded stat", async () => {
    const { timestamp: _timestamp, ...exportShape } = useEditorStore
      .getState()
      .buildPreviewFrameJob(0, 0);
    act(() =>
      useEditorStore.setState((s) => ({
        queue: [
          {
            ...s.queue[0],
            exportSignature: JSON.stringify(exportShape),
            exportedOutputPath: "C:/out/clip.mp4",
          },
        ],
      })),
    );
    window.api.renderSourceFrame = vi.fn(async () => ({ ok: true, data_url: "data:x" }));
    await act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(window.api.renderSourceFrame).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it.each([
    [6, 1],
    [3, 0],
    [15, 4.96],
  ])("seeks a trimmed export at its own timestamp (%s -> %s)", async (sourceTime, exportTime) => {
    act(() =>
      useEditorStore.setState({
        queue: [
          {
            ...queueWithOps([blurOp(20)])[0],
            duration: 20,
            frameRate: 25,
            trimStart: 5,
            trimEnd: 10,
          },
        ],
      }),
    );
    const { timestamp: _timestamp, ...exportShape } = useEditorStore
      .getState()
      .buildPreviewFrameJob(0, sourceTime);
    act(() =>
      useEditorStore.setState((s) => ({
        queue: [
          {
            ...s.queue[0],
            exportSignature: JSON.stringify(exportShape),
            exportedOutputPath: "C:/out/trimmed.mp4",
            exportedOutputStat: { size: 8, mtimeMs: 1, ctimeMs: 2 },
          },
        ],
      })),
    );
    window.api.renderSourceFrame = vi.fn(async () => ({
      ok: true,
      data_url: "data:image/jpeg;base64,AAAA",
    }));
    document.querySelector("video").currentTime = sourceTime;
    await act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    expect(window.api.renderSourceFrame).toHaveBeenCalledWith({
      input_path: "C:/out/trimmed.mp4",
      timestamp: exportTime,
      expected_stat: { size: 8, mtimeMs: 1, ctimeMs: 2 },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      "a region change",
      { queue: queueWithOps([{ ...blurOp(20), region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }]) },
      (j) => j.operations[0].region,
    ],
    ["a watermark change", { watermark: { enabled: true, text: "ACME" } }, (j) => j.watermark.text],
    ["an encode profile change", { encodeProfile: "quality" }, (j) => j.encode_profile],
    ["an output path change", { outputDir: "D:\\exports" }, (j) => j.output_path],
    [
      "a trim change",
      (s) => ({ queue: [{ ...s.queue[0], trimStart: 0.5, trimEnd: 2.5 }] }),
      (j) => j.trim_start,
    ],
    [
      "a codec probe change",
      (s) => ({ queue: [{ ...s.queue[0], videoCodec: "hevc" }] }),
      (j) => j.video_codec,
    ],
  ])("%s still invalidates the strict frame", async (_label, patch, pick) => {
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    expect(requests).toHaveLength(1);

    act(() => useEditorStore.setState(patch));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(requests).toHaveLength(2);
    expect(pick(requests[1].job)).toBeDefined();
  });

  it("a global text style change invalidates a batch-text frame", async () => {
    act(() =>
      useEditorStore.setState({
        templateRegions: [
          { id: "r1", label: "TEXT_1", region: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 }, style: {} },
        ],
        excelRows: [{ id: "clip", TEXT_1: "Hola" }],
        excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      }),
    );
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    const textOp = () => requests.at(-1).job.operations.find((op) => op.text === "Hola");
    expect(textOp()).toBeTruthy();
    const before = textOp().font_size;

    act(() => useEditorStore.setState({ textFontSize: 99 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(requests).toHaveLength(2);
    expect(textOp().font_size).toBe(99);
    expect(textOp().font_size).not.toBe(before);
  });

  it("excel input changes invalidate a batch-text frame", async () => {
    act(() =>
      useEditorStore.setState({
        templateRegions: [
          { id: "r1", label: "TEXT_1", region: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 }, style: {} },
        ],
        excelRows: [{ id: "clip", TEXT_1: "Hola", TEXT_2: "Otra" }],
        excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      }),
    );
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    const textOf = () => requests.at(-1).job.operations.find((op) => op.text)?.text;
    expect(textOf()).toBe("Hola");

    act(() =>
      useEditorStore.setState({ excelRows: [{ id: "clip", TEXT_1: "Adios", TEXT_2: "Otra" }] }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(2);
    expect(textOf()).toBe("Adios");

    act(() =>
      useEditorStore.setState({ excelMapping: { idColumn: "id", columns: { r1: "TEXT_2" } } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(3);
    expect(textOf()).toBe("Otra");
  });

  it("logo draft changes invalidate the strict frame", async () => {
    act(() =>
      useEditorStore.setState({
        sidebarMode: "logo",
        activeTool: "blur",
        currentRegion: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        blurStrength: 20,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(1);
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    const draftOp = () => requests.at(-1).job.operations.at(-1);
    expect(draftOp().mode).toBe("blur");
    expect(draftOp().blur_strength).toBe(20);

    act(() => useEditorStore.setState({ blurStrength: 60 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(2);
    expect(draftOp().blur_strength).toBe(60);
  });

  it("template region edits invalidate the batch frame", async () => {
    act(() =>
      useEditorStore.setState({
        templateRegions: [
          { id: "r1", label: "TEXT_1", region: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 }, style: {} },
        ],
        excelRows: [{ id: "clip", TEXT_1: "Hola" }],
        excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      }),
    );
    act(() => window.dispatchEvent(new Event("beru:preview:renderFrame")));
    await act(async () =>
      requests[0].resolve({ ok: true, data_url: "data:image/jpeg;base64,AAAA" }),
    );
    const textRegion = () =>
      requests.at(-1).job.operations.find((op) => op.text === "Hola")?.region;
    const before = textRegion();
    expect(before).toBeDefined();

    act(() =>
      useEditorStore.setState({
        templateRegions: [
          { id: "r1", label: "TEXT_1", region: { x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, style: {} },
        ],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(requests).toHaveLength(2);
    expect(textRegion()).not.toEqual(before);
  });
});
