import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import App from "../src/App.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
if (globalThis.HTMLCanvasElement) {
  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  });
}

const noop = () => () => {};
const asyncNoop = async () => ({});
window.api = {
  onProgress: noop,
  onJobProgress: noop,
  onComplete: noop,
  onSummary: noop,
  onJobError: noop,
  onFinished: noop,
  onError: noop,
  onLog: noop,
  onUpdaterEvent: noop,
  checkForUpdates: asyncNoop,
  resolveDroppedPaths: async (paths) => ({ videoPaths: [], ignoredCount: paths.length }),
};

let root = null;

describe("App render", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      queue: [],
      selectedIdx: -1,
      language: "es",
      sidebarMode: "logo",
      templateRegions: [],
      selectedTemplateRegionId: null,
      currentRegion: null,
      showMappingModal: false,
      showTableEditor: false,
      appToast: null,
      update: {
        status: "idle",
        version: null,
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: null,
      },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("mounts landing without throwing", async () => {
    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(document.body.textContent).toMatch(/Importar videos/i);
  });

  it("does not interrupt the landing view with the old update download screen", async () => {
    useEditorStore.setState({
      update: {
        status: "downloading",
        version: "1.6.0",
        percent: 25,
        error: null,
        transferred: 1024 * 1024,
        total: 4 * 1024 * 1024,
        releaseNotes: "",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
      },
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(document.body.textContent).toMatch(/Importar videos/i);
    expect(document.body.textContent).not.toMatch(/Descargando actualización/i);
    expect(document.body.textContent).not.toMatch(/Beru v1\.6\.0 se está descargando/i);
  });

  it("mounts batch preview with template regions without throwing", async () => {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "C:\\videos\\demo.mp4",
          src: "beru://local/C%3A%5Cvideos%5Cdemo.mp4",
          filename: "demo.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
        }),
      ],
      selectedIdx: 0,
      sidebarMode: "batch",
      templateRegions: [
        {
          id: 1,
          label: "TEXT_1",
          region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
          style: {},
        },
      ],
      selectedTemplateRegionId: 1,
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      // Flush Suspense lazy resolution (React.lazy chunks resolve on next tick)
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(document.body.textContent).toMatch(/demo\.mp4/);
  });
});
