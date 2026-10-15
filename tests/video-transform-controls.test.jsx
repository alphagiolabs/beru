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

  it("sets a resolution keeping the output aspect", () => {
    act(() => button("480p").click());
    expect(useEditorStore.getState().queue[0].transform).toMatchObject({
      outputWidth: 854,
      outputHeight: 480,
    });
    expect(document.body.textContent).toMatch(/Salida 854×480 px/);
  });

  const setSource = (width, height, operations = []) =>
    useEditorStore.setState({
      queue: [{ ...useEditorStore.getState().queue[0], width, height, operations }],
    });

  it("upscales a near-16:9 source to a clean 1920x1080 without bars", () => {
    act(() => setSource(848, 478));
    act(() => button("1080p").click());
    expect(useEditorStore.getState().queue[0].transform).toMatchObject({
      outputWidth: 1920,
      outputHeight: 1080,
      fitMode: "pad",
    });
    expect(document.body.textContent).toMatch(/Salida 1920×1080 px/);
    expect(button("16:9").getAttribute("aria-pressed")).toBe("true");
  });

  const typeSize = (label, value) => {
    const input = document.querySelector(`input[aria-label="${label}"]`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const pending = useEditorStore.getState().queue[0].transform;
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    return pending;
  };
  const transform = () => useEditorStore.getState().queue[0].transform;

  it("types an exact size, keeping the aspect while linked", () => {
    expect(typeSize("Ancho", 1920).outputWidth).toBeNull();
    expect(transform()).toMatchObject({ outputWidth: 1920, outputHeight: 1080, fitMode: "pad" });
    expect(document.body.textContent).toMatch(/Salida 1920×1080 px/);

    act(() => button("Cambiar ancho y alto por separado").click());
    typeSize("Alto", 1440);
    expect(transform()).toMatchObject({ outputWidth: 1920, outputHeight: 1440 });
    act(() => button("Estirar").click());
    expect(transform().fitMode).toBe("stretch");
  });

  it("stretches a 4:3 source to 16:9 and keeps the Fechero undistorted", () => {
    act(() =>
      setSource(960, 720, [
        {
          id: "s",
          mode: "datetime",
          region: { x: 0.1, y: 0.05, w: 0.6, h: 0.1 },
          fontSize: 40,
          textScaleX: 2,
        },
      ]),
    );
    act(() => button("16:9").click());
    act(() => button("Estirar").click());
    expect(transform()).toMatchObject({ outputWidth: 1280, outputHeight: 720, fitMode: "stretch" });
    const [stamp] = useEditorStore.getState().queue[0].operations;
    expect(stamp).toMatchObject({ fontSize: 40, textScaleX: 2 });
    expect(stamp.region.w * 1280).toBeCloseTo(0.6 * 960, 5);
  });

  it("is locked while a run is processing", () => {
    act(() => useEditorStore.setState({ isProcessing: true }));
    expect(button("Girar 90° a la derecha").disabled).toBe(true);
    expect(button("480p").disabled).toBe(true);
  });
});
