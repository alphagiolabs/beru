import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import App from "../src/App.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { createOperation } from "../src/utils/operation.js";
import { seedAuthenticatedAuth } from "./helpers/authTestState.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
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
  onUpdaterEvent: noop,
  checkForUpdates: asyncNoop,
  resolveDroppedPaths: async (paths) => ({ videoPaths: [], ignoredCount: paths.length }),
};

let root = null;

describe("App render", () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      queue: [],
      selectedIdx: -1,
      selectedOperationIdx: null,
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
    await seedAuthenticatedAuth();
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("does not interrupt the landing view with a blocking update screen", async () => {
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
    expect(document.querySelector(".status-footer")).toBeTruthy();
    expect(document.querySelector(".status-footer-version-dl")).toBeTruthy();
  });

  it("keeps the editor header responsive and icon controls named", async () => {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "C:\\videos\\demo.mp4",
          src: "beru://local/C%3A%5Cvideos%5Cdemo.mp4",
          filename: "demo.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
          operations: [
            createOperation({
              mode: "text",
              text: "Auditoria",
              region: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
            }),
          ],
        }),
      ],
      selectedIdx: 0,
      sidebarMode: "logo",
      activeTool: "text",
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(document.querySelector('[data-testid="header-actions"]')?.className).toMatch(
      /flex-nowrap/,
    );

    const unnamedIconButtons = Array.from(document.querySelectorAll("button")).filter(
      (button) =>
        !button.textContent.trim() &&
        !button.getAttribute("aria-label") &&
        !button.getAttribute("title"),
    );

    expect(unnamedIconButtons).toEqual([]);
  });

  it("shows applied text editing controls after selecting a text layer", async () => {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "C:\\videos\\demo.mp4",
          src: "beru://local/C%3A%5Cvideos%5Cdemo.mp4",
          filename: "demo.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
          operations: [
            createOperation({
              mode: "text",
              text: "Auditoria",
              region: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
              fontSize: 32,
              textWrap: true,
              truncate: "none",
            }),
          ],
        }),
      ],
      selectedIdx: 0,
      sidebarMode: "logo",
      activeTool: "text",
      currentRegion: null,
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      await Promise.all([
        import("../src/components/PropertiesPanel.jsx"),
        import("../src/components/LayerList.jsx"),
      ]);
    });

    const layerButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Auditoria"),
    );
    expect(layerButton).toBeTruthy();

    await act(async () => {
      layerButton.click();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(document.body.textContent).toMatch(/Texto aplicado/i);
    expect(document.body.textContent).toMatch(/Cuadro de texto/i);
    expect(document.body.textContent).toMatch(/Ajuste de línea/i);
  });

  it("shows batch region editing controls after a text region has been added", async () => {
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
      activeTool: "text",
      currentRegion: null,
      templateRegions: [
        {
          id: "region-1",
          label: "TEXT_1",
          region: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
          style: { fontSize: 32, textWrap: true, truncate: "none" },
        },
      ],
      selectedTemplateRegionId: "region-1",
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(document.body.textContent).toMatch(/Región aplicada/i);
    expect(document.body.textContent).toMatch(/demo\.mp4/);
    expect(document.body.textContent).toMatch(/Cuadro de texto/i);
    expect(document.body.textContent).toMatch(/Ajuste de línea/i);
  });

  it("renders the selection canvas above batch text overlays in batch mode", async () => {
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
      activeTool: "text",
      currentRegion: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
      templateRegions: [
        {
          id: "region-1",
          label: "TEXT_1",
          region: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
          style: { fontSize: 32, textWrap: true, truncate: "none" },
        },
      ],
      selectedTemplateRegionId: "region-1",
    });

    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
    });

    const canvas = document.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(Number(canvas.style.zIndex)).toBeGreaterThanOrEqual(30);
  });
});
