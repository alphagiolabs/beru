import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
  downloadUpdate: vi.fn(async () => ({ ok: true })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: Header } = await import("../src/components/Header.jsx");

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

describe("Header batch summary", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      isProcessing: false,
      batchSummary: { total: 1, succeeded: 0, failed: 1 },
      exportFormat: "mp4",
      encodeProfile: "balanced",
      batchWorkers: 0,
      outputDir: null,
      queue: [queueItem()],
      selectedIdx: 0,
      presets: [],
      theme: "dark",
      language: "es",
      recent: [],
      undoStack: [],
      redoStack: [],
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
    window.api.downloadUpdate.mockClear();
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("keeps the completion summary on one line", () => {
    act(() => {
      root.render(<Header />);
    });

    const summary = Array.from(document.querySelectorAll("span")).find(
      (span) => span.textContent.includes("0/1 ok") && span.textContent.includes("1 err"),
    );

    expect(summary.className).toContain("whitespace-nowrap");
    expect(summary.className).toContain("flex-shrink-0");
  });

  it("shows the update download circle beside Importar when a new version is available", async () => {
    useEditorStore.setState({
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    act(() => {
      root.render(<Header />);
    });

    const buttons = Array.from(document.querySelectorAll("button"));
    const importButton = buttons.find((button) => button.textContent.includes("Importar"));
    const updateButton = document.querySelector(
      'button[aria-label="Descargar actualización 9.9.9"]',
    );

    expect(updateButton).toBeTruthy();
    expect(importButton.nextElementSibling).toBe(updateButton);

    await act(async () => {
      updateButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.api.downloadUpdate).toHaveBeenCalledTimes(1);
  });
});
