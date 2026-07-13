import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createQueueItem } from "../src/utils/types.js";

window.api = window.api || {};

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: BatchPanel } = await import("../src/components/BatchPanel.jsx");

let root = null;

function seedBatchPanelState() {
  useEditorStore.setState({
    queue: [
      createQueueItem({
        path: "C:\\videos\\demo.mp4",
        filename: "demo.mp4",
        width: 1920,
        height: 1080,
        duration: 10,
      }),
    ],
    selectedIdx: 0,
    language: "es",
    sidebarMode: "batch",
    templateRegions: [
      {
        id: "region-1",
        label: "TEXT_1",
        region: { x: 0.1, y: 0.1, w: 0.3, h: 0.12 },
        style: {},
      },
    ],
    selectedTemplateRegionId: "region-1",
    excelPath: null,
    excelMapping: { idColumn: null, columns: {} },
    excelRows: [],
    excelMatchStatus: {},
    currentRegion: null,
  });
}

function renderBatchPanel() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(BatchPanel));
  });
}

describe("BatchPanel mount", () => {
  beforeEach(() => {
    seedBatchPanelState();
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("mounts and shows primary batch controls with a seeded template region", () => {
    renderBatchPanel();

    expect(document.querySelector('[data-testid="batch-panel"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Regiones de texto/i);
    expect(document.body.textContent).toMatch(/TEXT_1/);
    expect(document.body.textContent).toMatch(/Importar Excel/i);
    expect(document.body.textContent).toMatch(/Aplicar capas a todos/i);
    expect(document.body.textContent).toMatch(/Editor de tabla/i);
    expect(document.body.textContent).toMatch(/Marcar como plantilla/i);
    expect(document.body.textContent).toMatch(/Agregar región actual/i);
  });
});
