import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import AppRail from "../src/components/AppRail.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

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

  it("opens the Fechero workspace from its own item right below the watermark", async () => {
    useEditorStore.setState({ editorWorkspace: "logo" });
    await renderRail();
    const labels = Array.from(document.querySelectorAll(".app-rail button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels.indexOf("Fechero")).toBe(labels.indexOf("Marca de agua") + 1);

    await act(async () => {
      findRailButton("Fechero").click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(useEditorStore.getState()).toMatchObject({
      sidebarMode: "logo",
      editorWorkspace: "datetime",
      activeTool: "datetime",
    });
    expect(findRailButton("Fechero").className).toMatch(/is-active/);
    expect(findRailButton("Quitar logo").className).not.toMatch(/is-active/);

    await act(async () => {
      findRailButton("Quitar logo").click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(useEditorStore.getState()).toMatchObject({
      editorWorkspace: "logo",
      activeTool: "blur",
    });
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
});
