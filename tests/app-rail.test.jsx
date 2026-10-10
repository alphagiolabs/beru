import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import AppRail from "../src/components/AppRail.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (globalThis.HTMLCanvasElement) {
  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
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
}

window.api = {
  openExcel: async () => null,
};

const { default: App } = await import("../src/App.jsx");
const { seedAuthenticatedAuth } = await import("./helpers/authTestState.js");

let root = null;

function findRailButton(label) {
  return Array.from(document.querySelectorAll(".app-rail button")).find(
    (b) => b.getAttribute("aria-label") === label,
  );
}

async function renderRail() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(<AppRail />);
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("AppRail", () => {
  beforeEach(() => {
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      templateRegions: [],
      selectedTemplateRegionId: null,
      language: "es",
      isProcessing: false,
      recent: [],
      presets: [],
      customThemes: [],
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

  it("marks the active mode and switches to batch text", async () => {
    await renderRail();

    const logoButton = findRailButton("Quitar logo");
    const batchButton = findRailButton("Texto en lote");

    expect(logoButton.className).toMatch(/is-active/);
    expect(batchButton.className).not.toMatch(/is-active/);

    await act(async () => {
      batchButton.click();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(useEditorStore.getState().sidebarMode).toBe("batch");
    expect(findRailButton("Texto en lote").className).toMatch(/is-active/);
    expect(findRailButton("Quitar logo").className).not.toMatch(/is-active/);
  });

  it("switches back to the logo mode from the rail", async () => {
    useEditorStore.setState({ sidebarMode: "batch" });
    await renderRail();

    await act(async () => {
      findRailButton("Quitar logo").click();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(useEditorStore.getState().sidebarMode).toBe("logo");
  });

  it("enters batch mode with the text tool ready, as the inspector selector did", async () => {
    useEditorStore.setState({
      templateRegions: [{ id: "r1", label: "TEXT_1", region: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
      selectedTemplateRegionId: null,
    });
    await renderRail();

    await act(async () => {
      findRailButton("Texto en lote").click();
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState();
    expect(state.sidebarMode).toBe("batch");
    expect(state.activeTool).toBe("text");
    expect(state.selectedTemplateRegionId).toBe("r1");
  });

  it("keeps every rail control named for assistive tech", async () => {
    await renderRail();

    const unnamed = Array.from(document.querySelectorAll(".app-rail button")).filter(
      (b) => !b.getAttribute("aria-label") && !b.getAttribute("title"),
    );
    expect(unnamed).toEqual([]);
  });
});

describe("App shell with rail", () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="root"></div>';
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
      sidebarMode: "logo",
      activeTool: "text",
      currentRegion: null,
      language: "es",
      templateRegions: [],
      selectedTemplateRegionId: null,
      appToast: null,
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

  it("shows the mode name in the inspector and keeps batch controls reachable", async () => {
    await act(async () => {
      useEditorStore.setState({
        sidebarMode: "batch",
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

    expect(document.querySelector('[data-testid="inspector-mode-title"]')?.textContent).toMatch(
      /Texto en lote/i,
    );
    expect(document.querySelector('[data-testid="batch-panel"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Región aplicada/i);
  });
});
