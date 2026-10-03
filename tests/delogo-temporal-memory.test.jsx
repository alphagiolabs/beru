import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DelogoLivePreview from "../src/components/DelogoLivePreview.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { PERF_FLAGS } from "../src/utils/perf-flags.js";

vi.mock("../src/utils/video-utils.js", () => ({
  regionToScreen: () => ({ x: 0, y: 0, w: 480, h: 270 }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

describe("temporal delogo preview memory", () => {
  let root;
  let frames;
  let contexts;
  let previousThrottle;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    frames = new Map();
    contexts = new Map();
    previousThrottle = PERF_FLAGS.delogoThrottleFps;
    PERF_FLAGS.delogoThrottleFps = 0;
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      const id = frames.size + 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
      if (!contexts.has(this)) {
        contexts.set(this, {
          save: vi.fn(),
          restore: vi.fn(),
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          putImageData: vi.fn(),
          setTransform: vi.fn(),
          getImageData: vi.fn((_x, _y, width, height) => {
            if (width > 1280 || height > 720) throw new Error("unbounded frame capture");
            return { data: new Uint8ClampedArray(width * height * 4) };
          }),
          createImageData: vi.fn((width, height) => ({
            data: new Uint8ClampedArray(width * height * 4),
          })),
        });
      }
      return contexts.get(this);
    });
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "delogo",
      delogoMethod: "temporal",
      temporalRadius: 7,
      currentRegion: { x: 0, y: 0, w: 1, h: 1 },
    });
    root = createRoot(document.getElementById("root"));
  });

  afterEach(() => {
    act(() => root.unmount());
    PERF_FLAGS.delogoThrottleFps = previousThrottle;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("samples a 4K region at the visible canvas size and stops drawing when hidden", () => {
    const video = {
      videoWidth: 3840,
      videoHeight: 2160,
      readyState: 4,
      paused: true,
      currentSrc: "beru://video",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    act(() => root.render(createElement(DelogoLivePreview, { videoRef: { current: video } })));
    const [id, draw] = frames.entries().next().value;
    frames.delete(id);
    act(() => draw());

    const source = [...contexts.entries()].find(([, ctx]) => ctx.getImageData.mock.calls.length);
    expect(source).toBeDefined();
    expect(source[1].getImageData).toHaveBeenCalledWith(0, 0, 480, 270);
    expect(source[0].width).toBe(480);
    expect(source[0].height).toBe(270);

    act(() => useEditorStore.setState({ sidebarMode: "batch" }));
    expect(source[1].getImageData.mock.calls).toHaveLength(1);
    expect(video.removeEventListener).toHaveBeenCalledWith("seeked", expect.any(Function));
  });

  it("shares one capture canvas across preview instances of the same video", () => {
    const video = {
      videoWidth: 3840,
      videoHeight: 2160,
      readyState: 4,
      paused: true,
      currentSrc: "beru://video",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const videoRef = { current: video };
    const operation = {
      mode: "delogo",
      delogoMethod: "temporal",
      temporalRadius: 7,
      region: { x: 0, y: 0, w: 1, h: 1 },
    };

    act(() =>
      root.render(
        createElement("div", null, [
          createElement(DelogoLivePreview, { key: "draft", videoRef }),
          createElement(DelogoLivePreview, { key: "op", videoRef, operation }),
        ]),
      ),
    );
    for (const [id, draw] of [...frames.entries()]) {
      frames.delete(id);
      act(() => draw());
    }

    const captures = [...contexts.values()].filter((ctx) => ctx.getImageData.mock.calls.length > 0);
    expect(captures).toHaveLength(1);
    expect(captures[0].getImageData).toHaveBeenCalledWith(0, 0, 480, 270);
  });

  it.each(["inpaint", "blur"])("bounds %s captures for a large 4K selection", (method) => {
    const video = {
      videoWidth: 3840,
      videoHeight: 2160,
      readyState: 4,
      paused: true,
      currentSrc: "beru://4k",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const operation = {
      mode: "delogo",
      delogoMethod: method,
      blurStrength: 100,
      edgeFeather: 40,
      region: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    };
    act(() =>
      root.render(createElement(DelogoLivePreview, { videoRef: { current: video }, operation })),
    );
    const [id, draw] = frames.entries().next().value;
    frames.delete(id);
    act(() => draw());
    const captures = [...contexts.values()].flatMap((ctx) => ctx.getImageData.mock.calls);
    expect(captures).toHaveLength(1);
    expect(captures[0][2]).toBeLessThanOrEqual(1280);
    expect(captures[0][3]).toBeLessThanOrEqual(720);
    expect([...contexts.values()].some((ctx) => ctx.putImageData.mock.calls.length)).toBe(true);
  });

  it("draws an applied blur from its own region and method when there is no draft", () => {
    useEditorStore.setState({
      currentRegion: null,
      activeTool: "pan",
      delogoMethod: "mosaic",
    });
    const video = {
      videoWidth: 320,
      videoHeight: 180,
      readyState: 4,
      paused: true,
      currentSrc: "beru://video",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const operation = {
      mode: "delogo",
      delogoMethod: "blur",
      blurStrength: 30,
      region: { x: 0.25, y: 0.25, w: 0.2, h: 0.2 },
    };
    act(() =>
      root.render(createElement(DelogoLivePreview, { videoRef: { current: video }, operation })),
    );
    const [id, draw] = frames.entries().next().value;
    frames.delete(id);
    act(() => draw());

    expect(
      [...contexts.values()].some((ctx) =>
        ctx.drawImage.mock.calls.some(([source]) => source === video),
      ),
    ).toBe(true);
  });

  it("respects an applied blur interval on paused seeks", () => {
    useEditorStore.setState({ currentRegion: null, activeTool: "pan" });
    const video = document.createElement("video");
    for (const [key, value] of Object.entries({
      videoWidth: 320,
      videoHeight: 180,
      readyState: 4,
    })) {
      Object.defineProperty(video, key, { configurable: true, value });
    }
    video.currentTime = 0.2;
    const operation = {
      mode: "delogo",
      delogoMethod: "blur",
      blurStrength: 30,
      startTime: 0.7,
      endTime: 1.7,
      region: { x: 0.25, y: 0.25, w: 0.2, h: 0.2 },
    };
    act(() =>
      root.render(createElement(DelogoLivePreview, { videoRef: { current: video }, operation })),
    );
    const drawNext = () => {
      const [id, draw] = frames.entries().next().value;
      frames.delete(id);
      act(() => draw());
    };
    const draws = () =>
      [...contexts.values()].reduce(
        (total, ctx) =>
          total + ctx.drawImage.mock.calls.filter(([source]) => source === video).length,
        0,
      );
    drawNext();
    expect(draws()).toBe(0);
    video.currentTime = 1.2;
    act(() => video.dispatchEvent(new Event("seeked")));
    drawNext();
    expect(draws()).toBe(1);
    video.currentTime = 2;
    act(() => video.dispatchEvent(new Event("seeked")));
    drawNext();
    expect(draws()).toBe(1);
  });
});
