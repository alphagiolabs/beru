import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore.js";
import { seedAuthenticatedAuth } from "./helpers/authTestState.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (globalThis.HTMLCanvasElement) {
  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  });
}

const noop = () => () => {};
const asyncNoop = async () => ({});

const resolveDroppedPaths = vi.fn(async (paths) => ({
  videoPaths: [],
  ignoredCount: paths.length,
}));
const getPathForFile = vi.fn((file) => file.__dropPath || "");

window.api = {
  onProgress: noop,
  onJobProgress: noop,
  onComplete: noop,
  onSummary: noop,
  onJobError: noop,
  onJobCancelled: noop,
  onFinished: noop,
  onRunStarted: noop,
  onError: noop,
  onUpdaterEvent: noop,
  checkForUpdates: asyncNoop,
  resolveDroppedPaths,
  getPathForFile,
};

let root = null;
let App = null;

function dispatchDrop(files) {
  const shell = document.querySelector(".app-shell");
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  shell.dispatchEvent(event);
}

describe("drop file paths", () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.clearAllMocks();
    useEditorStore.setState({
      queue: [],
      selectedIdx: -1,
      selectedOperationIdx: null,
      language: "es",
      sidebarMode: "logo",
      templateRegions: [],
      selectedTemplateRegionId: null,
      currentRegion: null,
      showMappingModal: false,
      showTableEditor: false,
      appToast: null,
      isProcessing: false,
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
    await seedAuthenticatedAuth();
    ({ default: App } = await import("../src/App.jsx"));
    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 10));
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

  it("resolves dropped file paths via api.getPathForFile", async () => {
    const file = new File(["x"], "demo.mp4", { type: "video/mp4" });
    file.__dropPath = "C:\\videos\\demo.mp4";

    await act(async () => {
      dispatchDrop([file]);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(getPathForFile).toHaveBeenCalledWith(file);
    expect(resolveDroppedPaths).toHaveBeenCalledWith(["C:\\videos\\demo.mp4"]);
  });

  it("falls back to file.path when getPathForFile returns empty", async () => {
    const file = new File(["x"], "legacy.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "path", { value: "C:\\videos\\legacy.mp4" });

    await act(async () => {
      dispatchDrop([file]);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(resolveDroppedPaths).toHaveBeenCalledWith(["C:\\videos\\legacy.mp4"]);
  });

  it("warns instead of calling main when no path can be resolved", async () => {
    const file = new File(["x"], "ghost.mp4", { type: "video/mp4" });

    await act(async () => {
      dispatchDrop([file]);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(resolveDroppedPaths).not.toHaveBeenCalled();
    expect(useEditorStore.getState().appToast?.text).toMatch(/No se detectaron rutas de archivos/i);
  });
});
