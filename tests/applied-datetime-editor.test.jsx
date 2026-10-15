import React, { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import PropertiesPanel from "../src/components/PropertiesPanel.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createOperation } from "../src/utils/operation.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

const stamp = createOperation({
  id: "op-stamp",
  mode: "datetime",
  region: { x: 0.2, y: 0.3, w: 0.4, h: 0.1 },
  clockStart: "2026-10-06T12:04:13",
  bgOpacity: 0.65,
});

beforeEach(() => {
  useEditorStore.setState({
    sidebarMode: "logo",
    activeTool: "datetime",
    currentRegion: null,
    queue: [
      { path: "C:\\v.mp4", filename: "v.mp4", width: 1920, height: 1080, operations: [stamp] },
    ],
    selectedIdx: 0,
    selectedOperationIdx: 0,
    undoStack: [],
    redoStack: [],
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => root.render(<PropertiesPanel />));
});

afterEach(() => act(() => root.unmount()));

const editor = () => document.querySelector('[data-testid="applied-datetime-editor"]');
const op = () => useEditorStore.getState().queue[0].operations[0];
const setValue = (input, value) => {
  const proto = Object.getPrototypeOf(input);
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
};

it("puts the applied Fechero editor first and edits its clock and style", () => {
  expect(document.querySelector(".inspector-body").firstElementChild).toBe(editor());

  setValue(editor().querySelector('input[type="datetime-local"]'), "2025-01-31T23:59:50");
  expect(op().clockStart).toBe("2025-01-31T23:59:50");

  act(() => editor().querySelector('[data-preset-id="yellow-block"]').click());
  expect(op()).toMatchObject({ bgColor: "#ffe600", fontColor: "black", textScaleX: 1 });
  expect(useEditorStore.getState().textFontColor).not.toBe("black");

  useEditorStore.getState().undo();
  expect(op().bgColor).not.toBe("#ffe600");
});

it("applies the DVR look to the selected layer, sized to its video", () => {
  const dvr = [...editor().querySelectorAll("button")].find((b) => /DVR/.test(b.textContent));
  act(() => dvr.click());
  expect(op()).toMatchObject({
    fontFamily: "Segoe UI",
    textScaleX: 2.06,
    fontSize: 64,
    bgOpacity: 0.43,
    clockLayout: "single",
    region: { x: 0.103, y: 0.055, w: 0.621, h: 0.098 },
  });
  expect(useEditorStore.getState().currentRegion).toBeNull();
});

it("scales the text with the box when W or H is typed", () => {
  const before = op();
  const inputs = [...editor().querySelectorAll('input[type="number"]')];
  const h = inputs.at(-1);
  act(() => h.focus());
  setValue(h, "2");
  expect(op().fontSize).toBe(8);
  setValue(h, String(Math.round(before.region.h * 1080 * 2)));
  expect(op().region.h).toBeCloseTo(before.region.h * 2, 2);
  expect(op().fontSize).toBe(before.fontSize * 2);
  expect(op().textScaleX).toBe(before.textScaleX / 2);
});
