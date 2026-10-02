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

function mountHarness() {
  const frames = new Map();
  const contexts = new Map();
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
        getImageData: vi.fn((x, y, width, height) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        createImageData: vi.fn((width, height) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
      });
    }
    return contexts.get(this);
  });
  return {
    frames,
    contexts,
    drawNext() {
      const [id, draw] = frames.entries().next().value;
      frames.delete(id);
      act(() => draw());
    },
  };
}

function makeVideo() {
  return {
    videoWidth: 32,
    videoHeight: 18,
    readyState: 4,
    paused: true,
    currentSrc: "beru://video",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("delogo live preview canvas painting", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    PERF_FLAGS.delogoThrottleFps = 0;
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "delogo",
      delogoMethod: "mosaic",
      mosaicSize: 8,
      currentRegion: { x: 0, y: 0, w: 1, h: 1 },
    });
    root = createRoot(document.getElementById("root"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("paints the mosaic result onto the tiny canvas", () => {
    const harness = mountHarness();
    act(() =>
      root.render(createElement(DelogoLivePreview, { videoRef: { current: makeVideo() } })),
    );
    harness.drawNext();

    const painted = [...harness.contexts.entries()].find(
      ([, ctx]) => ctx.putImageData.mock.calls.length,
    );
    expect(painted, "mosaic result must be written to a canvas").toBeDefined();
    const [canvas] = painted;
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(3);
    const blitted = [...harness.contexts.values()].some((ctx) =>
      ctx.drawImage.mock.calls.some((args) => args[0] === canvas && args[3] === 4 && args[4] === 3),
    );
    expect(blitted, "the tiny canvas must be blitted to the visible canvas").toBe(true);
  });

  it("keeps painting under React.StrictMode double effects", () => {
    const harness = mountHarness();
    act(() =>
      root.render(
        createElement(
          React.StrictMode,
          null,
          createElement(DelogoLivePreview, { videoRef: { current: makeVideo() } }),
        ),
      ),
    );
    harness.drawNext();

    const painted = [...harness.contexts.values()].filter(
      (ctx) => ctx.putImageData.mock.calls.length,
    );
    expect(painted.length, "renders after StrictMode remount must still paint").toBeGreaterThan(0);
  });
});
