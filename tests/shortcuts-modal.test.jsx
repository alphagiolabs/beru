import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import ShortcutsModal from "../src/components/ShortcutsModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShortcutsModal", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({ showShortcuts: true });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  it("caps the modal width instead of stretching to the overlay", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<ShortcutsModal />);
    });

    expect(document.querySelector(".cap-modal-panel")?.className).toContain("max-w-[400px]");
  });
});
