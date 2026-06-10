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
      logLines: [],
      batchSummary: null,
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
    expect(footer.textContent).toMatch(/v1\.6\.17/);
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

  it("opens update popover from version badge when an update is available", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "- Fix batch queue\n- Improve footer",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version--badge");
    expect(versionBtn).toBeTruthy();

    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector(".status-footer-popover--update")).toBeTruthy();
    expect(document.body.textContent).toMatch(/Actualizar ahora/i);

    const updateNow = Array.from(document.querySelectorAll("button")).find((btn) =>
      btn.textContent.includes("Actualizar ahora"),
    );
    await act(async () => {
      updateNow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.api.downloadUpdate).toHaveBeenCalledTimes(1);
  });
});
