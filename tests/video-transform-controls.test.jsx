import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import VideoTransformControls from "../src/components/VideoTransformControls.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const button = (label) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
  );

describe("VideoTransformControls", () => {
  let root = null;

  beforeEach(() => {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "C:\\m\\a.mp4",
          filename: "a.mp4",
          width: 1280,
          height: 720,
          duration: 6,
        }),
      ],
      selectedIdx: 0,
      isProcessing: false,
      undoStack: [],
      redoStack: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    act(() => root.render(React.createElement(VideoTransformControls)));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("rotates a quarter turn per click and undoes it as one step", () => {
    act(() => button("Girar 90° a la derecha").click());
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(90);
    act(() => button("Girar 90° a la izquierda").click());
    act(() => button("Girar 90° a la izquierda").click());
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(270);
    expect(useEditorStore.getState().undoStack).toHaveLength(3);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(0);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().queue[0].transform.rotation).toBe(90);
  });

  it("shows the effective output and sets a height that never upscales", () => {
    act(() => button("720p").click());
    expect(useEditorStore.getState().queue[0].transform.outputHeight).toBe(720);
    expect(document.body.textContent).toMatch(/Salida 1280×720 px/);
    act(() => button("480p").click());
    expect(document.body.textContent).toMatch(/Salida 852×480 px/);
  });

  it("is locked while a run is processing", () => {
    act(() => useEditorStore.setState({ isProcessing: true }));
    expect(button("Girar 90° a la derecha").disabled).toBe(true);
    expect(button("480p").disabled).toBe(true);
  });
});
