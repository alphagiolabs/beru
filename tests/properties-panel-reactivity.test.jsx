import React, { act } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import PropertiesPanel from "../src/components/PropertiesPanel.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

window.api = window.api || {};

function setupLogoPanel() {
  useEditorStore.setState({
    sidebarMode: "logo",
    activeTool: "text",
    currentRegion: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
    selectedIdx: -1,
    queue: [],
    textInput: "Initial",
    tempStart: null,
    tempEnd: null,
  });
}

function renderPanel() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(PropertiesPanel));
  });
  return root;
}

describe("PropertiesPanel — text input reactivity", () => {
  beforeEach(() => {
    setupLogoPanel();
  });

  it("re-renders textInput when the store changes externally (preset/undo/load)", () => {
    renderPanel();
    // Find the text content input (placeholder "Texto...")
    const textInput = Array.from(document.querySelectorAll('input[type="text"]')).find(
      (el) => el.placeholder === "Texto...",
    );
    expect(textInput).toBeTruthy();
    expect(textInput.value).toBe("Initial");

    // Simulate an external mutation (preset apply, undo, project load, Excel)
    act(() => {
      useEditorStore.getState().setTextInput("ChangedByPreset");
    });

    // The input must reflect the new value WITHOUT user interaction
    expect(textInput.value).toBe("ChangedByPreset");
  });
});

describe("PropertiesPanel — invalid time range warning", () => {
  beforeEach(() => {
    setupLogoPanel();
  });

  it("shows a warning when tempEnd <= tempStart", () => {
    renderPanel();
    // No warning initially
    expect(document.body.textContent).not.toContain("rango es inválido");

    act(() => {
      useEditorStore.getState().setTempStart(10);
      useEditorStore.getState().setTempEnd(5);
    });

    expect(document.body.textContent).toContain("rango es inválido");
  });

  it("does not show a warning for a valid range", () => {
    renderPanel();
    act(() => {
      useEditorStore.getState().setTempStart(2);
      useEditorStore.getState().setTempEnd(8);
    });
    expect(document.body.textContent).not.toContain("rango es inválido");
  });
});
