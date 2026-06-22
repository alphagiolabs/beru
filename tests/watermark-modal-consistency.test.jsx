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
      imageDataUrl: "",
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
      readImage: vi.fn(),
    };
    useEditorStore.setState({
      showToast: vi.fn(() => {}),
    });
  });

  it("sets imagePath and imageDataUrl atomically on success", async () => {
    window.api.pickImage.mockResolvedValue({ success: true, path: "C:\\imgs\\wm.png" });
    window.api.readImage.mockResolvedValue({
      success: true,
      dataUrl: "data:image/png;base64,AAAA",
    });

    renderModal();
    const btn = findChooseButton();
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Let both pickImage and readImage resolve
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState().watermark;
    expect(state.imagePath).toBe("C:\\imgs\\wm.png");
    expect(state.imageDataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("does NOT set imagePath when readImage fails (no divergence)", async () => {
    window.api.pickImage.mockResolvedValue({ success: true, path: "C:\\imgs\\bad.png" });
    window.api.readImage.mockResolvedValue({ success: false, error: "too big" });

    renderModal();
    const btn = findChooseButton();

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    const state = useEditorStore.getState().watermark;
    // The bug: imagePath was set but imageDataUrl was empty → preview broken,
    // export worked. The fix: don't set imagePath if readImage fails.
    expect(state.imagePath).toBe("");
    expect(state.imageDataUrl).toBe("");
  });

  it("clears stale imageDataUrl when user cancels image pick", async () => {
    // Start with a previously-selected image
    useEditorStore.setState({
      watermark: {
        enabled: true,
        type: "image",
        imagePath: "C:\\old.png",
        imageDataUrl: "data:image/png;base64,OLD",
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
    expect(state.imagePath).toBe("");
    expect(state.imageDataUrl).toBe("");
  });
});
