import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import ExcelMappingModal from "../src/components/ExcelMappingModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

  it("applies the edited mapping when the apply button is clicked", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<ExcelMappingModal />);
    });

    const selects = Array.from(document.querySelectorAll("select"));
    const region2Select = selects[2];

    act(() => {
      region2Select.value = "TEXT_1";
      region2Select.dispatchEvent(new Event("change", { bubbles: true }));
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
    expect(
      useEditorStore
        .getState()
        ._buildJobFor(useEditorStore.getState().queue[0], 0)
        .operations.map((op) => op.text),
    ).toEqual(["89989989865", "89989989865"]);
  });

  it("caps the modal width instead of stretching to the overlay", async () => {
    root = createRoot(document.getElementById("root"));

    await act(async () => {
      root.render(<ExcelMappingModal />);
    });

    expect(document.querySelector(".cap-modal-panel")?.className).toContain("max-w-[960px]");
  });
});
