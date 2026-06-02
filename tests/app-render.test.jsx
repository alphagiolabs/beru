import React, { act } from "react";
import { describe, it, expect, beforeEach } from "vitest";
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

window.api = {
  onProgress: () => () => {},
  onJobProgress: () => () => {},
  onComplete: () => () => {},
  onSummary: () => () => {},
  onJobError: () => () => {},
  onFinished: () => () => {},
  onError: () => () => {},
  onLog: () => () => {},
  checkGitHubRelease: async () => ({ ok: true, updateAvailable: false }),
};

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
    });
  });

  it("mounts landing without throwing", async () => {
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
    });
    expect(document.body.textContent).toMatch(/Importar videos/i);
  });

  it("mounts batch preview with template regions without throwing", async () => {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "C:\\videos\\demo.mp4",
          src: "",
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

    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
    });
    expect(document.body.textContent).toMatch(/demo\.mp4/);
  });
});
