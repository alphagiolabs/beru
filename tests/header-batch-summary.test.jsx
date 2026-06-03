import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: Header } = await import("../src/components/Header.jsx");

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
    });
  });

  it("keeps the completion summary on one line", () => {
    const root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<Header />);
    });

    const summary = Array.from(document.querySelectorAll("span")).find(
      (span) => span.textContent.includes("0/1 ok") && span.textContent.includes("1 err"),
    );

    expect(summary.className).toContain("whitespace-nowrap");
    expect(summary.className).toContain("flex-shrink-0");
  });
});
