import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: StatusFooter } = await import("../src/components/StatusFooter.jsx");

let root = null;

const queueItem = () => ({
  path: "C:\\videos\\sample.mp4",
  src: "",
  filename: "sample.mp4",
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

describe("StatusFooter batch summary", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      isProcessing: false,
      batchSummary: { total: 1, succeeded: 0, failed: 1 },
      progressDone: 0,
      progressTotal: 0,
      queue: [queueItem()],
      logLines: [],
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

  it("shows the completion summary in the footer chip", () => {
    act(() => {
      root.render(<StatusFooter />);
    });

    const chip = document.querySelector(".status-footer-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toMatch(/0\/1/);
    expect(chip.textContent).toMatch(/1 err/);
  });

  it("shows cancelled count separately from errors", () => {
    useEditorStore.setState({
      isProcessing: false,
      batchSummary: { total: 3, succeeded: 1, failed: 1, cancelled: 1 },
    });
    act(() => {
      root.render(<StatusFooter />);
    });
    const chip = document.querySelector(".status-footer-chip");
    expect(chip.textContent).toMatch(/1\/3/);
    expect(chip.textContent).toMatch(/1 err/);
    expect(chip.textContent).toMatch(/1 cancel/);
  });
});
