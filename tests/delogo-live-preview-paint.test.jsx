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

function mountHarness(framePixel = () => 0) {
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
        getImageData: vi.fn((x, y, width, height) => {
          const ctx = contexts.get(this);
          const [, sx, sy, sw, sh] = ctx.drawImage.mock.calls.at(-1);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
              const value = framePixel(sx + (col * sw) / width, sy + (row * sh) / height);
              const offset = (row * width + col) * 4;
              data.set([value, value, value, 255], offset);
            }
          }
          return { data };
        }),
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
      edgeFeather: 6,
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

  it("reconstructs a tight inpaint selection from logo-free surrounding pixels", () => {
    const harness = mountHarness((x, y) => (x >= 8 && x < 16 && y >= 4 && y < 10 ? 255 : 40));
    useEditorStore.setState({
      delogoMethod: "inpaint",
      currentRegion: { x: 8 / 32, y: 4 / 18, w: 8 / 32, h: 6 / 18 },
    });
    act(() =>
      root.render(createElement(DelogoLivePreview, { videoRef: { current: makeVideo() } })),
    );
    harness.drawNext();
    const [canvas, painted] = [...harness.contexts.entries()].find(
      ([, ctx]) => ctx.putImageData.mock.calls.length,
    );
    expect(painted).toBeDefined();
    const data = painted.putImageData.mock.calls[0][0].data;
    for (let offset = 0; offset < data.length; offset += 4) {
      expect(Array.from(data.slice(offset, offset + 3))).toEqual([40, 40, 40]);
    }
    expect(data[3], "outside the feather the original video remains visible").toBe(0);
    expect(data[(7 * canvas.width + 12) * 4 + 3], "the selected core remains opaque").toBe(255);
  });
});
