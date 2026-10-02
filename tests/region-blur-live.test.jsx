import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegionBlurPreview from "../src/components/video-preview/RegionBlurPreview.jsx";
import { PERF_FLAGS } from "../src/utils/perf-flags.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

describe("live blur preview", () => {
  let root;
  let video;
  let frames;
  let context;
  let paused;
  let previousThrottle;

  const nextFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((draw) => draw(performance.now())));
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    frames = new Map();
    let nextId = 0;
    vi.stubGlobal("requestAnimationFrame", (draw) => {
      const id = ++nextId;
      frames.set(id, draw);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));
    context = {
      filter: "none",
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    previousThrottle = PERF_FLAGS.delogoThrottleFps;
    PERF_FLAGS.delogoThrottleFps = 0;
    paused = false;
    video = document.createElement("video");
    for (const [key, value] of Object.entries({
      readyState: 4,
      videoWidth: 320,
      videoHeight: 180,
      offsetWidth: 320,
      offsetHeight: 180,
    })) {
      Object.defineProperty(video, key, { configurable: true, value });
    }
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  });

  afterEach(() => {
    act(() => root.unmount());
    PERF_FLAGS.delogoThrottleFps = previousThrottle;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("draws each playing frame, refreshes on paused seek, and repaints changed regions", () => {
    const first = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
    act(() =>
      root.render(
        createElement(RegionBlurPreview, { videoRef: { current: video }, region: first }),
      ),
    );
    nextFrame();
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);

    paused = true;
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);

    act(() => video.dispatchEvent(new Event("seeked")));
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(4);

    const second = { x: 0.5, y: 0.2, w: 0.2, h: 0.2 };
    act(() =>
      root.render(
        createElement(RegionBlurPreview, { videoRef: { current: video }, region: second }),
      ),
    );
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(5);
    const firstSourceX = context.drawImage.mock.calls[0][1];
    const lastSourceX = context.drawImage.mock.lastCall[1];
    expect(lastSourceX).toBeGreaterThan(firstSourceX);
  });

  it("shows a timed blur only on frames inside its export interval", () => {
    paused = true;
    video.currentTime = 0.2;
    const props = {
      videoRef: { current: video },
      region: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
      startTime: 0.7,
      endTime: 1.7,
    };
    act(() => root.render(createElement(RegionBlurPreview, props)));
    nextFrame();
    expect(context.drawImage).not.toHaveBeenCalled();

    video.currentTime = 1.2;
    act(() => video.dispatchEvent(new Event("seeked")));
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(1);

    video.currentTime = 2;
    act(() => video.dispatchEvent(new Event("seeked")));
    nextFrame();
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
});
