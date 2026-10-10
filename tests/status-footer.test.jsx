import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore";
import StatusFooter from "../src/components/StatusFooter";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("StatusFooter", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      isProcessing: false,
      progressDone: 0,
      progressTotal: 0,
      queue: [],
      batchSummary: null,
      language: "es",
      updateModalOpen: false,
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
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("renders the Hermes-style footer with version info", async () => {
    await act(async () => {
      root.render(<StatusFooter />);
    });

    const footer = document.querySelector(".status-footer");
    expect(footer).toBeTruthy();
    expect(footer.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(footer.textContent).toMatch(/Listo/i);
  });

  it("shows running state, job count, and segmented progress while processing", async () => {
    useEditorStore.setState({
      isProcessing: true,
      progressDone: 0,
      progressTotal: 2,
      queue: [
        { status: "processing", progress: 40 },
        { status: "idle", progress: 0 },
      ],
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const footer = document.querySelector(".status-footer");
    expect(footer.textContent).toMatch(/Procesando/i);
    expect(footer.textContent).toMatch(/0\/2/);
    expect(document.querySelector(".status-footer-progress")).toBeTruthy();
  });

  it("updates progress when only the queue length changes", async () => {
    useEditorStore.setState({
      isProcessing: true,
      progressDone: 0,
      progressTotal: 0,
      jobProgress: {},
      queue: [{ status: "idle" }],
    });
    await act(async () => {
      root.render(<StatusFooter />);
    });
    expect(document.querySelector(".status-footer").textContent).toContain("0/1");

    await act(async () => {
      useEditorStore.setState({ queue: [{ status: "idle" }, { status: "idle" }] });
    });
    expect(document.querySelector(".status-footer").textContent).toContain("0/2");
  });

  it("opens a centered confirmation when the current version is up to date", async () => {
    useEditorStore.getState().applyUpdaterEvent({ type: "not-available", version: "1.6.47" });
    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector(".status-footer-up-to-date-panel");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.textContent).toMatch(/Todo está al día/i);
    expect(dialog.textContent).toMatch(/versión más reciente/i);

    await act(async () => {
      dialog
        .querySelector('button[aria-label="Cerrar"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector(".status-footer-up-to-date-panel")).toBeNull();
  });

  it("shows a check-for-updates button in the up-to-date dialog", async () => {
    const checkForUpdates = vi.fn(async () => ({ ok: true }));
    window.api = {
      checkForUpdates,
    };

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkBtn = document.querySelector(".status-footer-up-to-date-check");
    expect(checkBtn).toBeTruthy();
    expect(checkBtn.textContent).toMatch(/Buscar actualizaciones/i);

    await act(async () => {
      checkBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(checkForUpdates).toHaveBeenCalled();
    expect(document.querySelector(".status-footer-up-to-date-panel")).toBeNull();
  });
});
