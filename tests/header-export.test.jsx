import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createQueueItem } from "../src/utils/types.js";

const startProcessing = vi.fn(async () => ({ success: true }));

window.api = {
  startProcessing,
  getVideoInfoBatch: vi.fn(async () => []),
};

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: Header } = await import("../src/components/Header.jsx");

let root = null;

function seedExportReadyState(overrides = {}) {
  const showToast = vi.fn();
  useEditorStore.setState({
    queue: [
      createQueueItem({
        path: "C:\\videos\\demo.mp4",
        src: "beru://local/C%3A%5Cvideos%5Cdemo.mp4",
        filename: "demo.mp4",
        width: 1920,
        height: 1080,
        duration: 10,
      }),
    ],
    selectedIdx: 0,
    outputDir: "C:\\output",
    isProcessing: false,
    language: "es",
    sidebarMode: "logo",
    templateRegions: [],
    activeExecutionId: null,
    executionHistory: [],
    showToast,
    ...overrides,
  });
  return { showToast };
}

function renderHeader() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(Header));
  });
}

function getProcessButton() {
  return document.querySelector('[data-testid="header-process-all"]');
}

describe("Header export wiring", () => {
  beforeEach(() => {
    startProcessing.mockClear();
    startProcessing.mockResolvedValue({ success: true });
    window.api.getVideoInfoBatch.mockClear();
    window.api.getVideoInfoBatch.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("starts batch processing with a job manifest on happy path", async () => {
    seedExportReadyState();
    renderHeader();

    const processButton = getProcessButton();
    expect(processButton).toBeTruthy();
    expect(processButton.disabled).toBe(false);

    await act(async () => {
      processButton.click();
      await vi.waitFor(() => {
        expect(startProcessing).toHaveBeenCalledTimes(1);
      });
    });

    const manifest = startProcessing.mock.calls[0][0];
    expect(manifest).toMatchObject({
      type: "beru-job-manifest",
      version: 1,
    });
    expect(Array.isArray(manifest.jobs)).toBe(true);
    expect(manifest.jobs.length).toBeGreaterThan(0);
    expect(manifest.jobs[0]).toMatchObject({
      id: 0,
      input_path: "C:\\videos\\demo.mp4",
    });
  });

  it("shows missing dimensions toast and does not start processing", async () => {
    window.api.getVideoInfoBatch.mockResolvedValue([{ width: 0, height: 0 }]);
    const { showToast } = seedExportReadyState({
      queue: [
        createQueueItem({
          path: "C:\\videos\\nodims.mp4",
          filename: "nodims.mp4",
          width: 0,
          height: 0,
        }),
      ],
    });
    renderHeader();

    const processButton = getProcessButton();
    expect(processButton).toBeTruthy();

    await act(async () => {
      processButton.click();
      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalled();
      });
    });

    expect(startProcessing).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "err",
        text: expect.stringMatching(/sin resolución/i),
      }),
    );
  });
});
