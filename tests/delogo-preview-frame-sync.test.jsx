import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class DeferredWorker {
  static instance;
  constructor() {
    DeferredWorker.instance = this;
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }
  postMessage(message) {
    this.sent.push(message);
  }
  reply(message, value) {
    const data = new Uint8ClampedArray(message.width * message.height * 4).fill(value);
    this.listeners.get("message")({
      data: { ...message, result: { data, width: message.width, height: message.height } },
    });
  }
}

let root;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mountPreview(playing = false) {
  vi.resetModules();
  vi.stubGlobal("React", React);
  vi.stubGlobal("Worker", DeferredWorker);
  const frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));
  const contexts = new Map();
  const visiblePixels = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    if (!contexts.has(this))
      contexts.set(this, {
        save() {},
        restore() {},
        setTransform() {},
        drawImage: vi.fn((source) => {
          if (this.isConnected && source instanceof HTMLCanvasElement) {
            const image = contexts.get(source)?.putImageData.mock.calls.at(-1)?.[0];
            if (image) visiblePixels.push(image.data[0]);
          }
        }),
        clearRect: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        getImageData: (x, y, width, height) => ({
          data: new Uint8ClampedArray(width * height * 4).fill(40),
        }),
      });
    return contexts.get(this);
  });
  const { PERF_FLAGS } = await import("../src/utils/perf-flags.js");
  PERF_FLAGS.delogoThrottleFps = 0;
  const { default: Preview } = await import("../src/components/DelogoLivePreview.jsx");
  const video = Object.assign(new EventTarget(), {
    videoWidth: 320,
    videoHeight: 180,
    offsetWidth: 320,
    offsetHeight: 180,
    readyState: 4,
    paused: !playing,
    seeking: false,
    currentTime: 0,
    currentSrc: "local-fixture",
  });
  const decodedFrames = new Map();
  if (playing) {
    video.requestVideoFrameCallback = (callback) => {
      decodedFrames.set(++nextFrame, callback);
      return nextFrame;
    };
    video.cancelVideoFrameCallback = (id) => decodedFrames.delete(id);
  }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() =>
    root.render(
      createElement(Preview, {
        videoRef: { current: video },
        operation: {
          delogoMethod: "inpaint",
          edgeFeather: 4,
          region: { x: 0.25, y: 0.25, w: 0.1, h: 0.1 },
        },
      }),
    ),
  );
  const drawNext = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    act(() => callback());
  };
  const paintedValues = () => visiblePixels;
  const presentFrame = (mediaTime, clock) => {
    video.currentTime = clock;
    const [id, callback] = decodedFrames.entries().next().value;
    decodedFrames.delete(id);
    act(() => callback(performance.now(), { mediaTime }));
  };
  return {
    video,
    frames,
    contexts,
    drawNext,
    paintedValues,
    presentFrame,
    canvas: document.querySelector("#root canvas"),
  };
}

describe("quick logo preview frame ownership", () => {
  it("redraws a playing seek immediately without waiting for another decoded frame", async () => {
    const h = await mountPreview(true);
    h.presentFrame(0, 0);
    h.video.seeking = true;
    act(() => h.video.dispatchEvent(new Event("seeking")));
    h.video.seeking = false;
    h.video.currentTime = 1;
    act(() => h.video.dispatchEvent(new Event("seeked")));
    if (h.frames.size) h.drawNext();
    expect(h.canvas.style.visibility).toBe("visible");
  });

  it("clears the patch at seek start and rejects the preceding worker response", async () => {
    const h = await mountPreview();
    h.drawNext();
    const worker = DeferredWorker.instance;
    const old = worker.sent.find((message) => message.type === "compute");
    h.video.seeking = true;
    h.video.currentTime = 1;
    act(() => h.video.dispatchEvent(new Event("seeking")));
    expect(h.canvas.style.visibility).toBe("hidden");
    act(() => worker.reply(old, 99));
    expect(h.paintedValues()).not.toContain(99);

    h.video.seeking = false;
    act(() => h.video.dispatchEvent(new Event("seeked")));
    h.drawNext();
    const current = worker.sent.filter((message) => message.type === "compute").at(-1);
    expect(current.params.timestamp).toBe(1);
    act(() => worker.reply(current, 27));
    expect(h.paintedValues().at(-1)).toBe(27);
    expect(h.canvas.style.visibility).toBe("visible");
  });

  it("rejects a result after the paused video has moved even before seek events arrive", async () => {
    const h = await mountPreview();
    h.drawNext();
    const worker = DeferredWorker.instance;
    const old = worker.sent.find((message) => message.type === "compute");
    h.video.currentTime = 0.25;
    act(() => worker.reply(old, 99));
    expect(h.paintedValues()).not.toContain(99);
  });

  it("uses decoded frame timestamps and rejects a delayed result across a playing cut", async () => {
    const h = await mountPreview(true);
    h.presentFrame(0, 0.02);
    const worker = DeferredWorker.instance;
    const old = worker.sent.find((message) => message.type === "compute");
    h.presentFrame(1 / 12, 0.11);
    act(() => worker.reply(old, 99));
    expect(h.paintedValues()).not.toContain(99);
    const next = worker.sent.filter((message) => message.type === "compute").at(-1);
    expect(next.params.timestamp).toBe(1 / 12);
    act(() => worker.reply(next, 27));
    expect(h.paintedValues().at(-1)).toBe(27);
  });
});
