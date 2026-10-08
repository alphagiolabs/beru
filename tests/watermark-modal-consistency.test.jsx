import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import WatermarkModal from "../src/components/WatermarkModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setupModal() {
  useEditorStore.setState({
    showWatermarkModal: true,
    watermark: {
      enabled: true,
      type: "image",
      imagePath: "",
      imageV: "",
      scale: 1,
      opacity: 0.5,
      position: "bottom-right",
    },
  });
}

function renderModal() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(WatermarkModal));
  });
  return root;
}

function findChooseButton() {
  return Array.from(document.querySelectorAll("button")).find((b) =>
    /Elegir/.test(b.textContent || ""),
  );
}

describe("WatermarkModal — image picker consistency", () => {
  beforeEach(() => {
    setupModal();
    window.api = {
      pickImage: vi.fn(),
      statImage: vi.fn(),
    };
    useEditorStore.setState({
      showToast: vi.fn(() => {}),
    });
  });

  it("sets imagePath and imageV atomically on success", async () => {
    window.api.pickImage.mockResolvedValue({ success: true, path: "C:\\imgs\\wm.png" });
    window.api.statImage.mockResolvedValue({
      success: true,
      size: 4,
      mtimeMs: 1700000000000,
    });

    renderModal();
    const btn = findChooseButton();
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState().watermark;
    expect(state.imagePath).toBe("C:\\imgs\\wm.png");
    expect(state.imageV).toBe("1700000000000-4");
  });

  it("does NOT set imagePath when statImage fails (no divergence)", async () => {
    window.api.pickImage.mockResolvedValue({ success: true, path: "C:\\imgs\\bad.png" });
    window.api.statImage.mockResolvedValue({ success: false, error: "too big" });

    renderModal();
    const btn = findChooseButton();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState().watermark;
    expect(state.imagePath).toBe("");
    expect(state.imageV).toBe("");
  });

  it("keeps the configured image when user cancels image pick", async () => {
    useEditorStore.setState({
      watermark: {
        enabled: true,
        type: "image",
        imagePath: "C:\\old.png",
        imageV: "111-9",
        scale: 1,
        opacity: 0.5,
        position: "bottom-right",
      },
    });
    window.api.pickImage.mockResolvedValue({ canceled: true });

    renderModal();
    const btn = findChooseButton();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState().watermark;
    expect(state.imagePath).toBe("C:\\old.png");
    expect(state.imageV).toBe("111-9");
  });
});
