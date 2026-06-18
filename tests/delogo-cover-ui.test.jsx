import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import PropertiesPanel from "../src/components/PropertiesPanel.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the image IPC channels the cover picker uses (same contract as file.js handlers).
window.api = {
  pickImage: vi.fn(async () => ({ success: true, path: "C:\\imgs\\patch.png" })),
  readImage: vi.fn(async () => ({
    success: true,
    dataUrl: "data:image/png;base64,AAAA",
  })),
};

function setupDelogoPanel() {
  useEditorStore.setState({
    sidebarMode: "logo",
    activeTool: "delogo",
    currentRegion: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
    selectedIdx: -1,
    queue: [],
    delogoMethod: "cover",
    delogoImagePath: "",
  });
}

function renderPanel() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(PropertiesPanel));
  });
  return root;
}

describe("PropertiesPanel — delogo cover method", () => {
  beforeEach(() => {
    setupDelogoPanel();
    window.api.pickImage.mockClear();
    window.api.readImage.mockClear();
  });

  it("renders an image picker when cover method is selected", () => {
    renderPanel();

    // The cover picker exposes an "Elegir" button, mirroring WatermarkModal.
    const chooseBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /Elegir/.test(b.textContent || ""),
    );
    expect(chooseBtn).toBeTruthy();
  });

  it("picking an image stores the path in delogoImagePath and clears on reset", async () => {
    const root = renderPanel();

    const chooseBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /Elegir/.test(b.textContent || ""),
    );

    await act(async () => {
      chooseBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.api.pickImage).toHaveBeenCalled();
    expect(useEditorStore.getState().delogoImagePath).toBe("C:\\imgs\\patch.png");

    // Clear button (×) resets the path.
    const clearBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "×",
    );
    expect(clearBtn).toBeTruthy();
    await act(async () => {
      clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useEditorStore.getState().delogoImagePath).toBe("");

    act(() => root.unmount());
  });
});
