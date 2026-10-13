import { act } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import VideoTimingControls from "../src/components/VideoTimingControls.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;
let root;
beforeEach(() => {
  useEditorStore.setState({
    language: "es",
    queue: [createQueueItem({ path: "C:\\m\\a.mp4", duration: 6 })],
    selectedIdx: 0,
    isProcessing: false,
    undoStack: [],
    redoStack: [],
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => root.render(<VideoTimingControls />));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
it("changes speed through the actual Select and locks edits during a run", async () => {
  const trigger = document.querySelector('[aria-label="Velocidad del video"]');
  act(() =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (el) => el.textContent === "2×",
  );
  expect(option).toBeTruthy();
  act(() => option.click());
  expect(useEditorStore.getState().queue[0].timing.rate).toBe(2);
  expect(document.body.textContent).toContain("Duración de salida: 3.00 s");
  const repeats = document.querySelector('[aria-label="Ciclos totales"]');
  act(() =>
    repeats.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  act(() =>
    [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === "3").click(),
  );
  expect(document.body.textContent).toContain("Duración de salida: 9.00 s");
  expect(document.querySelector('[aria-label="Ciclo de vista previa"]')).toBeTruthy();
  act(() => useEditorStore.getState().undo());
  expect(document.body.textContent).toContain("Duración de salida: 3.00 s");
  act(() => useEditorStore.getState().undo());
  expect(document.body.textContent).toContain("Duración de salida: 6.00 s");
  act(() => useEditorStore.setState({ isProcessing: true }));
  expect(trigger.disabled).toBe(true);
});
