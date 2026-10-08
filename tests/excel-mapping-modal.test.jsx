import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import ExcelMappingModal from "../src/components/ExcelMappingModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { prepareRun } from "../src/utils/export-run.js";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const queueItem = (filename) => ({
  path: `C:\\videos\\${filename}`,
  src: "",
  filename,
  width: 1920,
  height: 1080,
  duration: 0,
  videoCodec: "",
  pixFmt: "yuv420p",
  frameRate: 0,
  audioCodec: "",
  operations: [],
  status: "idle",
  progress: 0,
  eta: null,
  speed: null,
  error: null,
  customOutputName: "",
  thumbnail: null,
});

describe("ExcelMappingModal", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      queue: [queueItem("1.mp4")],
      selectedIdx: 0,
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        { id: "region-2", label: "TEXT_2", region: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 } },
      ],
      excelHeaders: ["id", "TEXT_1", "TEXT_2"],
      excelRows: [{ id: 1, TEXT_1: "89989989865", TEXT_2: "50% OFF" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" } },
      showMappingModal: true,
      textFontSize: 32,
      textFontColor: "white",
      fontFamily: "Arial",
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      bold: false,
      italic: false,
      bgEnabled: true,
      bgColor: "black",
      bgOpacity: 0.65,
      boxBorderWidth: 4,
      borderWidth: 0,
      borderColor: "black",
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  it("refreshes video matches when Excel rows or the ID column change", () => {
    root = createRoot(document.getElementById("root"));
    act(() => {
      root.render(<ExcelMappingModal />);
    });

    const previewValues = () =>
      Array.from(document.querySelector("tbody tr").cells, (cell) => cell.textContent);
    expect(previewValues()).toEqual(["1.mp4", "1", "89989989865", "50% OFF"]);

    act(() => {
      useEditorStore.setState({
        excelRows: [
          { id: 2, code: "1", TEXT_1: "Por código", TEXT_2: "Código 1" },
          { id: 1, code: "2", TEXT_1: "Por ID", TEXT_2: "ID 1" },
        ],
      });
    });
    expect(previewValues()).toEqual(["1.mp4", "1", "Por ID", "ID 1"]);

    act(() => {
      useEditorStore.setState({
        excelHeaders: ["id", "code", "TEXT_1", "TEXT_2"],
        excelMapping: {
          idColumn: "code",
          columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" },
        },
      });
    });
    expect(previewValues()).toEqual(["1.mp4", "1", "Por código", "Código 1"]);
  });

  it("applies the edited mapping when the apply button is clicked", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<ExcelMappingModal />);
    });

    const region2Trigger = document.querySelector('[role="combobox"][aria-label="TEXT_2"]');

    act(() => {
      region2Trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent === "TEXT_1",
    );

    act(() => {
      option.click();
    });

    const apply = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Aplicar mapeo"),
    );

    act(() => {
      apply.click();
    });

    expect(useEditorStore.getState().showMappingModal).toBe(false);
    expect(useEditorStore.getState().excelMapping.columns["region-2"]).toBe("TEXT_1");
    expect(useEditorStore.getState().queue[0].operations.map((op) => op.text)).toEqual([
      "89989989865",
      "89989989865",
    ]);
    const s = useEditorStore.getState();
    const prepared = prepareRun({ queue: s.queue, videoIdx: 0 });
    expect(prepared.jobs[0].operations.map((op) => op.text)).toEqual([
      "89989989865",
      "89989989865",
    ]);
  });
});
